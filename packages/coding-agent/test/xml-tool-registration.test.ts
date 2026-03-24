import { describe, expect, test } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import { buildXmlToolCallsPromptSection, parseXmlToolCallsFromText } from "../src/core/xml-tool-registration.js";

describe("buildXmlToolCallsPromptSection", () => {
	test("returns empty string when no tools", () => {
		expect(buildXmlToolCallsPromptSection([])).toBe("");
	});

	test("includes invoke and parameter tags for tools", () => {
		const def: ToolDefinition = {
			name: "edit",
			label: "edit",
			description: "edit",
			parameters: {} as never,
			xml: {
				parameterTags: { path: "path", oldText: "oldText", newText: "newText" },
			},
			async execute() {
				return { content: [], details: {} };
			},
		};
		const section = buildXmlToolCallsPromptSection([def]);
		expect(section).toContain("## Tool invocation format");
		expect(section).toContain('<invoke name="edit">');
		expect(section).toContain('<parameter name="path">');
		expect(section).toContain('<parameter name="oldText">');
		expect(section).toContain('<parameter name="newText">');
		expect(section).toContain("</invoke>");
	});
});

describe("parseXmlToolCallsFromText", () => {
	test("parses a Cursor-style invoke block into JSON parameter keys", () => {
		const def: ToolDefinition = {
			name: "edit",
			label: "edit",
			description: "edit",
			parameters: {} as never,
			xml: {
				parameterTags: { path: "path", oldText: "oldText", newText: "newText" },
			},
			async execute() {
				return { content: [], details: {} };
			},
		};
		const text = `
Here is the change:
<function_calls>
<invoke name="edit">
<parameter name="path">src/a.ts</parameter>
<parameter name="oldText">foo</parameter>
<parameter name="newText">bar</parameter>
</invoke>
</function_calls>
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
