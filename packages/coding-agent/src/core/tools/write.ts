import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Container, Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { renderDiff } from "../../modes/interactive/components/diff.js";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { generateDiffString } from "./edit-diff.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd } from "./path-utils.js";
import { invalidArgText, normalizeDisplayText, replaceTabs, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/** Unified diff vs previous file on disk (new file: diff from empty). */
export interface WriteToolDetails {
	diff: string;
	firstChangedLine?: number;
}

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
	/** Read existing file before overwrite (for result diff). Defaults to local fs readFile. */
	readFile?: (absolutePath: string) => Promise<Buffer>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
	readFile: (path) => fsReadFile(path),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

type WriteHighlightCache = {
	rawPath: string | null;
	lang: string;
	rawContent: string;
	normalizedLines: string[];
	highlightedLines: string[];
};

class WriteCallRenderComponent extends Text {
	cache?: WriteHighlightCache;

	constructor() {
		super("", 0, 0);
	}
}

const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;

function highlightSingleLine(line: string, lang: string): string {
	const highlighted = highlightCode(line, lang);
	return highlighted[0] ?? "";
}

function refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
	const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
	if (prefixCount === 0) return;
	const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
	const prefixHighlighted = highlightCode(prefixSource, cache.lang);
	for (let i = 0; i < prefixCount; i++) {
		cache.highlightedLines[i] =
			prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
	}
}

function rebuildWriteHighlightCacheFull(rawPath: string | null, fileContent: string): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	const displayContent = normalizeDisplayText(fileContent);
	const normalized = replaceTabs(displayContent);
	return {
		rawPath,
		lang,
		rawContent: fileContent,
		normalizedLines: normalized.split("\n"),
		highlightedLines: highlightCode(normalized, lang),
	};
}

function updateWriteHighlightCacheIncremental(
	cache: WriteHighlightCache | undefined,
	rawPath: string | null,
	fileContent: string,
): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	if (!cache) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (cache.lang !== lang || cache.rawPath !== rawPath) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (!fileContent.startsWith(cache.rawContent)) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (fileContent.length === cache.rawContent.length) return cache;

	const deltaRaw = fileContent.slice(cache.rawContent.length);
	const deltaDisplay = normalizeDisplayText(deltaRaw);
	const deltaNormalized = replaceTabs(deltaDisplay);
	cache.rawContent = fileContent;
	if (cache.normalizedLines.length === 0) {
		cache.normalizedLines.push("");
		cache.highlightedLines.push("");
	}

	const segments = deltaNormalized.split("\n");
	const lastIndex = cache.normalizedLines.length - 1;
	cache.normalizedLines[lastIndex] += segments[0];
	cache.highlightedLines[lastIndex] = highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);
	for (let i = 1; i < segments.length; i++) {
		cache.normalizedLines.push(segments[i]);
		cache.highlightedLines.push(highlightSingleLine(segments[i], cache.lang));
	}
	refreshWriteHighlightPrefix(cache);
	return cache;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

/** Collapsed diff line budget (full diff when expanded via app.tools.expand). */
const WRITE_DIFF_COLLAPSED_MAX_LINES = 22;

function truncateDiffForCollapsedView(
	diffText: string,
	expanded: boolean,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	filePath: string | null,
): string {
	const diffOpts = { filePath: filePath ?? undefined };
	const lines = diffText.split("\n");
	if (expanded || lines.length <= WRITE_DIFF_COLLAPSED_MAX_LINES) {
		return renderDiff(diffText, diffOpts);
	}
	const truncated = lines.slice(0, WRITE_DIFF_COLLAPSED_MAX_LINES).join("\n");
	const more = lines.length - WRITE_DIFF_COLLAPSED_MAX_LINES;
	return (
		renderDiff(truncated, diffOpts) +
		`\n${theme.fg("muted", `... (${more} more diff lines`)} ${keyHint("app.tools.expand", "to show all")})`
	);
}

function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	cache: WriteHighlightCache | undefined,
	streaming: { toolResult?: { details?: unknown; isError: boolean } | undefined },
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const invalidArg = invalidArgText(theme);
	let text = `${theme.fg("toolTitle", theme.bold("write"))} ${path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...")}`;

	const details = streaming.toolResult?.details as WriteToolDetails | undefined;
	const hideStreamingPreview =
		Boolean(streaming.toolResult) && !streaming.toolResult?.isError && Boolean(details?.diff?.trim());

	if (fileContent === null) {
		text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
		return text;
	}

	if (hideStreamingPreview) {
		return text;
	}

	if (!fileContent) {
		return text;
	}

	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	const renderedLines = lang
		? (cache?.highlightedLines ?? highlightCode(replaceTabs(normalizeDisplayText(fileContent)), lang))
		: normalizeDisplayText(fileContent).split("\n");
	const lines = trimTrailingEmptyLines(renderedLines);
	const totalLines = lines.length;
	const maxLines = options.expanded ? lines.length : 10;
	const take = Math.min(maxLines, lines.length);
	const omittedAbove = lines.length - take;
	const displayLines = options.expanded ? lines : lines.slice(-take);

	if (!options.expanded && omittedAbove > 0) {
		const firstShown = totalLines - take + 1;
		text += `\n\n${theme.fg(
			"muted",
			`... ${omittedAbove} lines above omitted — showing lines ${firstShown}–${totalLines} of ${totalLines}`,
		)}`;
	}

	text += `\n\n${displayLines.map((line) => (lang ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;

	return text;
}

function formatWriteResult(
	args: { path?: string; file_path?: string } | undefined,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: WriteToolDetails;
		isError?: boolean;
	},
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	isError: boolean,
	expanded: boolean,
): string | undefined {
	if (isError) {
		const output = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		if (!output) {
			return undefined;
		}
		return `\n${theme.fg("error", output)}`;
	}
	const resultDiff = result.details?.diff;
	if (!resultDiff?.trim()) {
		return undefined;
	}
	const rawPath = str(args?.file_path ?? args?.path);
	return `\n${truncateDiffForCollapsedView(resultDiff, expanded, theme, rawPath)}`;
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails | undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		xml: {
			rootTag: "write",
			parameterTags: {
				path: "path",
				content: "file_content",
			},
		},
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			const dir = dirname(absolutePath);
			const readFileOp = ops.readFile ?? defaultWriteOperations.readFile;
			return withFileMutationQueue(
				absolutePath,
				() =>
					new Promise<{
						content: Array<{ type: "text"; text: string }>;
						details: WriteToolDetails | undefined;
					}>((resolve, reject) => {
						if (signal?.aborted) {
							reject(new Error("Operation aborted"));
							return;
						}
						let aborted = false;
						const onAbort = () => {
							aborted = true;
							reject(new Error("Operation aborted"));
						};
						signal?.addEventListener("abort", onAbort, { once: true });
						(async () => {
							try {
								let oldContent = "";
								if (readFileOp) {
									try {
										oldContent = (await readFileOp(absolutePath)).toString("utf-8");
									} catch {
										// New file: diff from empty.
									}
								}
								if (aborted) return;
								// Create parent directories if needed.
								await ops.mkdir(dir);
								if (aborted) return;
								// Write the file contents.
								await ops.writeFile(absolutePath, content);
								if (aborted) return;
								signal?.removeEventListener("abort", onAbort);
								const diffResult = generateDiffString(oldContent, content);
								resolve({
									content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
									details: {
										diff: diffResult.diff,
										firstChangedLine: diffResult.firstChangedLine,
									},
								});
							} catch (error: unknown) {
								signal?.removeEventListener("abort", onAbort);
								if (!aborted) reject(error);
							}
						})();
					}),
			);
		},
		renderCall(args, theme, context) {
			const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
			const rawPath = str(renderArgs?.file_path ?? renderArgs?.path);
			const fileContent = str(renderArgs?.content);
			const component =
				(context.lastComponent as WriteCallRenderComponent | undefined) ?? new WriteCallRenderComponent();
			if (fileContent !== null) {
				component.cache = context.argsComplete
					? rebuildWriteHighlightCacheFull(rawPath, fileContent)
					: updateWriteHighlightCacheIncremental(component.cache, rawPath, fileContent);
			} else {
				component.cache = undefined;
			}
			component.setText(
				formatWriteCall(
					renderArgs,
					{ expanded: context.expanded, isPartial: context.isPartial },
					theme,
					component.cache,
					{ toolResult: context.toolResult },
				),
			);
			return component;
		},
		renderResult(result, _options, theme, context) {
			const output = formatWriteResult(
				context.args as { path?: string; file_path?: string } | undefined,
				{ ...result, isError: context.isError },
				theme,
				context.isError,
				context.expanded,
			);
			if (!output) {
				const component = (context.lastComponent as Container | undefined) ?? new Container();
				component.clear();
				return component;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(output);
			return text;
		},
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}

/** Default write tool using process.cwd() for backwards compatibility. */
export const writeToolDefinition = createWriteToolDefinition(process.cwd());
export const writeTool = createWriteTool(process.cwd());
