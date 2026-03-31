import * as React from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { cn } from "../lib/cn.js";
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

// ============================================================================
// Streaming Content with Shimmer
// ============================================================================

function ShimmerBar({ progress }: { progress: number }) {
	return (
		<div className="relative h-[2px] w-full overflow-hidden rounded-full bg-[var(--vscode-widget-border)]">
			<div
				className="absolute inset-y-0 left-0 bg-purple-400/60 transition-all duration-150"
				style={{ width: `${progress}%` }}
			/>
			<div
				className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/40 to-transparent"
				style={{
					animation: "shimmer-sweep 1.5s ease-in-out infinite",
				}}
			/>
		</div>
	);
}

function StreamingContent({ text }: { text: string }) {
	const [displayedContent, setDisplayedContent] = React.useState("");
	const contentRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!text) {
			setDisplayedContent("");
			return;
		}

		let currentIndex = 0;
		const charsToAdd = Math.min(3, text.length);

		const interval = setInterval(() => {
			if (currentIndex < text.length) {
				currentIndex += charsToAdd;
				setDisplayedContent(text.slice(0, currentIndex));
			} else {
				clearInterval(interval);
			}
		}, 15);

		return () => clearInterval(interval);
	}, [text]);

	React.useEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight;
		}
	}, [displayedContent]);

	const progress = text.length > 0 ? (displayedContent.length / text.length) * 100 : 0;

	return (
		<div className="mt-1">
			<ShimmerBar progress={progress} />
			<div
				ref={contentRef}
				className="mt-1 max-h-20 overflow-y-auto text-[10px] leading-relaxed text-[var(--vscode-editor-foreground)] opacity-70"
			>
				{displayedContent}
				{displayedContent.length < text.length && (
					<span className="inline-block h-3 w-1 animate-pulse bg-purple-400" />
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Thinking Block Component - Lightweight Style
// ============================================================================

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
			{/* Header Row */}
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-1.5 py-0.5 text-left transition-colors duration-150 hover:text-[var(--vscode-editor-foreground)]"
			>
				{isStreaming ? (
					<Lightbulb className="h-3 w-3 flex-shrink-0 text-purple-400" />
				) : (
					<ChevronDown
						className={cn(
							"h-3 w-3 flex-shrink-0 transition-transform duration-200",
							expanded ? "rotate-180" : "",
							"text-[var(--vscode-editor-foreground)] opacity-40",
						)}
					/>
				)}

				<span
					className={cn(
						"text-[11px]",
						isStreaming ? "text-purple-400" : "text-[var(--vscode-editor-foreground)] opacity-50",
					)}
				>
					{statusLabel}
				</span>

				{(heading || preview) && (
					<>
						<span className="text-[var(--vscode-editor-foreground)] opacity-20">·</span>
						<span className="max-w-[180px] truncate text-[11px] text-[var(--vscode-editor-foreground)] opacity-40">
							{heading || preview}
						</span>
					</>
				)}

				{isStreaming && (
					<span className="ml-1 flex gap-0.5">
						<span className="h-1 w-1 animate-pulse rounded-full bg-purple-400" />
						<span className="h-1 w-1 animate-pulse rounded-full bg-purple-400 [animation-delay:150ms]" />
						<span className="h-1 w-1 animate-pulse rounded-full bg-purple-400 [animation-delay:300ms]" />
					</span>
				)}
			</button>

			{/* Content */}
			<div
				className={cn(
					"overflow-hidden transition-all duration-200 ease-in-out",
					expanded || isStreaming ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0",
				)}
			>
				{isStreaming ? (
					<StreamingContent text={text} />
				) : (
					<div
						ref={scrollRef}
						className="mt-1 max-h-[200px] overflow-y-auto border-l border-[var(--vscode-widget-border)] pl-3 text-[11px] leading-relaxed text-[var(--vscode-editor-foreground)] opacity-70"
					>
						<MarkdownMessage content={text} />
					</div>
				)}
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
