import {
	ChevronDown,
	CircleDotDashed,
	FileText,
	FolderSearch,
	Globe,
	Hammer,
	Wrench,
} from "lucide-react";
import { cn } from "../lib/cn.js";
import type { TimelineToolItem } from "../types/ui.js";
import { getToolRenderer } from "./tool-renderers.js";

type ToolKind = "file" | "search" | "command" | "resource" | "generic";

function getToolKind(toolName: string): ToolKind {
	if (["read", "write", "edit"].includes(toolName)) return "file";
	if (["grep", "find"].includes(toolName)) return "search";
	if (["bash"].includes(toolName)) return "command";
	if (/^(github|exa|web|context7|mcp)/.test(toolName)) return "resource";
	return "generic";
}

function getKindIcon(kind: ToolKind) {
	switch (kind) {
		case "file":
			return FileText;
		case "search":
			return FolderSearch;
		case "command":
			return Hammer;
		case "resource":
			return Globe;
		default:
			return Wrench;
	}
}

function formatDuration(item: TimelineToolItem): string | null {
	if (typeof item.startedAt !== "number") return null;
	const end = typeof item.finishedAt === "number" ? item.finishedAt : Date.now();
	const seconds = (end - item.startedAt) / 1000;
	if (seconds < 0.5) return null;
	if (seconds < 1) return "< 1s";
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

function formatInputSummary(summary: string | undefined): string {
	if (!summary) return "";
	try {
		const parsed = JSON.parse(summary);
		if (typeof parsed === "object" && parsed !== null) {
			return Object.entries(parsed)
				.map(([k, v]) => {
					const val = typeof v === "string" ? v : JSON.stringify(v);
					const short = val.length > 80 ? `${val.slice(0, 77)}...` : val;
					return `${k}: ${short}`;
				})
				.join("\n");
		}
	} catch {
		/* not JSON */
	}
	return summary;
}

function HeaderRow({
	item,
	kind,
	hasExpandableContent,
	onToggle,
}: {
	item: TimelineToolItem;
	kind: ToolKind;
	hasExpandableContent: boolean;
	onToggle: () => void;
}) {
	const KindIcon = getKindIcon(kind);
	const isRunning = item.state === "running";
	const duration = formatDuration(item);

	return (
		<div
			className={cn(
				"flex items-center gap-1.5 rounded-sm py-0.5 transition-colors duration-150",
				hasExpandableContent && "cursor-pointer hover:bg-muted/40",
				item.isExpanded && "bg-muted/20",
			)}
			onClick={() => {
				if (hasExpandableContent) onToggle();
			}}
		>
			{isRunning ? (
				<CircleDotDashed className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
			) : (
				<div
					className={cn(
						"h-1.5 w-1.5 rounded-full flex-shrink-0",
						item.state === "success"
							? "bg-[color:var(--vscode-testing-iconPassed)]"
							: "bg-[color:var(--vscode-errorForeground)]",
					)}
				/>
			)}
			{!isRunning ? <KindIcon className="h-3 w-3 text-muted-foreground/70 flex-shrink-0" /> : null}
			<span className={cn("truncate text-xs", isRunning ? "font-medium text-foreground" : "text-muted-foreground")}>
				{item.toolName}
			</span>
			<span className={cn("text-[10px] flex-shrink-0", isRunning ? "text-primary/70" : "text-muted-foreground/70")}>
				{isRunning ? "running" : item.state}
			</span>
			<div className="flex-1" />
			{duration && !isRunning ? (
				<span className="text-[10px] tabular-nums text-muted-foreground/50 flex-shrink-0">{duration}</span>
			) : null}
			{hasExpandableContent ? (
				<ChevronDown
					className={cn(
						"h-3 w-3 text-muted-foreground/50 transition-transform duration-200 flex-shrink-0",
						item.isExpanded && "rotate-180",
					)}
				/>
			) : null}
		</div>
	);
}

function ContentBlock({ label, children, mono }: { label: string; children: string; mono?: boolean }) {
	if (!children.trim()) return null;
	return (
		<div className="rounded-sm bg-muted/50 p-2">
			<div className="mb-1 text-[10px] font-medium text-muted-foreground/70">{label}</div>
			<div
				className={cn(
					"max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/85",
					mono && "font-mono",
				)}
			>
				{children}
			</div>
		</div>
	);
}

export function ToolStepCard({
	item,
	onToggle,
	compact = false,
	collapsed = false,
}: {
	item: TimelineToolItem;
	onToggle: (toolCallId: string) => void;
	compact?: boolean;
	collapsed?: boolean;
}) {
	const kind = getToolKind(item.toolName);
	const isRunning = item.state === "running";
	const renderer = getToolRenderer(item.rendererKey ?? item.toolName);
	const enhancedBody = renderer.kind === "enhanced" ? renderer.render(item) : null;
	const hasOutput = item.output.trim().length > 0;
	const hasExpandableContent = !isRunning && (hasOutput || !!enhancedBody || !!item.summary);

	if (!compact) {
		return (
			<div className="px-2 py-1.5">
				<div className="rounded-lg border border-border/70 bg-card/80 px-3 py-2 shadow-sm">
					<div className="text-xs text-muted-foreground">Compact assistant flow mode only.</div>
				</div>
			</div>
		);
	}

	const inputText = formatInputSummary(item.summary);

	return (
		<div className="w-full max-w-full px-1 py-0.5">
			<HeaderRow
				item={item}
				kind={kind}
				hasExpandableContent={hasExpandableContent}
				onToggle={() => onToggle(item.id)}
			/>
			{isRunning && inputText ? (
				<div className="ml-3 mt-0.5 pl-2 truncate text-[11px] text-muted-foreground/70">{inputText.split("\n")[0]}</div>
			) : null}
			{item.isExpanded && !isRunning ? (
				<div className="ml-3 mt-1 max-w-full space-y-1.5 pl-2">
					{enhancedBody ?? (
						<>
							{inputText ? <ContentBlock label="Input">{inputText}</ContentBlock> : null}
							<ContentBlock label="Output" mono>
								{item.output || "(no output)"}
							</ContentBlock>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
