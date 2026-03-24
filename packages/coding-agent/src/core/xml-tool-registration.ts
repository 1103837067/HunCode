/**
 * Morph-style XML tool registration helpers (prompt documentation).
 * Runtime parsing uses `@mariozechner/pi-agent-core` (see `toolInvocation: "xml"`).
 *
 * @see https://docs.morphllm.com/guides/xml-tool-calls
 */

import {
	type AgentTool,
	defaultXmlRootTag as defaultXmlRootTagFromCore,
	type ParsedXmlToolCall,
	parseXmlToolCallsFromText as parseXmlToolCallsFromAgentTools,
} from "@mariozechner/pi-agent-core";
import type { ToolDefinition, XmlToolCallSpec } from "./extensions/types.js";

export type { ParsedXmlToolCall };
export { defaultXmlRootTagFromCore as defaultXmlRootTag };

/** Invert {@link XmlToolCallSpec.parameterTags} for XML → JSON key lookup. */
export function invertXmlParameterTags(parameterTags: Record<string, string>): Record<string, string> {
	const inverted: Record<string, string> = {};
	for (const [jsonKey, xmlTag] of Object.entries(parameterTags)) {
		inverted[xmlTag] = jsonKey;
	}
	return inverted;
}

function toolDefinitionToAgentToolStub(def: ToolDefinition): AgentTool {
	return {
		name: def.name,
		label: def.label,
		description: def.description,
		parameters: def.parameters,
		xml: def.xml,
		execute: async () => ({ content: [], details: {} }),
	} as AgentTool;
}

/**
 * Same as agent-core {@link parseXmlToolCallsFromText}, but accepts {@link ToolDefinition} list (e.g. for tests / prompt tooling).
 */
export function parseXmlToolCallsFromText(text: string, definitions: ToolDefinition[]): ParsedXmlToolCall[] {
	return parseXmlToolCallsFromAgentTools(
		text,
		definitions.map((d) => toolDefinitionToAgentToolStub(d)),
	);
}

/**
 * Build a markdown section documenting registered tools in Morph-style XML (root + child tags).
 * Only includes tools that set {@link ToolDefinition.xml}.
 */
export function buildXmlToolCallsPromptSection(definitions: ToolDefinition[]): string {
	const withXml = definitions.filter((d): d is ToolDefinition & { xml: XmlToolCallSpec } => d.xml !== undefined);
	if (withXml.length === 0) {
		return "";
	}

	const blocks = withXml.map((def) => formatXmlToolExample(def));
	return (
		"\n\n## XML-shaped tool calls (Morph-style)\n\n" +
		"**Tool invocation:** Use **only** the XML blocks below in your assistant message. Do not use provider function-calling or any other tool channel.\n\n" +
		"For each tool, parameters match the JSON schema; child tag names are the canonical XML layout " +
		"(root = tool family, tags = parameters).\n\n" +
		blocks.join("\n\n")
	);
}

function formatXmlToolExample(def: ToolDefinition & { xml: XmlToolCallSpec }): string {
	const spec = def.xml;
	const root = spec.rootTag ?? defaultXmlRootTagFromCore(def.name);
	const lines: string[] = [`### ${def.name} (\`<${root}>\`)`, "", "```xml", `<${root}>`];

	const sortedKeys = Object.keys(spec.parameterTags).sort((a, b) => a.localeCompare(b));
	for (const paramKey of sortedKeys) {
		const tag = spec.parameterTags[paramKey];
		if (!tag) {
			continue;
		}
		lines.push(`  <${tag}>…</${tag}>  <!-- ${paramKey} -->`);
	}
	lines.push(`</${root}>`);
	lines.push("```");
	return lines.join("\n");
}

function valueToString(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === null || value === undefined) {
		return "";
	}
	return JSON.stringify(value);
}

/**
 * Map one XML block's inner object (flat child tags) to JSON parameter keys using `spec.parameterTags`.
 */
export function xmlInnerObjectToArguments(
	xmlTagToJsonKey: Record<string, string>,
	inner: Record<string, unknown>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [xmlTag, value] of Object.entries(inner)) {
		const jsonKey = xmlTagToJsonKey[xmlTag];
		if (!jsonKey) {
			continue;
		}
		out[jsonKey] = valueToString(value);
	}
	return out;
}
