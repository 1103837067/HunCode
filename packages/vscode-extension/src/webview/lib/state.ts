import type {
	ChatStatus,
	ConnectionState,
	ContextPill,
	ProviderConfigState,
	TimelineAssistantItem,
	TimelineAssistantPart,
	TimelineItem,
	TimelineSystemItem,
	TimelineToolItem,
} from "../types/ui.js";

export type SidebarView = "chat" | "settings";
export type BackendState = "starting" | "running" | "exited" | "error";
export type RpcState = "connected" | "disconnected";

export type PromptContext = {
	workspacePath?: string;
	currentFile?: { path: string; language?: string };
	selection?: { path: string; text: string; startLine?: number; endLine?: number };
};

export type WebviewState = {
	view: SidebarView;
	connectionState: ConnectionState;
	backendState?: BackendState;
	rpcState: RpcState;
	status: ChatStatus;
	sessionId?: string;
	model?: string;
	chatFontSize: number;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	providerConfigs: Record<string, ProviderConfigState>;
	draft: string;
	contextPills: ContextPill[];
	timeline: TimelineItem[];
	activeAssistantMessageId?: string;
	activeThinkingMessageId?: string;
	activeToolCallIds: string[];
	lastError?: string;
	autoCurrentFile: boolean;
	autoSelection: boolean;
};

export type WebviewAction =
	| { type: "setView"; view: SidebarView }
	| { type: "setDraft"; draft: string }
	| { type: "setChatFontSize"; value: number }
	| { type: "setContextPills"; pills: ContextPill[] }
	| { type: "setAutoCurrentFile"; value: boolean }
	| { type: "setAutoSelection"; value: boolean }
	| { type: "setBackendState"; backendState: BackendState }
	| { type: "setRpcState"; rpcState: RpcState }
	| { type: "toggleToolExpanded"; toolCallId: string }
	| { type: "appendUserPrompt"; id: string; text: string; context?: ContextPill[] }
	| { type: "applyAgentEvent"; event: Record<string, unknown> }
	| { type: "setInitialState"; state: Record<string, unknown> }
	| { type: "setModels"; models: Array<{ id: string; provider: string; label: string }> }
	| { type: "loadMessages"; messages: Array<Record<string, unknown>> }
	| { type: "reset" };

export function createInitialState(): WebviewState {
	return {
		view: "chat",
		connectionState: "connecting",
		rpcState: "disconnected",
		backendState: "starting",
		status: "ready",
		chatFontSize: 13,
		availableModels: [],
		providerConfigs: {},
		draft: "",
		contextPills: [],
		timeline: [],
		activeToolCallIds: [],
		autoCurrentFile: true,
		autoSelection: true,
	};
}

export const createInitialWebviewState = createInitialState;

export function setView(state: WebviewState, view: SidebarView): WebviewState {
	return { ...state, view };
}

/**
 * Convert raw AgentMessage[] (from get_messages RPC) into TimelineItem[].
 * This is used to restore a session's chat history after switching sessions.
 */
function messagesToTimeline(messages: Array<Record<string, unknown>>): TimelineItem[] {
	const timeline: TimelineItem[] = [];
	const pendingToolCalls = new Map<string, { name: string; args?: Record<string, unknown> }>();

	for (const msg of messages) {
		const role = msg.role as string;

		if (role === "user") {
			const content = msg.content;
			let text = "";
			if (typeof content === "string") {
				text = content;
			} else if (Array.isArray(content)) {
				text = (content as Array<Record<string, unknown>>)
					.filter((c) => c.type === "text")
					.map((c) => String(c.text ?? ""))
					.join("");
			}
			if (text) {
				timeline.push({
					kind: "user",
					id: `user-${String(msg.timestamp ?? timeline.length)}`,
					text,
					context: [],
				});
			}
		} else if (role === "assistant") {
			const content = msg.content as Array<Record<string, unknown>> | undefined;
			if (!content) continue;

			const msgId = `assistant-${String(msg.timestamp ?? timeline.length)}`;
			const parts: TimelineAssistantPart[] = [];
			let textAcc = "";

			for (const block of content) {
				if (block.type === "thinking") {
					parts.push({
						kind: "thinking",
						id: `thinking-${parts.length}`,
						text: String(block.thinking ?? ""),
					});
				} else if (block.type === "text") {
					textAcc += String(block.text ?? "");
				} else if (block.type === "toolCall") {
					if (textAcc) {
						parts.push({ kind: "text", id: `text-${parts.length}`, text: textAcc });
						textAcc = "";
					}
					const toolId = String(block.id ?? `tool-${parts.length}`);
					const toolName = String(block.name ?? "unknown");
					pendingToolCalls.set(toolId, {
						name: toolName,
						args: block.arguments as Record<string, unknown> | undefined,
					});
					parts.push({
						kind: "tool",
						toolCallId: toolId,
						id: toolId,
						toolName,
						summary: summarizeToolData(block.arguments),
						output: "",
						state: "success",
						isExpanded: false,
					});
				}
			}
			if (textAcc) {
				parts.push({ kind: "text", id: `text-${parts.length}`, text: textAcc });
			}

			timeline.push({
				kind: "assistant",
				id: msgId,
				text: parts
					.filter((p): p is TimelineAssistantPart & { kind: "text" } => p.kind === "text")
					.map((p) => p.text)
					.join(""),
				parts,
				isStreaming: false,
				streamState: "completed",
			} satisfies TimelineAssistantItem);
		} else if (role === "toolResult") {
			const toolCallId = String(msg.toolCallId ?? "");
			const isError = msg.isError === true;
			const output = extractToolResultText(msg.content);

			for (let i = timeline.length - 1; i >= 0; i--) {
				const item = timeline[i];
				if (item.kind === "assistant") {
					const partIdx = item.parts.findIndex((p) => p.kind === "tool" && p.toolCallId === toolCallId);
					if (partIdx >= 0) {
						const updatedParts = [...item.parts];
						const toolPart = updatedParts[partIdx];
						if (toolPart.kind === "tool") {
							updatedParts[partIdx] = {
								...toolPart,
								output,
								state: isError ? "error" : "success",
							};
						}
						timeline[i] = { ...item, parts: updatedParts };
					}
					break;
				}
			}
			pendingToolCalls.delete(toolCallId);
		}
	}

	return timeline;
}

function upsertSystem(
	state: WebviewState,
	stableId: string,
	text: string,
	level: TimelineSystemItem["level"] = "info",
): WebviewState {
	const existing = state.timeline.findIndex((item) => item.kind === "system" && item.id === stableId);
	if (existing >= 0) {
		return {
			...state,
			timeline: state.timeline.map((item, i) => (i === existing ? { ...item, text, level } : item)),
		};
	}
	return {
		...state,
		timeline: [...state.timeline, { kind: "system", id: stableId, text, level }],
	};
}

function removeSystem(state: WebviewState, stableId: string): WebviewState {
	const filtered = state.timeline.filter((item) => !(item.kind === "system" && item.id === stableId));
	if (filtered.length === state.timeline.length) return state;
	return { ...state, timeline: filtered };
}

function updateAssistant(
	state: WebviewState,
	assistantMessageId: string,
	updater: (item: TimelineAssistantItem) => TimelineAssistantItem,
): WebviewState {
	return {
		...state,
		timeline: state.timeline.map((item) =>
			item.kind === "assistant" && item.id === assistantMessageId ? updater(item) : item,
		),
	};
}

/**
 * Sync an assistant item's parts from the full message content snapshot.
 * This mirrors web-ui's approach: use the structured content array directly
 * instead of manually tracking text/thinking/toolcall sub-events.
 * Tool parts that already have execution state (summary, output, etc.) are preserved.
 */
function syncPartsFromSnapshot(
	item: TimelineAssistantItem,
	content: Array<Record<string, unknown>>,
	streamState: TimelineAssistantItem["streamState"],
): TimelineAssistantItem {
	const existingToolParts = new Map<string, Extract<TimelineAssistantPart, { kind: "tool" }>>();
	for (const part of item.parts) {
		if (part.kind === "tool") {
			existingToolParts.set(part.toolCallId, part);
		}
	}

	const parts: TimelineAssistantPart[] = [];
	let fullText = "";
	let fullThinkingText = "";
	const toolCallIds: string[] = [];
	let lastToolCallId: string | undefined;

	for (let i = 0; i < content.length; i++) {
		const block = content[i];

		if (block.type === "thinking" && typeof block.thinking === "string") {
			fullThinkingText += block.thinking;
			parts.push({ kind: "thinking", id: `${item.id}-thinking-${String(i)}`, text: block.thinking });
		} else if (block.type === "text" && typeof block.text === "string") {
			fullText += block.text;
			parts.push({ kind: "text", id: `${item.id}-text-${String(i)}`, text: block.text });
		} else if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
			const toolCallId = block.id as string;
			const toolName = block.name as string;
			toolCallIds.push(toolCallId);
			lastToolCallId = toolCallId;

			const existing = existingToolParts.get(toolCallId);
			if (existing) {
				parts.push(existing);
			} else {
				parts.push({
					kind: "tool",
					id: toolCallId,
					toolCallId,
					toolName,
					summary: summarizeToolData(block.arguments),
					output: "",
					state: "running",
					isExpanded: false,
					startedAt: Date.now(),
				});
			}
		}
	}

	return {
		...item,
		parts: parts.length > 0 ? parts : item.parts,
		text: fullText || item.text,
		thinkingText: fullThinkingText || item.thinkingText,
		resultText: fullText || item.resultText,
		toolCallIds: toolCallIds.length > 0 ? toolCallIds : item.toolCallIds,
		lastToolCallId: lastToolCallId ?? item.lastToolCallId,
		isStreaming: true,
		streamState,
	};
}

function appendToolPart(item: TimelineAssistantItem, toolCallId: string, toolName: string): TimelineAssistantItem {
	if (item.parts.some((part) => part.kind === "tool" && part.toolCallId === toolCallId)) {
		return item;
	}
	return {
		...item,
		parts: [
			...item.parts,
			{
				kind: "tool",
				id: toolCallId,
				toolCallId,
				toolName,
				output: "",
				state: "running",
				isExpanded: false,
				startedAt: Date.now(),
			},
		],
		toolCallIds: [...(item.toolCallIds ?? []), toolCallId],
		lastToolCallId: toolCallId,
	};
}

function updateToolPart(
	item: TimelineAssistantItem,
	toolCallId: string,
	updater: (
		part: Extract<TimelineAssistantItem["parts"][number], { kind: "tool" }>,
	) => Extract<TimelineAssistantItem["parts"][number], { kind: "tool" }>,
): TimelineAssistantItem {
	return {
		...item,
		parts: item.parts.map((part) => {
			if (part.kind !== "tool" || part.toolCallId !== toolCallId) return part;
			return updater(part);
		}),
	};
}

function summarizeToolData(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (value === undefined) return undefined;
	try {
		const json = JSON.stringify(value);
		return json.length > 200 ? `${json.slice(0, 197)}...` : json;
	} catch {
		return String(value);
	}
}

/**
 * Extract text from a toolResult content array (Array<{type:"text",text:string}>).
 */
function extractToolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return (content as Array<Record<string, unknown>>)
			.filter((c) => c.type === "text")
			.map((c) => String(c.text ?? ""))
			.join("\n");
	}
	if (content === undefined || content === null) return "";
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

/**
 * Resolve a stable message ID from an AgentSessionEvent.
 * Events like message_start/update/end carry the full message object.
 */
function resolveMessageId(event: Record<string, unknown>): string | undefined {
	const message = event.message as Record<string, unknown> | undefined;
	if (!message) return undefined;
	if (typeof message.id === "string") return message.id;
	return undefined;
}

/**
 * Process a raw AgentSessionEvent from the RPC backend into timeline state updates.
 * This follows the same pattern as web-ui's AgentInterface.setupSessionSubscription.
 */
export function reduceAgentEvent(state: WebviewState, event: Record<string, unknown>): WebviewState {
	switch (event.type) {
		case "agent_start":
			return {
				...state,
				status: "thinking",
				connectionState: "connected",
				rpcState: "connected",
				backendState: "running",
			};

		case "agent_end":
			return {
				...state,
				status: "ready",
				activeAssistantMessageId: undefined,
				activeThinkingMessageId: undefined,
				activeToolCallIds: [],
			};

		case "message_start": {
			const message = event.message as Record<string, unknown> | undefined;
			if (!message || message.role !== "assistant") return state;
			const messageId = resolveMessageId(event) ?? `assistant-${Date.now()}`;
			const exists = state.timeline.some((item) => item.kind === "assistant" && item.id === messageId);
			if (exists) {
				return updateAssistant({ ...state, activeAssistantMessageId: messageId }, messageId, (item) => ({
					...item,
					isStreaming: true,
					streamState: item.streamState === "completed" ? "responding" : item.streamState,
				}));
			}
			return {
				...state,
				activeAssistantMessageId: messageId,
				timeline: [
					...state.timeline,
					{
						kind: "assistant",
						id: messageId,
						text: "",
						parts: [],
						thinkingText: "",
						resultText: "",
						toolCallIds: [],
						lastToolCallId: undefined,
						isStreaming: true,
						streamState: "thinking",
					},
				],
			};
		}

		case "message_update": {
			const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (!ame) return state;
			const messageId = resolveMessageId(event) ?? state.activeAssistantMessageId;
			if (!messageId) return state;

			if (ame.type === "done" || ame.type === "error") {
				return updateAssistant(state, messageId, (item) => ({
					...item,
					isStreaming: false,
					streamState: "completed",
				}));
			}

			const isThinking = ame.type === "thinking_start" || ame.type === "thinking_delta";
			const streamState: TimelineAssistantItem["streamState"] = isThinking ? "thinking" : "responding";

			let nextState: WebviewState = { ...state, activeAssistantMessageId: messageId };
			if (isThinking) {
				nextState = { ...nextState, activeThinkingMessageId: messageId };
			} else if (ame.type === "thinking_end") {
				nextState = {
					...nextState,
					activeThinkingMessageId:
						state.activeThinkingMessageId === messageId ? undefined : state.activeThinkingMessageId,
				};
			}

			const message = event.message as Record<string, unknown> | undefined;
			const content = (message?.content ?? []) as Array<Record<string, unknown>>;

			return updateAssistant(nextState, messageId, (item) => syncPartsFromSnapshot(item, content, streamState));
		}

		case "message_end": {
			const message = event.message as Record<string, unknown> | undefined;
			if (!message || message.role !== "assistant") return state;
			const messageId = resolveMessageId(event) ?? state.activeAssistantMessageId;
			if (!messageId) return state;
			const content = (message.content ?? []) as Array<Record<string, unknown>>;
			const hasToolCalls = content.some((b) => b.type === "toolCall");
			return updateAssistant(
				{
					...state,
					activeAssistantMessageId: hasToolCalls
						? state.activeAssistantMessageId
						: state.activeAssistantMessageId === messageId
							? undefined
							: state.activeAssistantMessageId,
					activeThinkingMessageId:
						state.activeThinkingMessageId === messageId ? undefined : state.activeThinkingMessageId,
				},
				messageId,
				(item) => ({
					...(content.length > 0 ? syncPartsFromSnapshot(item, content, "completed") : item),
					isStreaming: false,
					streamState: "completed" as const,
				}),
			);
		}

		case "tool_execution_start": {
			const toolCallId = event.toolCallId as string;
			const toolName = event.toolName as string;
			const summary = summarizeToolData(event.args);
			const assistantMessageId = state.activeAssistantMessageId;
			const baseState: WebviewState = {
				...state,
				status: "running-tools",
				activeToolCallIds: [...state.activeToolCallIds, toolCallId],
			};
			if (!assistantMessageId) {
				return {
					...baseState,
					timeline: [
						...baseState.timeline,
						{
							kind: "tool",
							id: toolCallId,
							toolName,
							summary,
							output: "",
							state: "running",
							isExpanded: false,
							startedAt: Date.now(),
						} satisfies TimelineToolItem,
					],
				};
			}
			return updateAssistant(baseState, assistantMessageId, (item) => ({
				...appendToolPart(item, toolCallId, toolName),
				streamState: "responding",
			}));
		}

		case "tool_execution_update": {
			const toolCallId = event.toolCallId as string;
			const summary = summarizeToolData(event.partialResult);
			return {
				...state,
				timeline: state.timeline.map((item) => {
					if (item.kind === "tool" && item.id === toolCallId) {
						return { ...item, summary: summary ?? item.summary } satisfies TimelineToolItem;
					}
					if (item.kind === "assistant") {
						return updateToolPart(item, toolCallId, (part) => ({
							...part,
							summary: summary ?? part.summary,
						}));
					}
					return item;
				}),
			};
		}

		case "tool_execution_end": {
			const toolCallId = event.toolCallId as string;
			const isError = event.isError === true;
			const summary = summarizeToolData(event.result);
			const activeToolCallIds = state.activeToolCallIds.filter((id) => id !== toolCallId);
			const nextStatus: ChatStatus = activeToolCallIds.length > 0 ? "running-tools" : "thinking";
			return {
				...state,
				activeToolCallIds,
				status: nextStatus,
				timeline: state.timeline.map((item) => {
					if (item.kind === "tool" && item.id === toolCallId) {
						return {
							...item,
							summary: summary ?? item.summary,
							state: isError ? "error" : "success",
							finishedAt: Date.now(),
						} satisfies TimelineToolItem;
					}
					if (item.kind === "assistant") {
						return updateToolPart(item, toolCallId, (part) => ({
							...part,
							summary: summary ?? part.summary,
							state: isError ? "error" : "success",
							finishedAt: Date.now(),
						}));
					}
					return item;
				}),
			};
		}

		case "auto_compaction_start":
			return upsertSystem(state, "auto-compaction", "Compacting context...", "info");

		case "auto_compaction_end":
			return removeSystem(state, "auto-compaction");

		case "auto_retry_start": {
			const cleaned = state.timeline.filter((item) => {
				if (item.kind !== "assistant") return true;
				const hasContent = item.parts.some(
					(p) =>
						p.kind === "tool" || (p.kind === "text" && p.text.trim()) || (p.kind === "thinking" && p.text.trim()),
				);
				return hasContent;
			});
			return upsertSystem(
				{ ...state, timeline: cleaned },
				"auto-retry",
				`Retrying (attempt ${String(event.attempt)}/${String(event.maxAttempts)})...`,
				"info",
			);
		}

		case "auto_retry_end":
			return removeSystem(state, "auto-retry");

		default:
			return state;
	}
}

export function reduceState(state: WebviewState, action: WebviewAction): WebviewState {
	switch (action.type) {
		case "setView":
			return { ...state, view: action.view };
		case "setDraft":
			return { ...state, draft: action.draft };
		case "setChatFontSize":
			return { ...state, chatFontSize: Math.min(18, Math.max(11, Math.round(action.value))) };
		case "setContextPills":
			return { ...state, contextPills: action.pills };
		case "setAutoCurrentFile":
			return { ...state, autoCurrentFile: action.value };
		case "setAutoSelection":
			return { ...state, autoSelection: action.value };
		case "setBackendState":
			return { ...state, backendState: action.backendState };
		case "setRpcState":
			return { ...state, rpcState: action.rpcState };
		case "toggleToolExpanded":
			return {
				...state,
				timeline: state.timeline.map((item) => {
					if (item.kind === "tool" && item.id === action.toolCallId) {
						return { ...item, isExpanded: !item.isExpanded } satisfies TimelineToolItem;
					}
					if (item.kind === "assistant") {
						return {
							...item,
							parts: item.parts.map((part) =>
								part.kind === "tool" && part.toolCallId === action.toolCallId
									? { ...part, isExpanded: !part.isExpanded }
									: part,
							),
						} satisfies TimelineAssistantItem;
					}
					return item;
				}),
			};
		case "appendUserPrompt":
			return {
				...state,
				draft: "",
				timeline: [
					...state.timeline,
					{ kind: "user", id: action.id, text: action.text, context: action.context ?? [] },
				],
			};
		case "applyAgentEvent":
			return reduceAgentEvent(state, action.event);
		case "setInitialState": {
			const rpcState = action.state;
			const model = rpcState.model as Record<string, unknown> | undefined;
			const modelLabel = model ? `${model.provider}/${model.id}` : undefined;
			return {
				...state,
				connectionState: "connected",
				rpcState: "connected",
				backendState: "running",
				sessionId: typeof rpcState.sessionId === "string" ? rpcState.sessionId : state.sessionId,
				model: modelLabel ?? state.model,
				status: rpcState.isStreaming ? "thinking" : "ready",
			};
		}
		case "setModels":
			return { ...state, availableModels: action.models };
		case "loadMessages":
			return {
				...state,
				timeline: messagesToTimeline(action.messages),
				activeAssistantMessageId: undefined,
				activeThinkingMessageId: undefined,
				activeToolCallIds: [],
				status: "ready",
			};
		case "reset":
			return {
				...createInitialState(),
				connectionState: state.connectionState,
				rpcState: state.rpcState,
				backendState: state.backendState,
				model: state.model,
				availableModels: state.availableModels,
				sessionId: state.sessionId,
				contextPills: state.contextPills,
				autoCurrentFile: state.autoCurrentFile,
				autoSelection: state.autoSelection,
			};
		default:
			return state;
	}
}

export function derivePromptContext(state: WebviewState): PromptContext {
	const workspace = state.contextPills.find((pill) => pill.kind === "workspace");
	const currentFile = state.autoCurrentFile
		? state.contextPills.find((pill) => pill.kind === "current-file")
		: undefined;
	const selection = state.autoSelection ? state.contextPills.find((pill) => pill.kind === "selection") : undefined;
	return {
		workspacePath: workspace?.kind === "workspace" ? workspace.workspacePath : undefined,
		currentFile:
			currentFile && currentFile.kind === "current-file"
				? { path: currentFile.path, language: currentFile.language }
				: undefined,
		selection:
			selection && selection.kind === "selection"
				? { path: selection.path, text: selection.text, startLine: selection.startLine, endLine: selection.endLine }
				: undefined,
	};
}

export function mapHostContextToPills(context: PromptContext): ContextPill[] {
	const pills: ContextPill[] = [];
	if (context.workspacePath) {
		pills.push({ kind: "workspace", label: "Workspace", workspacePath: context.workspacePath });
	}
	if (context.currentFile) {
		pills.push({
			kind: "current-file",
			label: context.currentFile.path.split("/").pop() ?? context.currentFile.path,
			path: context.currentFile.path,
			language: context.currentFile.language,
		});
	}
	if (context.selection) {
		pills.push({
			kind: "selection",
			label: `${context.selection.path.split("/").pop() ?? context.selection.path}:${context.selection.startLine ?? "?"}`,
			path: context.selection.path,
			text: context.selection.text,
			startLine: context.selection.startLine,
			endLine: context.selection.endLine,
		});
	}
	return pills;
}

export function setConnectionState(state: WebviewState, connectionState: ConnectionState): WebviewState {
	return { ...state, connectionState };
}

export function deriveConnectionLabel(connectionState: ConnectionState, status: ChatStatus): string {
	if (connectionState === "error") return "Connection error";
	if (connectionState === "connecting") return "Connecting";
	if (status === "thinking") return "Thinking";
	if (status === "running-tools") return "Running tools";
	return "Connected";
}

const AGENT_EVENT_TYPES = new Set([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"auto_compaction_start",
	"auto_compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

export function isAgentEvent(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const type = (value as Record<string, unknown>).type;
	return typeof type === "string" && AGENT_EVENT_TYPES.has(type);
}
