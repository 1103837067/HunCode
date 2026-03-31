import { describe, expect, it } from "vitest";
import { createInitialState, reduceAgentEvent, reduceState } from "./state.js";

describe("reduceAgentEvent", () => {
	it("agent_start sets status to thinking", () => {
		const state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		expect(state.status).toBe("thinking");
		expect(state.connectionState).toBe("connected");
	});

	it("agent_end resets status to ready", () => {
		const started = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		const ended = reduceAgentEvent(started, { type: "agent_end" });
		expect(ended.status).toBe("ready");
		expect(ended.activeAssistantMessageId).toBeUndefined();
	});

	it("message_start creates a streaming assistant entry", () => {
		const started = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		const state = reduceAgentEvent(started, {
			type: "message_start",
			message: { id: "msg-1", role: "assistant" },
		});
		expect(state.activeAssistantMessageId).toBe("msg-1");
		expect(state.timeline).toHaveLength(1);
		expect(state.timeline[0]).toMatchObject({
			kind: "assistant",
			id: "msg-1",
			isStreaming: true,
		});
	});

	it("message_update with text_delta appends text", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "message_start", message: { id: "msg-1", role: "assistant" } });
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: {
				id: "msg-1",
				content: [{ type: "text", text: "Hello " }],
			},
			assistantMessageEvent: { type: "text_delta", delta: "Hello " },
		});
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: {
				id: "msg-1",
				content: [{ type: "text", text: "Hello world" }],
			},
			assistantMessageEvent: { type: "text_delta", delta: "world" },
		});
		if (state.timeline[0]?.kind !== "assistant") throw new Error("expected assistant");
		expect(state.timeline[0].text).toBe("Hello world");
	});

	it("message_update with thinking_delta appends thinking", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "message_start", message: { id: "msg-1", role: "assistant" } });
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: {
				id: "msg-1",
				content: [{ type: "thinking", thinking: "Thinking..." }],
			},
			assistantMessageEvent: { type: "thinking_delta", delta: "Thinking..." },
		});
		if (state.timeline[0]?.kind !== "assistant") throw new Error("expected assistant");
		expect(state.timeline[0].thinkingText).toBe("Thinking...");
	});

	it("message_update creates a missing assistant entry when start was not received", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: {
				id: "msg-1",
				content: [{ type: "text", text: "Recovered output" }],
			},
			assistantMessageEvent: { type: "text_delta", delta: "Recovered output" },
		});
		expect(state.activeAssistantMessageId).toBe("msg-1");
		expect(state.timeline).toHaveLength(1);
		if (state.timeline[0]?.kind !== "assistant") throw new Error("expected assistant");
		expect(state.timeline[0]).toMatchObject({
			id: "msg-1",
			text: "Recovered output",
			isStreaming: true,
			streamState: "responding",
		});
	});

	it("message_end finalizes the assistant message", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "message_start", message: { id: "msg-1", role: "assistant" } });
		state = reduceAgentEvent(state, { type: "message_end", message: { id: "msg-1", role: "assistant" } });
		if (state.timeline[0]?.kind !== "assistant") throw new Error("expected assistant");
		expect(state.timeline[0].isStreaming).toBe(false);
		expect(state.timeline[0].streamState).toBe("completed");
	});

	it("tool_execution_start adds a tool entry", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "message_start", message: { id: "msg-1", role: "assistant" } });
		state = reduceAgentEvent(state, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read" });
		expect(state.status).toBe("running-tools");
		expect(state.activeToolCallIds).toContain("tc-1");
	});

	it("tool_execution_start does not duplicate active tool ids", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read" });
		state = reduceAgentEvent(state, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read" });
		expect(state.activeToolCallIds).toEqual(["tc-1"]);
	});

	it("tool_execution_end marks tool as success/error", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read" });
		state = reduceAgentEvent(state, {
			type: "tool_execution_end",
			toolCallId: "tc-1",
			result: "done",
			isError: false,
		});
		expect(state.activeToolCallIds).not.toContain("tc-1");
	});
});

describe("toggleToolExpanded", () => {
	it("toggles tool isExpanded via reduceState", () => {
		let state = reduceAgentEvent(createInitialState(), { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read" });
		const next = reduceState(state, { type: "toggleToolExpanded", toolCallId: "tc-1" });
		const toolItem = next.timeline.find((item) => item.kind === "tool" && item.id === "tc-1");
		expect(toolItem).toBeDefined();
		if (toolItem?.kind === "tool") {
			expect(toolItem.isExpanded).toBe(true);
		}
	});
});
