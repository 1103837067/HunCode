import { describe, expect, it } from "vitest";
import type { TimelineAssistantItem, TimelineToolItem } from "../types/ui.js";
import { buildAssistantFlowState, buildRenderRows } from "./chat-timeline-model.js";

function assistant(overrides: Partial<TimelineAssistantItem> = {}): TimelineAssistantItem {
	return {
		kind: "assistant",
		id: "assistant-1",
		text: "",
		parts: [],
		isStreaming: false,
		streamState: "completed",
		...overrides,
	};
}

function orphanTool(id: string, overrides: Partial<TimelineToolItem> = {}): TimelineToolItem {
	return {
		kind: "tool",
		id,
		toolName: `tool-${id}`,
		summary: id,
		output: "",
		state: "success",
		isExpanded: false,
		...overrides,
	};
}

describe("buildRenderRows", () => {
	it("keeps orphan tool rows visible", () => {
		const rows = buildRenderRows([orphanTool("t1")]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "tool", key: "t1" });
	});

	it("creates assistant-group rows for assistants", () => {
		const rows = buildRenderRows([assistant({ id: "a1" })]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "assistant-group", key: "a1" });
	});
});

describe("buildAssistantFlowState", () => {
	it("preserves assistant part order", () => {
		const flow = buildAssistantFlowState(
			assistant({
				parts: [
					{ kind: "thinking", id: "p1", text: "think" },
					{
						kind: "tool",
						id: "p2",
						toolCallId: "call1",
						toolName: "read",
						output: "",
						state: "success",
						isExpanded: false,
					},
					{ kind: "text", id: "p3", text: "done" },
				],
			}),
		);
		expect(flow.parts).toHaveLength(3);
		expect(flow.parts[0]).toMatchObject({ kind: "thinking", id: "p1" });
		expect(flow.parts[1]).toMatchObject({ kind: "tool", id: "p2" });
		expect(flow.parts[2]).toMatchObject({ kind: "text", id: "p3" });
		expect(flow.lastActivePartIndex).toBe(2);
	});

	it("ignores empty text parts", () => {
		const flow = buildAssistantFlowState(
			assistant({
				parts: [
					{ kind: "thinking", id: "p1", text: "" },
					{ kind: "text", id: "p2", text: "answer" },
				],
			}),
		);
		expect(flow.parts).toHaveLength(1);
		expect(flow.lastActivePartIndex).toBe(0);
	});

	it("returns -1 when there is no visible part", () => {
		const flow = buildAssistantFlowState(assistant({ parts: [] }));
		expect(flow.parts).toEqual([]);
		expect(flow.lastActivePartIndex).toBe(-1);
	});
});
