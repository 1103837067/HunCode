/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type Context,
	EventStream,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@mariozechner/pi-ai";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	StreamFn,
} from "./types.js";
import {
	augmentAssistantMessageForXmlStreaming,
	augmentAssistantMessageWithXmlToolCalls,
	coerceXmlStringArgs,
	parseCompletedInvokeBlocks,
	syntheticXmlToolCallId,
} from "./xml-tool-calls.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

function cloneAssistantMessageForXml(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		content: message.content.map((c) => ({ ...c })),
	};
}

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	const newMessages: AgentMessage[] = [...prompts];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts],
	};

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

/**
 * Collect tool results, merging early-started executions with any remaining.
 *
 * Early-started tools have already emitted `tool_execution_end` (UI updated).
 * This function only emits `message_start`/`message_end` for conversation history.
 * Non-early tools go through the full execution + finalize pipeline.
 */
async function collectToolResults(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	earlyExecutions: Map<string, Promise<FinalizedEarlyOutcome>>,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
	const results: ToolResultMessage[] = [];

	for (const toolCall of toolCalls) {
		const earlyExec = earlyExecutions.get(toolCall.id);
		if (earlyExec) {
			const executed = await earlyExec;
			const toolResultMessage: ToolResultMessage = {
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: executed.result.content,
				details: executed.result.details,
				isError: executed.isError,
				timestamp: Date.now(),
			};
			await emit({ type: "message_start", message: toolResultMessage });
			await emit({ type: "message_end", message: toolResultMessage });
			results.push(toolResultMessage);
		} else {
			await emit({
				type: "tool_execution_start",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: toolCall.arguments,
			});
			const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
			if (preparation.kind === "immediate") {
				results.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
			} else {
				const executed = await executePreparedToolCall(preparation, signal, emit);
				results.push(
					await finalizeExecutedToolCall(
						currentContext,
						assistantMessage,
						preparation,
						executed,
						config,
						signal,
						emit,
					),
				);
			}
		}
	}

	return results;
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<void> {
	let firstTurn = true;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				await emit({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					await emit({ type: "message_start", message });
					await emit({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// Early execution: start tool calls as soon as their </invoke> is received
			const earlyExecutions = new Map<string, Promise<FinalizedEarlyOutcome>>();

			const onInvokeComplete: OnInvokeComplete = (toolCall, partialMsg) => {
				const execution = (async (): Promise<FinalizedEarlyOutcome> => {
					await emit({
						type: "tool_execution_start",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						args: toolCall.arguments,
					});
					const prep = await prepareToolCall(currentContext, partialMsg, toolCall, config, signal);

					let result: AgentToolResult<any>;
					let isError: boolean;

					if (prep.kind === "immediate") {
						result = prep.result;
						isError = prep.isError;
					} else {
						const executed = await executePreparedToolCall(prep, signal, emit);
						result = executed.result;
						isError = executed.isError;

						if (config.afterToolCall) {
							const afterResult = await config.afterToolCall(
								{
									assistantMessage: partialMsg,
									toolCall: prep.toolCall,
									args: prep.args,
									result,
									isError,
									context: currentContext,
								},
								signal,
							);
							if (afterResult) {
								result = {
									content: afterResult.content ?? result.content,
									details: afterResult.details ?? result.details,
								};
								isError = afterResult.isError ?? isError;
							}
						}
					}

					await emit({
						type: "tool_execution_end",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						result,
						isError,
					});

					return { result, isError, finalized: true };
				})();
				earlyExecutions.set(toolCall.id, execution);
			};

			const message = await streamAssistantResponse(
				currentContext,
				config,
				signal,
				emit,
				streamFn,
				config.toolInvocation !== "native" ? onInvokeComplete : undefined,
			);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			hasMoreToolCalls = toolCalls.length > 0;

			const toolResults: ToolResultMessage[] = [];
			if (hasMoreToolCalls) {
				toolResults.push(
					...(await collectToolResults(
						currentContext,
						message,
						toolCalls as AgentToolCall[],
						earlyExecutions,
						config,
						signal,
						emit,
					)),
				);

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			await emit({ type: "turn_end", message, toolResults });

			pendingMessages = (await config.getSteeringMessages?.()) || [];
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
}

/** Callback invoked when a complete `<invoke>` block is detected during streaming. */
type OnInvokeComplete = (toolCall: AgentToolCall, partialMessage: AssistantMessage) => void;

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 *
 * @param onInvokeComplete - In XML mode, called as soon as each `</invoke>` is received
 *   so the caller can start tool execution before the stream finishes.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
	onInvokeComplete?: OnInvokeComplete,
): Promise<AssistantMessage> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	const nativeTools = config.toolInvocation === "native";
	// Build LLM context (XML mode: never send tools to the API — no function calling)
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: nativeTools ? context.tools : [],
	};

	const streamFunction = streamFn || streamSimple;

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	const response = await streamFunction(config.model, llmContext, {
		...config,
		apiKey: resolvedApiKey,
		signal,
	});

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;
	let prevCompleteCount = 0;

	/** Extract raw assistant text from the partial message for invoke detection. */
	function getRawText(msg: AssistantMessage): string {
		return msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	}

	/** Detect newly completed <invoke> blocks and notify caller with the current partial message. */
	function detectNewInvokes(rawMsg: AssistantMessage): void {
		if (nativeTools || !onInvokeComplete) return;
		const tools = context.tools ?? [];
		const rawText = getRawText(rawMsg);
		const completed = parseCompletedInvokeBlocks(rawText, tools);
		if (completed.length > prevCompleteCount) {
			for (let i = prevCompleteCount; i < completed.length; i++) {
				const p = completed[i];
				onInvokeComplete(
					{
						type: "toolCall",
						id: syntheticXmlToolCallId(i),
						name: p.name,
						arguments: coerceXmlStringArgs(p.arguments),
					},
					rawMsg,
				);
			}
			prevCompleteCount = completed.length;
		}
	}

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				{
					const rawPartial = partialMessage;
					let out = partialMessage;
					if (!nativeTools) {
						out = augmentAssistantMessageForXmlStreaming(
							cloneAssistantMessageForXml(partialMessage),
							context.tools ?? [],
						);
						partialMessage = out;
						context.messages[context.messages.length - 1] = out;
					}
					await emit({ type: "message_start", message: { ...out } });
					detectNewInvokes(rawPartial);
				}
				break;

			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				if (partialMessage) {
					const rawPartial = event.partial;
					partialMessage = event.partial;
					let out: AssistantMessage = partialMessage;
					if (!nativeTools) {
						out = augmentAssistantMessageForXmlStreaming(
							cloneAssistantMessageForXml(partialMessage),
							context.tools ?? [],
						);
						partialMessage = out;
						context.messages[context.messages.length - 1] = out;
					} else {
						context.messages[context.messages.length - 1] = partialMessage;
					}
					await emit({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...out },
					});
					detectNewInvokes(rawPartial);
				}
				break;

			case "done":
			case "error": {
				let finalMessage = await response.result();
				if (!nativeTools) {
					finalMessage = augmentAssistantMessageWithXmlToolCalls(finalMessage, context.tools ?? []);
				}
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					await emit({ type: "message_start", message: { ...finalMessage } });
				}
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	let finalMessage = await response.result();
	if (!nativeTools) {
		finalMessage = augmentAssistantMessageWithXmlToolCalls(finalMessage, context.tools ?? []);
	}
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	result: AgentToolResult<any>;
	isError: boolean;
};

type ExecutedToolCallOutcome = {
	result: AgentToolResult<any>;
	isError: boolean;
};

/**
 * Outcome of an early-started tool that already emitted `tool_execution_end`.
 * `collectToolResults` skips re-emitting the end event and only builds the
 * ToolResultMessage for conversation history.
 */
type FinalizedEarlyOutcome = ExecutedToolCallOutcome & { finalized: true };

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
	if (!tool) {
		return {
			kind: "immediate",
			result: createErrorToolResult(`Tool ${toolCall.name} not found`),
			isError: true,
		};
	}

	try {
		const validatedArgs = validateToolArguments(tool, toolCall);
		if (config.beforeToolCall) {
			const beforeResult = await config.beforeToolCall(
				{
					assistantMessage,
					toolCall,
					args: validatedArgs,
					context: currentContext,
				},
				signal,
			);
			if (beforeResult?.block) {
				return {
					kind: "immediate",
					result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
					isError: true,
				};
			}
		}
		return {
			kind: "prepared",
			toolCall,
			tool,
			args: validatedArgs,
		};
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
	const updateEvents: Promise<void>[] = [];

	try {
		const result = await prepared.tool.execute(
			prepared.toolCall.id,
			prepared.args as never,
			signal,
			(partialResult) => {
				updateEvents.push(
					Promise.resolve(
						emit({
							type: "tool_execution_update",
							toolCallId: prepared.toolCall.id,
							toolName: prepared.toolCall.name,
							args: prepared.toolCall.arguments,
							partialResult,
						}),
					),
				);
			},
		);
		await Promise.all(updateEvents);
		return { result, isError: false };
	} catch (error) {
		await Promise.all(updateEvents);
		return {
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

async function finalizeExecutedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	executed: ExecutedToolCallOutcome,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolResultMessage> {
	let result = executed.result;
	let isError = executed.isError;

	if (config.afterToolCall) {
		const afterResult = await config.afterToolCall(
			{
				assistantMessage,
				toolCall: prepared.toolCall,
				args: prepared.args,
				result,
				isError,
				context: currentContext,
			},
			signal,
		);
		if (afterResult) {
			result = {
				content: afterResult.content ?? result.content,
				details: afterResult.details ?? result.details,
			};
			isError = afterResult.isError ?? isError;
		}
	}

	return await emitToolCallOutcome(prepared.toolCall, result, isError, emit);
}

function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function emitToolCallOutcome(
	toolCall: AgentToolCall,
	result: AgentToolResult<any>,
	isError: boolean,
	emit: AgentEventSink,
): Promise<ToolResultMessage> {
	await emit({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
	});

	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: result.details,
		isError,
		timestamp: Date.now(),
	};

	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
	return toolResultMessage;
}
