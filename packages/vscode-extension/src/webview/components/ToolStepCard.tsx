import {
	ChevronUp,
	FileText,
	FileSearch,
	FileCode,
	Image,
	Globe,
	Hammer,
	Terminal,
	Plus,
	Minus,
} from "lucide-react";
import { cn } from "../lib/cn.js";
import { postToHost } from "../lib/vscode-api.js";
import type { TimelineToolItem } from "../types/ui.js";
import * as React from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

// DevIcons for language-specific icons (using require due to no types field)
// @ts-ignore
import TypescriptPlainIcon from "react-devicons/typescript/plain";
// @ts-ignore
import JavascriptPlainIcon from "react-devicons/javascript/plain";
// @ts-ignore
import PythonOriginalIcon from "react-devicons/python/original";
// @ts-ignore
import GoPlainIcon from "react-devicons/go/plain";
// @ts-ignore
import JsonPlainIcon from "react-devicons/json/plain";
// @ts-ignore
import BashPlainIcon from "react-devicons/bash/plain";

// ============================================================================
// Types
// ============================================================================

type ToolStatus = "running" | "completed" | "error";

interface ToolStepCardProps {
	item: TimelineToolItem;
	onToggle: (toolCallId: string) => void;
	compact?: boolean;
	collapsed?: boolean;
	streamContent?: string;
	isStreaming?: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

function getToolKind(toolName: string): "file" | "search" | "command" | "resource" | "generic" {
	if (["read", "write", "edit"].includes(toolName)) return "file";
	if (["grep", "find", "search", "ls", "read_directory"].includes(toolName)) return "search";
	if (["bash", "shell", "command", "exec"].includes(toolName)) return "command";
	if (/^(github|exa|web|context7|mcp|http|fetch)/.test(toolName)) return "resource";
	return "generic";
}

/** Get preview content from tool args (for streaming display during execution) */
function getArgsPreviewContent(toolName: string, args?: Record<string, unknown>): string {
	if (!args) return "";

	if (toolName === "write") {
		// Show content being written (full content)
		const content = args.content as string | undefined;
		return content || "";
	}

	if (toolName === "edit") {
		// Show oldText and newText (full content)
		const parts: string[] = [];
		const oldText = args.oldText as string | undefined;
		const newText = args.newText as string | undefined;
		const edits = args.edits as Array<{ oldText?: string; newText?: string }> | undefined;

		if (edits && Array.isArray(edits)) {
			for (const edit of edits) {
				if (edit.oldText) {
					parts.push(`---\n${edit.oldText}`);
				}
				if (edit.newText) {
					parts.push(`+++\n${edit.newText}`);
				}
			}
		} else {
			if (oldText) {
				parts.push(`---\n${oldText}`);
			}
			if (newText) {
				parts.push(`+++\n${newText}`);
			}
		}
		return parts.join("\n");
	}

	return "";
}

function getFileTypeIcon(fileName: string | null | undefined): React.ComponentType<{ className?: string }> {
	if (!fileName) return FileText;

	const ext = fileName.split(".").pop()?.toLowerCase();
	switch (ext) {
		// TypeScript
		case "ts":
		case "tsx":
			return TypescriptPlainIcon as React.ComponentType<{ className?: string }>;
		// JavaScript
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
			return JavascriptPlainIcon as React.ComponentType<{ className?: string }>;
		// Python
		case "py":
		case "pyw":
			return PythonOriginalIcon as React.ComponentType<{ className?: string }>;
		// Go
		case "go":
			return GoPlainIcon as React.ComponentType<{ className?: string }>;
		// JSON
		case "json":
		case "jsonc":
			return JsonPlainIcon as React.ComponentType<{ className?: string }>;
		// Bash/Shell
		case "sh":
		case "bash":
		case "zsh":
		case "fish":
			return BashPlainIcon as React.ComponentType<{ className?: string }>;
		// Other code files
		case "rs":
		case "java":
		case "c":
		case "cpp":
		case "h":
		case "hpp":
			return FileCode;
		// Markdown/Text/Config
		case "md":
		case "mdx":
		case "txt":
		case "yaml":
		case "yml":
		case "toml":
		case "xml":
		case "html":
		case "css":
		case "scss":
		case "less":
			return FileText;
		// Images
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
		case "webp":
			return Image;
		// Default
		default:
			return FileText;
	}
}

function getKindIcon(kind: ReturnType<typeof getToolKind>, fileName?: string | null) {
	// For file tools with a specific file, use file type icon
	if (kind === "file" && fileName) {
		return getFileTypeIcon(fileName);
	}

	switch (kind) {
		case "file":
			return FileText;
		case "search":
			return FileSearch;
		case "command":
			return Terminal;
		case "resource":
			return Globe;
		default:
			return Hammer;
	}
}

function getToolStatus(item: TimelineToolItem): ToolStatus {
	if (item.state === "running") return "running";
	if (item.state === "error") return "error";
	return "completed";
}

function formatDuration(item: TimelineToolItem): string | null {
	if (typeof item.startedAt !== "number") return null;
	const end = typeof item.finishedAt === "number" ? item.finishedAt : Date.now();
	const seconds = (end - item.startedAt) / 1000;
	if (seconds < 0.5) return null;
	if (seconds < 1) return "<1s";
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

// ============================================================================
// Diff Utilities
// ============================================================================

interface DiffStats {
	additions: number;
	deletions: number;
}

interface EditToolDetails {
	diff?: string;
	firstChangedLine?: number;
}

function parseDiffStats(content: string): DiffStats {
	let additions = 0;
	let deletions = 0;
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) additions++;
		if (trimmed.startsWith("-") && !trimmed.startsWith("---")) deletions++;
	}
	return { additions, deletions };
}

function getDiffFromDetails(details?: Record<string, unknown>): string | undefined {
	if (!details) return undefined;
	return (details as EditToolDetails).diff;
}

function getFileNameFromArgs(args?: Record<string, unknown>): string | null {
	if (!args) return null;
	const path = args.path || args.file_path || args.file;
	if (typeof path === "string" && path) {
		return path.includes("/") ? path.split("/").pop()! : path;
	}
	return null;
}

function getFilePathFromArgs(args?: Record<string, unknown>): string | null {
	if (!args) return null;
	const path = args.path || args.file_path || args.file;
	if (typeof path === "string" && path) {
		return path;
	}
	return null;
}

function getCommandFromArgs(args?: Record<string, unknown>): string | null {
	if (!args) return null;
	const command = args.command || args.cmd || args.script;
	if (typeof command === "string" && command) {
		return command;
	}
	return null;
}

// ============================================================================
// Code Highlighting with Prism.js
// ============================================================================

function normalizeLanguage(language?: string): string {
	if (!language) return "text";
	const normalized = language.trim().toLowerCase();
	const aliases: Record<string, string> = {
		js: "javascript",
		ts: "typescript",
		sh: "bash",
		shell: "bash",
		yml: "yaml",
		md: "markdown",
		pyw: "python",
	};
	return aliases[normalized] ?? normalized;
}

function detectLanguage(fileName: string | null | undefined): string {
	if (!fileName) return "text";
	const ext = fileName.split(".").pop()?.toLowerCase();
	return normalizeLanguage(ext);
}

function highlightCode(code: string, language?: string): string {
	const normalizedLanguage = normalizeLanguage(language);
	const grammar = Prism.languages[normalizedLanguage];
	if (!grammar) {
		return code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}
	return Prism.highlight(code, grammar, normalizedLanguage);
}

// ============================================================================
// Diff Line Renderer
// ============================================================================

interface DiffLine {
	type: "add" | "delete" | "context" | "header" | "empty";
	content: string;
}

function parseDiffContent(content: string): DiffLine[] {
	const lines: DiffLine[] = [];
	const rawLines = content.split("\n");

	for (const line of rawLines) {
		const trimmed = line.trim();

		if (trimmed.startsWith("+++") || trimmed.startsWith("---")) {
			lines.push({ type: "header", content: line });
		} else if (trimmed.startsWith("@@")) {
			lines.push({ type: "header", content: line });
		} else if (trimmed.startsWith("diff ") || trimmed.startsWith("index ")) {
			lines.push({ type: "header", content: line });
		} else if (trimmed.startsWith("+")) {
			lines.push({ type: "add", content: line });
		} else if (trimmed.startsWith("-")) {
			lines.push({ type: "delete", content: line });
		} else if (line.trim() === "") {
			lines.push({ type: "empty", content: " " });
		} else {
			lines.push({ type: "context", content: line });
		}
	}

	return lines;
}

// ============================================================================
// Collapsible Content with Diff Highlighting
// ============================================================================

interface CollapsibleContentProps {
	content: string;
	isDiff?: boolean;
	isExpanded: boolean;
	onToggle: () => void;
	maxLines?: number;
	/** If true, show fixed height window that scrolls to show latest content */
	isStreaming?: boolean;
	/** Language for syntax highlighting */
	language?: string;
}

function CollapsibleContent({ content, isDiff = false, isExpanded, onToggle, isStreaming = false, language = "text" }: CollapsibleContentProps) {
	const MIN_LINES = 5;
	const LINE_HEIGHT = 18;
	const contentRef = React.useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when streaming
	React.useEffect(() => {
		if (isStreaming && contentRef.current) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight;
		}
	}, [content, isStreaming]);

	const diffLines = isDiff ? parseDiffContent(content) : null;
	const rawLines = content.split("\n");
	const totalLines = diffLines || rawLines;

	// When streaming: show fixed height window, scrolled to bottom (shows latest lines)
	// When expanded: show all lines
	// When collapsed: show first MIN_LINES
	const visibleLines = isStreaming
		? totalLines  // Show all, but container has fixed height and scrolls to bottom
		: isExpanded
			? totalLines
			: [
					...totalLines.slice(0, MIN_LINES),
					...Array(Math.max(0, MIN_LINES - totalLines.length)).fill(null),
				];
	const hasMore = totalLines.length > MIN_LINES && !isStreaming;

	const renderLine = (line: DiffLine | string | null, index: number) => {
		if (line === null) {
			return <div key={index} className="h-[18px]" />;
		}

		// Diff rendering
		if (isDiff && diffLines) {
			const diffLine = line as DiffLine;
			const bgClass =
				diffLine.type === "add"
					? "bg-green-900/30"
					: diffLine.type === "delete"
						? "bg-red-900/30"
						: diffLine.type === "header"
							? "bg-blue-900/20"
							: "";

			// Get raw content without +/-
			let rawContent = diffLine.content;
			if (diffLine.type === "add" || diffLine.type === "delete") {
				rawContent = diffLine.content.replace(/^[+\-]/, "");
			}

			// Filter out ... lines
			if (rawContent.trim() === "...") {
				return <div key={index} className="h-[18px]" />;
			}

			return (
				<div key={index} className={cn("flex h-[18px] items-center font-mono text-[10px] leading-relaxed whitespace-pre", bgClass)}>
					<span className="w-4 flex-shrink-0 select-none text-center text-[var(--vscode-editor-foreground)] opacity-40">
						{diffLine.type === "add" ? "+" : diffLine.type === "delete" ? "-" : " "}
					</span>
					<span
						className="text-[var(--vscode-editor-foreground)] opacity-80"
						dangerouslySetInnerHTML={{ __html: highlightCode(rawContent || " ", language) }}
					/>
				</div>
			);
		}

		// Regular rendering with basic highlighting
		const rawLine = line as string;
		return (
			<div
				key={index}
				className="flex h-[18px] items-center font-mono text-[10px] leading-relaxed text-[var(--vscode-editor-foreground)] opacity-60 whitespace-pre"
				dangerouslySetInnerHTML={{ __html: highlightCode(rawLine, language) }}
			/>
		);
	};

	return (
		<div className="relative">
			<div
				ref={contentRef}
				className="overflow-auto"
				style={isStreaming ? { height: `${MIN_LINES * LINE_HEIGHT}px` } : !isExpanded ? { height: "90px" } : undefined}
			>
				{visibleLines.map((line, index) => renderLine(line, index))}

				{/* Shadow overlay - only when collapsed (showing top) */}
				{!isStreaming && !isExpanded && hasMore && (
					<div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--vscode-editor-background)] to-transparent pointer-events-none" />
				)}
			</div>

			{/* Collapse button */}
			{!isStreaming && isExpanded && hasMore && (
				<div className="absolute bottom-1 right-1">
					<button
						type="button"
						onClick={onToggle}
						className="flex items-center gap-0.5 rounded bg-[var(--vscode-editorWidget-background)] px-1 py-0.5 text-[9px] text-[var(--vscode-editor-foreground)] opacity-50 transition-opacity hover:opacity-80"
					>
						<ChevronUp className="h-3 w-3" />
					</button>
				</div>
			)}

			{/* Expand indicator */}
			{!isStreaming && !isExpanded && hasMore && (
				<div
					className="absolute bottom-0 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 text-[var(--vscode-editor-foreground)] opacity-40 transition-opacity hover:opacity-70"
					onClick={onToggle}
				>
					<ChevronUp className="h-3 w-3" />
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Stream Content
// ============================================================================

function StreamContent({ content, isExpanded = false, onToggle }: { content: string; isExpanded?: boolean; onToggle?: () => void }) {
	const [displayedContent, setDisplayedContent] = React.useState("");
	const contentRef = React.useRef<HTMLDivElement>(null);
	const MIN_LINES = 5;

	React.useEffect(() => {
		if (!content) {
			setDisplayedContent("");
			return;
		}

		let currentIndex = 0;
		const charsToAdd = Math.min(3, content.length);

		const interval = setInterval(() => {
			if (currentIndex < content.length) {
				currentIndex += charsToAdd;
				setDisplayedContent(content.slice(0, currentIndex));
			} else {
				clearInterval(interval);
			}
		}, 15);

		return () => clearInterval(interval);
	}, [content]);

	React.useEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight;
		}
	}, [displayedContent]);

	const lines = displayedContent.split("\n");
	const hasMore = lines.length > MIN_LINES;
	const displayLines = !isExpanded
		? [...lines.slice(0, MIN_LINES), ...Array(Math.max(0, MIN_LINES - lines.length)).fill(" ")]
		: lines;

	return (
		<div className="relative">
			<div
				ref={contentRef}
				className={cn(
					"overflow-auto font-mono text-[10px] leading-relaxed text-[var(--vscode-editor-foreground)] opacity-80 whitespace-pre",
					isExpanded && "scroll-smooth",
				)}
				style={!isExpanded ? { height: "90px" } : undefined}
			>
				{displayLines.map((line, index) => (
					<div key={index} className="h-[18px]" dangerouslySetInnerHTML={{ __html: highlightCode(line) }} />
				))}
			</div>

			{!isExpanded && hasMore && (
				<div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--vscode-editor-background)] to-transparent pointer-events-none" />
			)}

			{isExpanded && hasMore && onToggle && (
				<div className="absolute bottom-1 right-1">
					<button
						type="button"
						onClick={onToggle}
						className="flex items-center gap-0.5 rounded bg-[var(--vscode-editorWidget-background)] px-1 py-0.5 text-[9px] text-[var(--vscode-editor-foreground)] opacity-50 transition-opacity hover:opacity-80"
					>
						<ChevronUp className="h-3 w-3" />
					</button>
				</div>
			)}

			{!isExpanded && hasMore && (
				<div
					className="absolute bottom-0 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 text-[var(--vscode-editor-foreground)] opacity-40 transition-opacity hover:opacity-70"
					onClick={onToggle}
				>
					<ChevronUp className="h-3 w-3" />
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Inline Tool - Query Tools
// ============================================================================

function formatInlineSummary(args: Record<string, unknown> | undefined): React.ReactNode {
	if (!args) return null;

	const parts: string[] = [];

	const path = args.path || args.file;
	if (typeof path === "string" && path) {
		const fileName = path.includes("/") ? path.split("/").pop() : path;
		parts.push(fileName || path);
	}

	if (args.offset !== undefined || args.limit !== undefined || args.startLine !== undefined) {
		const offset = (args.offset as number) ?? 1;
		const limit = args.limit as number | undefined;
		if (limit !== undefined) {
			parts.push(`L${offset}-${offset + limit - 1}`);
		} else if (args.startLine !== undefined) {
			const startLine = args.startLine as number;
			const endLine = (args.endLine as number | undefined) ?? startLine;
			parts.push(`L${startLine}-${endLine}`);
		}
	}

	if (parts.length > 0) {
		return parts.join(" ");
	}

	return null;
}

interface InlineToolProps {
	item: TimelineToolItem;
	Icon: React.ComponentType<{ className?: string }>;
	duration: string | null;
	inlineSummary: React.ReactNode;
	isRunning: boolean;
}

function InlineTool({ item, Icon, duration, inlineSummary, isRunning }: InlineToolProps) {
	const handleClick = React.useCallback(() => {
		const filePath = getFilePathFromArgs(item.args);
		if (filePath) {
			let selection: { startLine: number; endLine?: number } | undefined;
			const args = item.args;
			if (args?.offset !== undefined || args?.limit !== undefined) {
				const startLine = (args.offset as number) ?? 1;
				const endLine = args.limit ? startLine + (args.limit as number) - 1 : undefined;
				selection = { startLine, endLine };
			} else if (args?.startLine !== undefined) {
				selection = { startLine: args.startLine as number, endLine: args.endLine as number | undefined };
			}
			postToHost({ type: "ui.openFile", path: filePath, selection });
		}
	}, [item.args]);

	return (
		<div className="flex cursor-pointer items-center gap-1.5 py-0.5" onClick={handleClick}>
			<Icon className="h-3 w-3 flex-shrink-0" />
			<span className="truncate text-[11px] text-[var(--vscode-editor-foreground)] opacity-60">
				{item.toolName}
			</span>
			{inlineSummary && (
				<span className="truncate text-[11px] text-[var(--vscode-editor-foreground)] opacity-40">
					{inlineSummary}
				</span>
			)}
			{duration && !isRunning && (
				<span className="ml-auto flex-shrink-0 text-[9px] tabular-nums text-[var(--vscode-editor-foreground)] opacity-40">
					{duration}
				</span>
			)}
		</div>
	);
}

// ============================================================================
// Card Tool - Edit/Write/Bash
// ============================================================================

interface CardToolProps {
	item: TimelineToolItem;
	Icon: React.ComponentType<{ className?: string }>;
	duration: string | null;
	isRunning: boolean;
	isStreaming: boolean;
	streamContent?: string;
	/** Preview content from args (shown during execution for edit/write) */
	argsPreviewContent?: string;
	isExpanded: boolean;
	onToggle: () => void;
	extraInfo?: React.ReactNode;
	fileName?: string | null;
	diffContent?: string | undefined;
	diffStats?: DiffStats;
	isDiff?: boolean;
}

function CardTool({
	item,
	Icon,
	duration,
	isRunning,
	isStreaming,
	streamContent,
	argsPreviewContent,
	isExpanded,
	onToggle,
	extraInfo,
	fileName,
	diffContent,
	diffStats,
	isDiff = false,
}: CardToolProps) {
	const hasDiff = diffStats && (diffStats.additions > 0 || diffStats.deletions > 0);

	// Detect language from file name for syntax highlighting
	const language = detectLanguage(fileName);

	// Determine what content to show:
	// 1. If streaming (bash), show streamContent
	// 2. If edit/write tool, always show args.content (not the "Successfully wrote X bytes" output)
	// 3. If completed with diff (edit), show diff
	// 4. Otherwise show output
	let content: string;
	if (isStreaming && streamContent) {
		content = streamContent;
	} else if (diffContent) {
		content = diffContent;
	} else if ((item.toolName === "write" || item.toolName === "edit") && item.args) {
		// For write/edit tools, always show the content from args, not the success message
		content = getArgsPreviewContent(item.toolName, item.args);
	} else {
		content = item.output || "";
	}

	// When running, always show streaming content (no height limit, scroll to bottom)
	const showStreaming = isRunning && content;

	return (
		<div className="tool-step-card py-2">
			<div
				className={cn(
					"group relative overflow-hidden rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] transition-all duration-150",
					"hover:brightness-125",
				)}
			>
				{/* Header Row */}
				<div className="flex items-center gap-1.5 px-1.5 py-1">
					<Icon className="h-3 w-3 flex-shrink-0" />

					<span className="truncate text-[11px] font-medium text-[var(--vscode-editor-foreground)] opacity-80">
						{item.toolName}
					</span>

					{/* File name for edit/write, command for bash */}
					{fileName && (
						<span className="truncate text-[11px] text-[var(--vscode-editor-foreground)] opacity-60">
							{fileName}
						</span>
					)}
					{!fileName && extraInfo && (
						<span className="truncate text-[11px] text-[var(--vscode-editor-foreground)] opacity-60">
							{extraInfo}
						</span>
					)}

					{/* Diff stats */}
					{isDiff && hasDiff && !isRunning && (
						<div className="ml-auto flex items-center gap-1.5">
							<span className="flex items-center gap-0.5 text-[10px] text-green-400">
								<Plus className="h-2.5 w-2.5" />
								{diffStats.additions}
							</span>
							<span className="flex items-center gap-0.5 text-[10px] text-red-400">
								<Minus className="h-2.5 w-2.5" />
								{diffStats.deletions}
							</span>
						</div>
					)}

					{duration && !isRunning && !hasDiff && (
						<span className="ml-auto flex-shrink-0 text-[9px] tabular-nums text-[var(--vscode-editor-foreground)] opacity-40">
							{duration}
						</span>
					)}

					{isRunning && (
						<span className="ml-auto flex-shrink-0">
							<span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--vscode-progressBar-background,#4f8cff)]/30 border-t-[var(--vscode-progressBar-background,#4f8cff)]" />
						</span>
					)}
				</div>

				{/* Content */}
				<div className="border-t border-[var(--vscode-widget-border)]">
					<div className="px-1.5 py-1">
						{isStreaming && streamContent ? (
							<StreamContent content={streamContent} isExpanded={isExpanded} onToggle={onToggle} />
						) : content ? (
							<CollapsibleContent
								content={content}
								isDiff={isDiff}
								isExpanded={isExpanded}
								isStreaming={isRunning}
								language={language}
								onToggle={onToggle}
							/>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function ToolStepCard({
	item,
	onToggle,
	compact = false,
	collapsed = false,
	streamContent: externalStreamContent,
	isStreaming: externalIsStreaming = false,
}: ToolStepCardProps) {
	const kind = getToolKind(item.toolName);
	// Get fileName first so we can pass it to getKindIcon
	const diffContent = getDiffFromDetails(item.details);
	const fileName = getFileNameFromArgs(item.args);
	const Icon = getKindIcon(kind, fileName);
	const status = getToolStatus(item);
	// When tool is running, we're streaming and output is the stream content
	const isRunning = status === "running";
	const isStreaming = isRunning || externalIsStreaming;
	const streamContent = isRunning && item.output ? item.output : externalStreamContent;
	const duration = formatDuration(item);
	const inlineSummary = formatInlineSummary(item.args);

	const isQueryTool = ["read", "grep", "find", "search", "ls", "read_directory", "glob"].includes(item.toolName);
	const isEditWrite = ["edit", "write"].includes(item.toolName);
	const isBash = ["bash", "shell", "command", "exec"].includes(item.toolName);

	// Default to collapsed. Only expand when running AND has streaming output.
	const [internalExpanded, setInternalExpanded] = React.useState(false);
	const isExpanded = internalExpanded;

	const handleToggle = React.useCallback(() => {
		setInternalExpanded((prev) => !prev);
		onToggle(item.id);
	}, [item.id, onToggle]);

	// Calculate diff stats
	let diffStats = diffContent ? parseDiffStats(diffContent) : undefined;

	// For write tool, count lines in content as additions
	if (item.toolName === "write" && item.args?.content && typeof item.args.content === "string") {
		const lineCount = item.args.content.split("\n").length;
		diffStats = { additions: lineCount, deletions: 0 };
	}

	const hasDiff = diffStats && (diffStats.additions > 0 || diffStats.deletions > 0);

	// Inline mode for query tools
	if (compact && isQueryTool) {
		return (
			<InlineTool
				item={item}
				Icon={Icon}
				duration={duration}
				inlineSummary={inlineSummary}
				isRunning={isRunning}
			/>
		);
	}

	// Card mode for edit/write/bash
	if (compact && (isEditWrite || isBash)) {
		let extraInfo: React.ReactNode = null;

		if (isBash) {
			extraInfo = getCommandFromArgs(item.args);
		}

		// Get args preview content for edit/write tools during execution
		const argsPreviewContent = isEditWrite ? getArgsPreviewContent(item.toolName, item.args) : undefined;

		return (
			<CardTool
				item={item}
				Icon={Icon}
				duration={duration}
				isRunning={isRunning}
				isStreaming={isStreaming}
				streamContent={streamContent}
				argsPreviewContent={argsPreviewContent}
				isExpanded={isExpanded}
				onToggle={handleToggle}
				extraInfo={extraInfo}
				fileName={fileName}
				diffContent={diffContent}
				diffStats={diffStats}
				isDiff={isEditWrite && hasDiff}
			/>
		);
	}

	// Other tools card mode
	if (compact) {
		const outputStats = parseDiffStats(item.output || "");
		const hasOutputDiff = outputStats.additions > 0 || outputStats.deletions > 0;

		return (
			<CardTool
				item={item}
				Icon={Icon}
				duration={duration}
				isRunning={isRunning}
				isStreaming={isStreaming}
				streamContent={streamContent}
				isExpanded={isExpanded}
				onToggle={handleToggle}
				diffStats={hasOutputDiff ? outputStats : undefined}
				isDiff={hasOutputDiff}
			/>
		);
	}

	// Legacy mode
	return (
		<div className="px-2 py-1">
			<div className="rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] px-3 py-2">
				<div className="flex items-center gap-2">
					<Icon className="h-4 w-4 text-[var(--vscode-editor-foreground)] opacity-60" />
					<span className="text-sm font-medium text-[var(--vscode-editor-foreground)]">{item.toolName}</span>
					{duration && <span className="ml-auto text-[10px] text-[var(--vscode-editor-foreground)] opacity-50">{duration}</span>}
				</div>
				{item.summary && (
					<div className="mt-1 text-xs text-[var(--vscode-editor-foreground)] opacity-60 font-mono whitespace-pre-wrap">
						{item.summary}
					</div>
				)}
				{item.output && (
					<div className="mt-1 rounded-sm bg-[var(--vscode-editor-background)] p-2">
						<pre className="max-h-20 overflow-auto text-[10px] text-[var(--vscode-editor-foreground)] opacity-80 whitespace-pre-wrap">
							{item.output}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
