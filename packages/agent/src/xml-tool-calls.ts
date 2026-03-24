/**
 * Cursor-style XML tool invocation:
 *   <function_calls>
 *     <invoke name="tool_name">
 *       <parameter name="key">value</parameter>
 *     </invoke>
 *   </function_calls>
 */

import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import type { AgentTool } from "./types.js";

export interface ParsedXmlToolCall {
	name: string;
	arguments: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeXmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

/** Build a map from XML parameter name → JSON key for a given tool. */
function buildParamNameToJsonKey(tool: AgentTool): Map<string, string> {
	const map = new Map<string, string>();
	const tags = tool.xml?.parameterTags;
	if (tags) {
		for (const [jsonKey, xmlName] of Object.entries(tags)) {
			map.set(xmlName, jsonKey);
		}
	}
	return map;
}

/** Get the XML parameter name for a JSON key. Falls through to key itself when no override. */
function jsonKeyToParamName(tool: AgentTool, jsonKey: string): string {
	return tool.xml?.parameterTags?.[jsonKey] ?? jsonKey;
}

// ---------------------------------------------------------------------------
// Parsing: Cursor-style <function_calls> / <invoke> / <parameter>
// ---------------------------------------------------------------------------

const FUNCTION_CALLS_RE = /<function_calls>([\s\S]*?)<\/function_calls>/g;
const INVOKE_RE = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
const PARAMETER_RE = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;

/**
 * Parse all complete `<invoke>` blocks from text (within `<function_calls>` wrappers).
 * Returns tool name + flat string parameter map (JSON keys).
 */
export function parseXmlToolCallsFromText(text: string, tools: AgentTool[]): ParsedXmlToolCall[] {
	const results: ParsedXmlToolCall[] = [];
	const toolsByName = new Map(tools.map((t) => [t.name, t]));

	for (const fcMatch of text.matchAll(FUNCTION_CALLS_RE)) {
		const fcInner = fcMatch[1];
		for (const invMatch of fcInner.matchAll(INVOKE_RE)) {
			const toolName = invMatch[1];
			const invokeInner = invMatch[2];
			const tool = toolsByName.get(toolName);
			if (!tool) continue;

			const reverseMap = buildParamNameToJsonKey(tool);
			const args: Record<string, string> = {};
			for (const pMatch of invokeInner.matchAll(PARAMETER_RE)) {
				const xmlParamName = pMatch[1];
				const value = decodeXmlEntities(pMatch[2].trim());
				const jsonKey = reverseMap.get(xmlParamName) ?? xmlParamName;
				args[jsonKey] = value;
			}
			if (Object.keys(args).length > 0) {
				results.push({ name: toolName, arguments: args });
			}
		}
	}

	return results;
}

/**
 * Parse complete `<invoke>` blocks even without outer `</function_calls>` closing tag.
 * Used during streaming to detect tools ready for early execution.
 */
export function parseCompletedInvokeBlocks(text: string, tools: AgentTool[]): ParsedXmlToolCall[] {
	const results: ParsedXmlToolCall[] = [];
	const toolsByName = new Map(tools.map((t) => [t.name, t]));

	const fcOpenIdx = text.indexOf("<function_calls>");
	if (fcOpenIdx === -1) return results;

	const afterOpen = text.slice(fcOpenIdx + "<function_calls>".length);

	for (const invMatch of afterOpen.matchAll(INVOKE_RE)) {
		const toolName = invMatch[1];
		const invokeInner = invMatch[2];
		const tool = toolsByName.get(toolName);
		if (!tool) continue;

		const reverseMap = buildParamNameToJsonKey(tool);
		const args: Record<string, string> = {};
		for (const pMatch of invokeInner.matchAll(PARAMETER_RE)) {
			const xmlParamName = pMatch[1];
			const value = decodeXmlEntities(pMatch[2].trim());
			const jsonKey = reverseMap.get(xmlParamName) ?? xmlParamName;
			args[jsonKey] = value;
		}
		if (Object.keys(args).length > 0) {
			results.push({ name: toolName, arguments: args });
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Scalar coercion
// ---------------------------------------------------------------------------

function parseXmlScalar(s: string): unknown {
	const t = s.trim();
	if (t === "true") return true;
	if (t === "false") return false;
	if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t)) return Number(t);
	return s;
}

export function coerceXmlStringArgs(flat: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(flat)) {
		if (val.trim() === "") continue;
		out[key] = parseXmlScalar(val);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Synthetic tool call IDs
// ---------------------------------------------------------------------------

export function syntheticXmlToolCallId(index: number): string {
	return `xml-synthetic-${index}`;
}

// ---------------------------------------------------------------------------
// Text stripping (hide XML from UI display)
// ---------------------------------------------------------------------------

/**
 * Find the character position of `<function_calls` (the outer wrapper start).
 * Returns `text.length` when no tag is found.
 */
function findFunctionCallsStart(text: string): number {
	const idx = text.indexOf("<function_calls");
	return idx === -1 ? text.length : idx;
}

/**
 * Strip complete `<function_calls>` blocks from text.
 * Everything from the first `<function_calls` onward is dropped.
 */
export function stripParsedXmlToolBlocksFromText(text: string, _tools: AgentTool[]): string {
	const pos = findFunctionCallsStart(text);
	if (pos >= text.length) return text;
	return text
		.slice(0, pos)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Trailing partial tag prefixes that might flash during streaming.
 */
const STREAMING_TAG_PREFIXES = ["<function_calls", "<invoke", "<parameter"];

function stripTrailingPartialTags(text: string): string {
	for (const prefix of STREAMING_TAG_PREFIXES) {
		for (let len = prefix.length; len >= 1; len--) {
			const partial = prefix.slice(0, len);
			if (text.endsWith(partial)) {
				return text.slice(0, -partial.length).trimEnd();
			}
		}
	}
	return text;
}

/**
 * Strip XML tool blocks from streaming text.
 * Truncates at `<function_calls` if found, otherwise strips trailing partial tag prefixes.
 */
export function stripStreamingXmlToolBlocksFromText(text: string, _tools: AgentTool[]): string {
	const pos = findFunctionCallsStart(text);
	if (pos < text.length) {
		return text
			.slice(0, pos)
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}
	return stripTrailingPartialTags(text)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Streaming: incomplete invoke detection for UI preview
// ---------------------------------------------------------------------------

function extractIncompleteInvoke(
	text: string,
	tools: AgentTool[],
): { tool: AgentTool; params: Record<string, string> } | null {
	const fcOpenIdx = text.indexOf("<function_calls>");
	if (fcOpenIdx === -1) return null;

	const afterOpen = text.slice(fcOpenIdx + "<function_calls>".length);
	const stripped = afterOpen.replace(/<invoke\s+name="[^"]+">[\s\S]*?<\/invoke>/g, "");

	const partialInvoke = stripped.match(/<invoke\s+name="([^"]+)">([\s\S]*)$/);
	if (!partialInvoke) return null;

	const toolName = partialInvoke[1];
	const invokeInner = partialInvoke[2];
	const tool = tools.find((t) => t.name === toolName);
	if (!tool) return null;

	const reverseMap = buildParamNameToJsonKey(tool);
	const params: Record<string, string> = {};

	let remaining = invokeInner;
	for (const pMatch of invokeInner.matchAll(PARAMETER_RE)) {
		const xmlParamName = pMatch[1];
		const value = decodeXmlEntities(pMatch[2].trim());
		const jsonKey = reverseMap.get(xmlParamName) ?? xmlParamName;
		params[jsonKey] = value;
		remaining = remaining.slice(remaining.indexOf(pMatch[0]) + pMatch[0].length);
	}

	const unclosedParam = remaining.match(/<parameter\s+name="([^"]+)">([\s\S]*)$/);
	if (unclosedParam) {
		const xmlParamName = unclosedParam[1];
		const value = decodeXmlEntities(unclosedParam[2].trim());
		const jsonKey = reverseMap.get(xmlParamName) ?? xmlParamName;
		params[jsonKey] = value;
	}

	return { tool, params };
}

function buildSyntheticXmlToolCallsStreaming(text: string, tools: AgentTool[]): ToolCall[] {
	const complete = parseCompletedInvokeBlocks(text, tools);
	const incomplete = extractIncompleteInvoke(text, tools);
	const synthetic: ToolCall[] = [];
	let idx = 0;

	for (const p of complete) {
		synthetic.push({
			type: "toolCall",
			id: syntheticXmlToolCallId(idx++),
			name: p.name,
			arguments: coerceXmlStringArgs(p.arguments),
		});
	}

	if (incomplete) {
		synthetic.push({
			type: "toolCall",
			id: syntheticXmlToolCallId(idx++),
			name: incomplete.tool.name,
			arguments: coerceXmlStringArgs(incomplete.params),
		});
	}

	return synthetic;
}

// ---------------------------------------------------------------------------
// Assistant message content rebuilding
// ---------------------------------------------------------------------------

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

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

// ---------------------------------------------------------------------------
// Public augment functions (streaming + final)
// ---------------------------------------------------------------------------

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
		if (!hadNativeToolCalls && strippedText === text) return message;
		if (strippedText === text) {
			return hadNativeToolCalls ? { ...message, content: withoutNative } : message;
		}
		return { ...message, content: rebuildContentWithStrippedAssistantText(message, strippedText) };
	}

	const synthetic: ToolCall[] = [];
	let i = 0;
	for (const p of parsed) {
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

// Re-export helpers used externally
export { jsonKeyToParamName, buildParamNameToJsonKey };
