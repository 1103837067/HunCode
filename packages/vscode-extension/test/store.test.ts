import { describe, expect, it } from "vitest";
import { appendUserPrompt, createInitialState, reduceAgentEvent } from "../src/webview/state/store.js";

describe("webview store", () => {
	it("adds a user prompt to the timeline", () => {
		const state = createInitialState();
		const next = appendUserPrompt(state, { id: "u1", text: "hello" });
		expect(next.timeline[0]).toEqual(
			expect.objectContaining({
				kind: "user",
				text: "hello",
			}),
		);
	});

	it("creates and appends assistant deltas via agent events", () => {
		let state = createInitialState();
		state = reduceAgentEvent(state, { type: "agent_start" });
		state = reduceAgentEvent(state, { type: "message_start", message: { id: "m1", role: "assistant" } });
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: { id: "m1" },
			assistantMessageEvent: { type: "text_delta", delta: "hi" },
		});
		state = reduceAgentEvent(state, {
			type: "message_update",
			message: { id: "m1" },
			assistantMessageEvent: { type: "text_delta", delta: " there" },
		});
		expect(state.timeline[0]).toEqual(
			expect.objectContaining({
				kind: "assistant",
				id: "m1",
				text: "hi there",
			}),
		);
	});

	it("adds and finalizes tool cards", () => {
		let state = createInitialState();
		state = reduceAgentEvent(state, { type: "agent_start" });
		state = reduceAgentEvent(state, {
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "read",
		});
		state = reduceAgentEvent(state, {
			type: "tool_execution_update",
			toolCallId: "t1",
			partialResult: "reading more",
		});
		state = reduceAgentEvent(state, { type: "tool_execution_end", toolCallId: "t1", isError: false, result: "done" });
		const toolItem = state.timeline.find((item) => item.kind === "tool" && item.id === "t1");
		expect(toolItem).toEqual(
			expect.objectContaining({
				kind: "tool",
				id: "t1",
				state: "success",
				summary: "done",
			}),
		);
	});

	it("updates status from agent events", () => {
		let state = createInitialState();
		state = reduceAgentEvent(state, { type: "agent_start" });
		expect(state.status).toBe("thinking");
		state = reduceAgentEvent(state, { type: "agent_end" });
		expect(state.status).toBe("ready");
	});
});
