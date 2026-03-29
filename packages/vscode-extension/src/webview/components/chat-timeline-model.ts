import type {
	TimelineAssistantItem,
	TimelineAssistantPart,
	TimelineItem,
	TimelineSystemItem,
	TimelineToolItem,
	TimelineUserItem,
} from "../types/ui.js";

export type RenderRow =
	| { kind: "user"; key: string; item: TimelineUserItem }
	| { kind: "system"; key: string; item: TimelineSystemItem }
	| { kind: "tool"; key: string; item: TimelineToolItem }
	| { kind: "assistant-group"; key: string; assistant: TimelineAssistantItem };

export type AssistantFlowPart =
	| { kind: "thinking"; id: string; text: string; isStreaming: boolean }
	| { kind: "tool"; id: string; part: Extract<TimelineAssistantPart, { kind: "tool" }> }
	| { kind: "text"; id: string; text: string; isStreaming: boolean };

export type AssistantFlowState = {
	parts: AssistantFlowPart[];
	lastActivePartIndex: number;
};

export function buildRenderRows(timeline: TimelineItem[]): RenderRow[] {
	const rows: RenderRow[] = [];

	for (const item of timeline) {
		if (item.kind === "user") {
			rows.push({ kind: "user", key: item.id, item });
			continue;
		}
		if (item.kind === "assistant") {
			rows.push({ kind: "assistant-group", key: item.id, assistant: item });
			continue;
		}
		if (item.kind === "tool") {
			rows.push({ kind: "tool", key: item.id, item });
			continue;
		}
		rows.push({ kind: "system", key: item.id, item });
	}

	return rows;
}

export function buildAssistantFlowState(assistant: TimelineAssistantItem): AssistantFlowState {
	const parts: AssistantFlowPart[] = [];
	const sourceParts = assistant.parts ?? [];

	for (const part of sourceParts) {
		if (part.kind === "thinking") {
			if (part.text.trim().length === 0) continue;
			parts.push({
				kind: "thinking",
				id: part.id,
				text: part.text,
				isStreaming: assistant.streamState === "thinking",
			});
			continue;
		}
		if (part.kind === "text") {
			if (part.text.trim().length === 0) continue;
			parts.push({
				kind: "text",
				id: part.id,
				text: part.text,
				isStreaming: assistant.streamState === "responding",
			});
			continue;
		}
		parts.push({ kind: "tool", id: part.id, part });
	}

	return {
		parts,
		lastActivePartIndex: parts.length > 0 ? parts.length - 1 : -1,
	};
}
