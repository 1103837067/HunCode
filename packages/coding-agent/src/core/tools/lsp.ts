import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { LspManager } from "../../lsp/manager.js";
import { SEVERITY_LABELS } from "../../lsp/types.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { shortenPath } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const readLintsSchema = Type.Object({
	paths: Type.Optional(
		Type.Array(Type.String({ description: "File or directory path to check diagnostics for" }), {
			description:
				"Optional list of file/directory paths to read linter errors for. If not provided, returns diagnostics for all known files.",
		}),
	),
});

export type ReadLintsToolInput = Static<typeof readLintsSchema>;

function formatReadLintsCall(
	args: { paths?: string[] } | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const paths = args?.paths;
	if (!paths || paths.length === 0) {
		return `${theme.fg("toolTitle", theme.bold("read_lints"))} ${theme.fg("toolOutput", "(all files)")}`;
	}
	const display = paths.map((p) => theme.fg("accent", shortenPath(p))).join(", ");
	return `${theme.fg("toolTitle", theme.bold("read_lints"))} ${display}`;
}

function formatReadLintsResult(
	result: { content: Array<{ type: "text"; text: string }> },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const text = result.content.map((c) => c.text).join("\n");
	if (!text.trim()) return theme.fg("muted", " (no diagnostics)");
	const lines = text.split("\n");
	const maxLines = options.expanded ? lines.length : 10;
	const display = lines.slice(0, maxLines);
	let rendered = `\n${display.map((l) => theme.fg("toolOutput", l)).join("\n")}`;
	const remaining = lines.length - maxLines;
	if (remaining > 0) {
		rendered += `\n${theme.fg("muted", `... (${remaining} more lines)`)}`;
	}
	return rendered;
}

export function createReadLintsToolDefinition(
	cwd: string,
	getLspManager: () => LspManager | undefined,
): ToolDefinition<typeof readLintsSchema> {
	return {
		name: "read_lints",
		label: "read_lints",
		description:
			"Read linter/diagnostics errors from the workspace via LSP. Provide specific file paths to check, or omit paths to get diagnostics for all files known to the LSP servers. Returns errors, warnings, and other diagnostics with line numbers.",
		promptSnippet: "Read linter/diagnostics errors via LSP",
		promptGuidelines: [
			"After substantive code edits, use read_lints to check recently edited files for linter errors. If you've introduced any, fix them.",
			"NEVER call read_lints on a file unless you've edited it or are about to edit it.",
			"read_lints can return pre-existing errors. Focus on fixing errors you introduced.",
		],
		parameters: readLintsSchema,
		async execute(_toolCallId, { paths }: { paths?: string[] }) {
			const manager = getLspManager();
			if (!manager) {
				return {
					content: [{ type: "text" as const, text: "LSP is not available." }],
					details: undefined,
				};
			}

			if (paths && paths.length > 0) {
				for (const p of paths) {
					const abs = isAbsolute(p) ? p : resolve(cwd, p);
					if (await manager.hasClients(abs)) {
						await manager.touchFile(abs);
					}
				}
			}

			const allDiags = manager.getDiagnostics();
			if (allDiags.size === 0) {
				return {
					content: [{ type: "text" as const, text: "No diagnostics found." }],
					details: undefined,
				};
			}

			const requestedPaths = paths?.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));

			let output = "";
			for (const [file, diags] of allDiags) {
				if (requestedPaths && requestedPaths.length > 0) {
					const match = requestedPaths.some((rp) => file === rp || file.startsWith(`${rp}/`));
					if (!match) continue;
				}

				if (diags.length === 0) continue;

				const relPath = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
				output += `${relPath}:\n`;
				for (const d of diags.slice(0, 30)) {
					const sev = SEVERITY_LABELS[d.severity ?? 1] ?? "ERROR";
					const line = d.range.start.line + 1;
					const col = d.range.start.character + 1;
					output += `  ${sev} [${line}:${col}] ${d.message}\n`;
				}
				if (diags.length > 30) {
					output += `  ... and ${diags.length - 30} more\n`;
				}
			}

			if (!output.trim()) {
				return {
					content: [{ type: "text" as const, text: "No diagnostics found for the specified paths." }],
					details: undefined,
				};
			}

			return {
				content: [{ type: "text" as const, text: output.trim() }],
				details: undefined,
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatReadLintsCall(args, theme));
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatReadLintsResult(result as any, options, theme));
			return text;
		},
	};
}

export function createReadLintsTool(cwd: string, getLspManager: () => LspManager | undefined): AgentTool {
	return wrapToolDefinition(createReadLintsToolDefinition(cwd, getLspManager));
}
