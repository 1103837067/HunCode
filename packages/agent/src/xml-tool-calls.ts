/**
 * Morph-style XML tool invocation (no provider-native function calling).
 */

import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import type { AgentTool } from "./types.js";

export interface ParsedXmlToolCall {
	name: string;
	arguments: Record<string, string>;
}

export function defaultXmlRootTag(toolName: string): string {
	return toolName
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/-/g, "_")
		.toLowerCase();
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractChildTag(inner: string, tag: string): string | undefined {
	const re = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`);
	const m = inner.match(re);
	return m?.[1]?.trim();
}

/**
 * Parse Morph-style XML blocks from assistant text into tool name + string parameter map.
 * Only tools that declare {@link AgentTool.xml} participate.
 */
export function parseXmlToolCallsFromText(text: string, tools: AgentTool[]): ParsedXmlToolCall[] {
	const results: ParsedXmlToolCall[] = [];

	for (const tool of tools) {
		const spec = tool.xml;
		if (!spec) {
			continue;
		}
		const root = spec.rootTag ?? defaultXmlRootTag(tool.name);
		const re = new RegExp(`<${escapeRegExp(root)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegExp(root)}>`, "g");
		for (const m of text.matchAll(re)) {
			const full = m[0];
			const innerOpen = new RegExp(`^<${escapeRegExp(root)}(?:\\s[^>]*)?>([\\s\\S]*)</${escapeRegExp(root)}>$`);
			const innerM = full.match(innerOpen);
			const inner = innerM?.[1] ?? "";
			const args: Record<string, string> = {};
			for (const [jsonKey, xmlTag] of Object.entries(spec.parameterTags)) {
				const v = extractChildTag(inner, xmlTag);
				if (v !== undefined) {
					args[jsonKey] = v;
				}
			}
			if (Object.keys(args).length > 0) {
				results.push({ name: tool.name, arguments: args });
			}
		}
	}

	return results;
}

function parseXmlScalar(s: string): unknown {
	const t = s.trim();
	if (t === "true") {
		return true;
	}
	if (t === "false") {
		return false;
	}
	if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t)) {
		return Number(t);
	}
	return s;
}

/**
 * Coerce flat string map from XML into JSON-like values for TypeBox validation.
 */
export function coerceXmlStringArgs(flat: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(flat)) {
		if (val.trim() === "") {
			continue;
		}
		out[key] = parseXmlScalar(val);
	}
	return out;
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** Deterministic synthetic tool call ids so streaming UI and final augment stay aligned. */
export function syntheticXmlToolCallId(index: number): string {
	return `xml-synthetic-${index}`;
}

/**
 * Remove complete Morph-style XML blocks (no trailing trim collapse).
 */
function stripCompleteXmlBlocksRaw(text: string, tools: AgentTool[]): string {
	let out = text;
	for (const tool of tools) {
		const spec = tool.xml;
		if (!spec) {
			continue;
		}
		const root = spec.rootTag ?? defaultXmlRootTag(tool.name);
		const re = new RegExp(`<${escapeRegExp(root)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegExp(root)}>`, "g");
		out = out.replace(re, "");
	}
	return out;
}

/**
 * Remove complete Morph-style XML tool blocks from assistant text so the TUI/Web do not render raw tags
 * (tool execution still uses {@link parseXmlToolCallsFromText} on the original text before stripping).
 */
export function stripParsedXmlToolBlocksFromText(text: string, tools: AgentTool[]): string {
	return stripCompleteXmlBlocksRaw(text, tools)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Strip trailing partial open tags like `<`, `<w`, … before `<root>` is complete (avoids raw `<` flashes while streaming).
 */
function stripTrailingXmlPrefixes(text: string, tools: AgentTool[]): string {
	let best: string | null = null;
	for (const tool of tools) {
		const spec = tool.xml;
		if (!spec) {
			continue;
		}
		const root = spec.rootTag ?? defaultXmlRootTag(tool.name);
		const openStart = `<${root}`;
		for (let len = openStart.length; len >= 1; len--) {
			const prefix = openStart.slice(0, len);
			if (text.endsWith(prefix) && prefix.length > (best?.length ?? 0)) {
				best = prefix;
			}
		}
	}
	if (best) {
		return text.slice(0, -best.length).trimEnd();
	}
	return text;
}

/**
 * Remove complete blocks, then any in-flight XML tool block (open without matching close), then trailing `<root` prefixes.
 * Use while the assistant message is still streaming so the TUI never shows raw Morph XML.
 */
export function stripStreamingXmlToolBlocksFromText(text: string, tools: AgentTool[]): string {
	let out = stripCompleteXmlBlocksRaw(text, tools);
	let earliestCut = out.length;
	for (const tool of tools) {
		const spec = tool.xml;
		if (!spec) {
			continue;
		}
		const root = spec.rootTag ?? defaultXmlRootTag(tool.name);
		const openRe = new RegExp(`<${escapeRegExp(root)}(?:\\s[^>]*)?>`, "g");
		let m: RegExpExecArray | null = openRe.exec(out);
		while (m !== null) {
			const openEnd = m.index + m[0].length;
			const rest = out.slice(openEnd);
			if (rest.indexOf(`</${root}>`) === -1) {
				earliestCut = Math.min(earliestCut, m.index);
			}
			m = openRe.exec(out);
		}
		const partialOpen = out.match(new RegExp(`(<${escapeRegExp(root)}(?:\\s[^>]*)?)$`));
		if (partialOpen) {
			const idx = partialOpen.index ?? 0;
			earliestCut = Math.min(earliestCut, idx);
		}
	}
	if (earliestCut < out.length) {
		out = out.slice(0, earliestCut).trimEnd();
	}
	out = stripTrailingXmlPrefixes(out, tools);
	return out.replace(/\n{3,}/g, "\n\n").trim();
}

function extractPartialXmlArguments(inner: string, spec: NonNullable<AgentTool["xml"]>): Record<string, string> {
	const args: Record<string, string> = {};
	for (const [jsonKey, xmlTag] of Object.entries(spec.parameterTags)) {
		const closed = extractChildTag(inner, xmlTag);
		if (closed !== undefined) {
			args[jsonKey] = closed;
			continue;
		}
		const unclosed = new RegExp(`<${escapeRegExp(xmlTag)}(?:\\s[^>]*)?>([\\s\\S]*)$`);
		const um = inner.match(unclosed);
		if (um) {
			args[jsonKey] = um[1].trim();
		}
	}
	return args;
}

function extractIncompleteXmlInner(text: string, tools: AgentTool[]): { tool: AgentTool; inner: string } | null {
	const remnant = stripCompleteXmlBlocksRaw(text, tools);
	let best: { index: number; tool: AgentTool; inner: string } | null = null;
	for (const tool of tools) {
		const spec = tool.xml;
		if (!spec) {
			continue;
		}
		const root = spec.rootTag ?? defaultXmlRootTag(tool.name);
		const openRe = new RegExp(`<${escapeRegExp(root)}(?:\\s[^>]*)?>`, "g");
		let m: RegExpExecArray | null = openRe.exec(remnant);
		while (m !== null) {
			const openEnd = m.index + m[0].length;
			const rest = remnant.slice(openEnd);
			if (rest.indexOf(`</${root}>`) === -1) {
				const cand = { index: m.index, tool, inner: remnant.slice(openEnd) };
				if (!best || cand.index < best.index) {
					best = cand;
				}
			}
			m = openRe.exec(remnant);
		}
		const partialOpen = remnant.match(new RegExp(`(<${escapeRegExp(root)}(?:\\s[^>]*)?)$`));
		if (partialOpen) {
			const idx = partialOpen.index ?? 0;
			const cand = { index: idx, tool, inner: "" };
			if (!best || cand.index < best.index) {
				best = cand;
			}
		}
	}
	return best ? { tool: best.tool, inner: best.inner } : null;
}

function buildSyntheticXmlToolCallsStreaming(text: string, tools: AgentTool[]): ToolCall[] {
	const complete = parseXmlToolCallsFromText(text, tools);
	const incomplete = extractIncompleteXmlInner(text, tools);
	const synthetic: ToolCall[] = [];
	let idx = 0;
	for (const p of complete) {
		const tool = tools.find((t) => t.name === p.name);
		if (!tool?.xml) {
			continue;
		}
		synthetic.push({
			type: "toolCall",
			id: syntheticXmlToolCallId(idx++),
			name: p.name,
			arguments: coerceXmlStringArgs(p.arguments),
		});
	}
	if (incomplete?.tool.xml) {
		const partialArgs = extractPartialXmlArguments(incomplete.inner, incomplete.tool.xml);
		synthetic.push({
			type: "toolCall",
			id: syntheticXmlToolCallId(idx++),
			name: incomplete.tool.name,
			arguments: coerceXmlStringArgs(partialArgs),
		});
	}
	return synthetic;
}

/**
 * Collapse all `text` parts into one block with `strippedText`, preserving non-text, non-toolCall order.
 */
function rebuildContentWithStrippedAssistantText(
	message: AssistantMessage,
	strippedText: string,
): AssistantMessage["content"] {
	const out: AssistantMessage["content"] = [];
	let textInserted = false;
	for (const c of message.content) {
		if (c.type === "text") {
			if (!textInserted) {
				out.push({ type: "text", text: strippedText });
				textInserted = true;
			}
		} else if (c.type !== "toolCall") {
			out.push(c);
		}
	}
	if (!textInserted) {
		out.push({ type: "text", text: strippedText });
	}
	return out;
}

/**
 * During XML tool streaming: strip in-flight XML from assistant text and append synthetic toolCall rows
 * (same ids as {@link augmentAssistantMessageWithXmlToolCalls} on the final message when the stream is complete).
 */
export function augmentAssistantMessageForXmlStreaming(
	message: AssistantMessage,
	tools: AgentTool[],
): AssistantMessage {
	const text = extractAssistantText(message);
	const strippedText = stripStreamingXmlToolBlocksFromText(text, tools);
	const synthetic = buildSyntheticXmlToolCallsStreaming(text, tools);
	const baseContent = rebuildContentWithStrippedAssistantText(message, strippedText);
	return {
		...message,
		content: [...baseContent, ...synthetic],
	};
}

/**
 * Strip native toolCall blocks, parse XML from text, append synthetic toolCall blocks.
 * Strips matched XML from assistant text so UI shows tool cards + prose only, not raw tags.
 */
export function augmentAssistantMessageWithXmlToolCalls(
	message: AssistantMessage,
	tools: AgentTool[],
): AssistantMessage {
	const text = extractAssistantText(message);
	const parsed = parseXmlToolCallsFromText(text, tools);
	const strippedText = stripParsedXmlToolBlocksFromText(text, tools);

	const withoutNative = message.content.filter((c) => c.type !== "toolCall");
	const hadNativeToolCalls = withoutNative.length !== message.content.length;

	if (parsed.length === 0) {
		if (!hadNativeToolCalls && strippedText === text) {
			return message;
		}
		if (strippedText === text) {
			return hadNativeToolCalls ? { ...message, content: withoutNative } : message;
		}
		return { ...message, content: rebuildContentWithStrippedAssistantText(message, strippedText) };
	}

	const synthetic: ToolCall[] = [];
	let i = 0;
	for (const p of parsed) {
		const tool = tools.find((t) => t.name === p.name);
		if (!tool?.xml) {
			continue;
		}
		synthetic.push({
			type: "toolCall",
			id: syntheticXmlToolCallId(i++),
			name: p.name,
			arguments: coerceXmlStringArgs(p.arguments),
		});
	}

	const baseContent = rebuildContentWithStrippedAssistantText(message, strippedText);
	return {
		...message,
		content: [...baseContent, ...synthetic],
	};
}
