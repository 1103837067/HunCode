import * as React from "react";
import type { TimelineAssistantItem, TimelineAssistantPart, TimelineItem, TimelineToolItem } from "../types/ui.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { ThinkingBlock, getThinkingPreview } from "./ThinkingBlock.js";
import { ToolStepCard } from "./ToolStepCard.js";
import { UserMessageCard } from "./UserMessageCard.js";
import { buildRenderRows } from "./chat-timeline-model.js";

function AssistantFlowShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative flex flex-col items-start">
			<div className="flex w-full max-w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border/30 bg-card/30">
				<div className="flex w-full max-w-full min-w-0 flex-col gap-3 overflow-hidden p-2">{children}</div>
			</div>
		</div>
	);
}

function AssistantLoadingIndicator() {
	return (
		<div className="pl-2">
			<div className="inline-block h-3 w-3 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
		</div>
	);
}

function ThinkingPartView({ text, isStreaming }: { text: string; isStreaming: boolean }) {
	const [expanded, setExpanded] = React.useState(isStreaming);
	const previousStreamingRef = React.useRef(isStreaming);
	const scrollRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (isStreaming && !previousStreamingRef.current) {
			setExpanded(true);
		}
		if (!isStreaming && previousStreamingRef.current) {
			setExpanded(false);
		}
		previousStreamingRef.current = isStreaming;
	}, [isStreaming]);

	return (
		<ThinkingBlock
			preview={getThinkingPreview(text, "Thinking...")}
			text={text}
			isStreaming={isStreaming}
			expanded={expanded}
			onToggle={() => setExpanded((value) => !value)}
			scrollRef={scrollRef}
		/>
	);
}

function renderAssistantPart(part: TimelineAssistantPart, isStreaming: boolean, onToggleTool: (toolCallId: string) => void) {
	if (part.kind === "thinking") {
		if (!part.text.trim()) return null;
		return <ThinkingPartView key={part.id} text={part.text} isStreaming={isStreaming} />;
	}

	if (part.kind === "tool") {
		const toolItem: TimelineToolItem = part;
		return <ToolStepCard key={part.id} item={toolItem} onToggle={onToggleTool} compact />;
	}

	if (!part.text.trim()) return null;
	return (
		<div key={part.id} className="w-full min-w-0 max-w-full overflow-hidden text-foreground message-text">
			<MarkdownMessage content={part.text} />
		</div>
	);
}

function AssistantFlowGroup({
	assistant,
	onToggleTool,
}: {
	assistant: TimelineAssistantItem;
	onToggleTool: (toolCallId: string) => void;
}) {
	const assistantParts = assistant.parts ?? [];
	const visibleParts = assistantParts
		.map((part) => renderAssistantPart(part, assistant.isStreaming && assistant.streamState === "thinking", onToggleTool))
		.filter(Boolean);
	const showBottomLoading = assistant.isStreaming && visibleParts.length === 0;

	if (visibleParts.length === 0 && !showBottomLoading) return null;

	return (
		<div className="px-3 py-1.5">
			<AssistantFlowShell>
				{visibleParts}
				{showBottomLoading ? <AssistantLoadingIndicator /> : null}
			</AssistantFlowShell>
		</div>
	);
}

export function ChatTimeline({
	timeline,
	onToggleTool,
}: {
	timeline: TimelineItem[];
	onToggleTool: (toolCallId: string) => void;
}) {
	const rows = React.useMemo(() => buildRenderRows(timeline), [timeline]);

	return (
		<div className="space-y-3">
			{rows.map((row) => {
				if (row.kind === "user") return <UserMessageCard key={row.key} item={row.item} />;
				if (row.kind === "system") return <SystemMessage key={row.key} item={row.item} />;
				if (row.kind === "tool") return <ToolStepCard key={row.key} item={row.item} onToggle={onToggleTool} compact />;
				return <AssistantFlowGroup key={row.key} assistant={row.assistant} onToggleTool={onToggleTool} />;
			})}
		</div>
	);
}
