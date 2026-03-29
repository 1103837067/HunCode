import * as React from "react";
import { ChevronDown } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage.js";

function extractThinkingHeading(text: string): string | undefined {
	const markdown = text.replace(/\r\n?/g, "\n");
	const headings: string[] = [];

	for (const match of markdown.matchAll(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/gm)) {
		const cleaned = match[1]?.replace(/[*_~`]+/g, "").trim();
		if (cleaned) headings.push(cleaned);
	}
	if (headings.length > 0) return headings[headings.length - 1];

	for (const match of markdown.matchAll(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/gm)) {
		const cleaned = match[1]?.replace(/[*_~`]+/g, "").trim();
		if (cleaned) headings.push(cleaned);
	}
	if (headings.length > 0) return headings[headings.length - 1];

	return undefined;
}

export function ThinkingBlock({
	preview,
	text,
	isStreaming,
	expanded,
	onToggle,
	scrollRef,
}: {
	preview: string;
	text: string;
	isStreaming: boolean;
	expanded: boolean;
	onToggle: () => void;
	scrollRef: React.RefObject<HTMLDivElement>;
}) {
	const heading = React.useMemo(() => extractThinkingHeading(text), [text]);
	const statusLabel = isStreaming ? "Thinking..." : "Thought process";

	if (!text.trim() && !isStreaming) return null;

	return (
		<div className="my-0.5">
			<button
				type="button"
				onClick={onToggle}
				className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-colors duration-150 hover:text-muted-foreground/70 select-none"
			>
				{isStreaming ? (
					<span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-[var(--vscode-progressBar-background,#4f8cff)]/30 border-t-[var(--vscode-progressBar-background,#4f8cff)]" />
				) : (
					<ChevronDown
						className={`h-3 w-3 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
					/>
				)}
				<span>{statusLabel}</span>
				{heading ? (
					<>
						<span className="text-muted-foreground/20">·</span>
						<span className="max-w-[200px] truncate">{heading}</span>
					</>
				) : preview ? (
					<>
						<span className="text-muted-foreground/20">·</span>
						<span className="max-w-[200px] truncate">{preview}</span>
					</>
				) : null}
			</button>
			<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${expanded ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"}`}
			>
				<div
					ref={scrollRef}
					className="mt-1 max-h-[200px] overflow-y-auto border-l border-muted-foreground/10 pl-4 text-[11px] leading-relaxed text-muted-foreground/60"
				>
					<MarkdownMessage content={text} />
				</div>
			</div>
		</div>
	);
}

export function getThinkingPreview(text: string, fallback: string): string {
	const trimmed = text.trim();
	if (!trimmed) return fallback;
	const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
	return (lines.length > 0 ? lines[lines.length - 1] : trimmed).trim();
}
