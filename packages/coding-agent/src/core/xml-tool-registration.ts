/**
 * Cursor-style XML tool registration helpers (prompt documentation).
 * Runtime parsing uses `@mariozechner/pi-agent-core` (see `toolInvocation: "xml"`).
 *
 * Format: <function_calls><invoke name="..."><parameter name="...">...</parameter></invoke></function_calls>
 */

import {
	type AgentTool,
	type ParsedXmlToolCall,
	parseXmlToolCallsFromText as parseXmlToolCallsFromAgentTools,
} from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { ToolDefinition, XmlToolCallSpec } from "./extensions/types.js";

export type { ParsedXmlToolCall };

/**
 * Derive a {@link XmlToolCallSpec} from a tool's TypeBox parameters schema.
 * Each JSON property key maps to itself (identity — Cursor convention).
 */
export function deriveXmlSpec(_toolName: string, parameters: TSchema): XmlToolCallSpec {
	const parameterTags: Record<string, string> = {};
	if (parameters && typeof parameters === "object" && "properties" in parameters) {
		for (const key of Object.keys((parameters as Record<string, unknown>).properties as Record<string, unknown>)) {
			parameterTags[key] = key;
		}
	}
	return { parameterTags };
}

/** Resolve the effective {@link XmlToolCallSpec} for a tool: explicit `xml` or auto-derived. */
export function resolveXmlSpec(def: { name: string; parameters: TSchema; xml?: XmlToolCallSpec }): XmlToolCallSpec {
	return def.xml ?? deriveXmlSpec(def.name, def.parameters);
}

/** Invert {@link XmlToolCallSpec.parameterTags} for XML parameter name → JSON key lookup. */
export function invertXmlParameterTags(parameterTags: Record<string, string>): Record<string, string> {
	const inverted: Record<string, string> = {};
	for (const [jsonKey, xmlName] of Object.entries(parameterTags)) {
		inverted[xmlName] = jsonKey;
	}
	return inverted;
}

function toolDefinitionToAgentToolStub(def: ToolDefinition): AgentTool {
	return {
		name: def.name,
		label: def.label,
		description: def.description,
		parameters: def.parameters,
		xml: resolveXmlSpec(def),
		execute: async () => ({ content: [], details: {} }),
	} as AgentTool;
}

export function parseXmlToolCallsFromText(text: string, definitions: ToolDefinition[]): ParsedXmlToolCall[] {
	return parseXmlToolCallsFromAgentTools(
		text,
		definitions.map((d) => toolDefinitionToAgentToolStub(d)),
	);
}

/**
 * Build a prompt section documenting all registered tools in Cursor-style XML format.
 */
export function buildXmlToolCallsPromptSection(definitions: ToolDefinition[]): string {
	if (definitions.length === 0) {
		return "";
	}

	const blocks = definitions.map((def) => formatXmlToolExample(def, resolveXmlSpec(def)));

	return (
		"\n\n## Tool invocation format\n\n" +
		"You can invoke tools by writing XML blocks in your assistant message. " +
		"Wrap all tool calls in a single `<function_calls>` block. Do not use provider function-calling or any other tool channel.\n\n" +
		"```xml\n" +
		"<function_calls>\n" +
		'<invoke name="tool_name">\n' +
		'<parameter name="param1">value1</parameter>\n' +
		'<parameter name="param2">value2</parameter>\n' +
		"</invoke>\n" +
		"</function_calls>\n" +
		"```\n\n" +
		"You may include **multiple** `<invoke>` blocks in a single `<function_calls>` wrapper. " +
		"Independent tool calls should be batched together for better performance. " +
		"Each tool is executed as soon as its `</invoke>` tag is received.\n\n" +
		blocks.join("\n\n")
	);
}

function formatXmlToolExample(def: ToolDefinition, spec: XmlToolCallSpec): string {
	const tags = spec.parameterTags ?? {};
	const lines: string[] = [`### ${def.name}`, "", "```xml", `<invoke name="${def.name}">`];

	const sortedKeys = Object.keys(tags).sort((a, b) => a.localeCompare(b));
	for (const jsonKey of sortedKeys) {
		const xmlName = tags[jsonKey];
		if (!xmlName) continue;
		const comment = xmlName !== jsonKey ? `  <!-- ${jsonKey} -->` : "";
		lines.push(`  <parameter name="${xmlName}">…</parameter>${comment}`);
	}
	lines.push("</invoke>");
	lines.push("```");
	return lines.join("\n");
}

function valueToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	return JSON.stringify(value);
}

export function xmlInnerObjectToArguments(
	xmlTagToJsonKey: Record<string, string>,
	inner: Record<string, unknown>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [xmlTag, value] of Object.entries(inner)) {
		const jsonKey = xmlTagToJsonKey[xmlTag];
		if (!jsonKey) continue;
		out[jsonKey] = valueToString(value);
	}
	return out;
}
