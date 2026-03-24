import { describe, expect, test } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import {
	buildXmlToolCallsPromptSection,
	defaultXmlRootTag,
	parseXmlToolCallsFromText,
} from "../src/core/xml-tool-registration.js";

describe("defaultXmlRootTag", () => {
	test("converts camelCase to snake_case", () => {
		expect(defaultXmlRootTag("editFile")).toBe("edit_file");
	});

	test("passes through simple names", () => {
		expect(defaultXmlRootTag("edit")).toBe("edit");
	});
});

describe("buildXmlToolCallsPromptSection", () => {
	test("returns empty string when no tools have xml", () => {
		const def = { name: "noop", parameters: {} } as unknown as ToolDefinition;
		expect(buildXmlToolCallsPromptSection([def])).toBe("");
	});

	test("includes root and parameter tags for tools with xml", () => {
		const def: ToolDefinition = {
			name: "edit",
			label: "edit",
			description: "edit",
			parameters: {} as never,
			xml: {
				rootTag: "edit",
				parameterTags: { path: "path", oldText: "old_text", newText: "new_text" },
			},
			async execute() {
				return { content: [], details: {} };
			},
		};
		const section = buildXmlToolCallsPromptSection([def]);
		expect(section).toContain("## XML-shaped tool calls");
		expect(section).toContain("function-calling");
		expect(section).toContain("<edit>");
		expect(section).toContain("</edit>");
		expect(section).toContain("<path>");
		expect(section).toContain("<old_text>");
		expect(section).toContain("<new_text>");
	});
});

describe("parseXmlToolCallsFromText", () => {
	test("parses a Morph-style edit block into JSON parameter keys", () => {
		const def: ToolDefinition = {
			name: "edit",
			label: "edit",
			description: "edit",
			parameters: {} as never,
			xml: {
				rootTag: "edit",
				parameterTags: { path: "path", oldText: "old_text", newText: "new_text" },
			},
			async execute() {
				return { content: [], details: {} };
			},
		};
		const text = `
Here is the change:
<edit>
  <path>src/a.ts</path>
  <old_text>foo</old_text>
  <new_text>bar</new_text>
</edit>
`;
		const calls = parseXmlToolCallsFromText(text, [def]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("edit");
		expect(calls[0]?.arguments).toEqual({
			path: "src/a.ts",
			oldText: "foo",
			newText: "bar",
		});
	});
});
