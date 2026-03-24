import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import type { AgentTool } from "../src/types.js";
import {
	augmentAssistantMessageForXmlStreaming,
	augmentAssistantMessageWithXmlToolCalls,
	parseCompletedInvokeBlocks,
	parseXmlToolCallsFromText,
	stripParsedXmlToolBlocksFromText,
	stripStreamingXmlToolBlocksFromText,
} from "../src/xml-tool-calls.js";

const stubUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function stubAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: stubUsage,
		stopReason: "stop",
		timestamp: 0,
	};
}

function stubTool(name: string, parameterTags?: Record<string, string>): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: {} as never,
		xml: parameterTags ? { parameterTags } : { parameterTags: {} },
		execute: async () => ({ content: [], details: {} }),
	} as AgentTool;
}

describe("parseXmlToolCallsFromText", () => {
	test("parses single invoke block", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const text = `<function_calls>
<invoke name="write">
<parameter name="path">/tmp/a.txt</parameter>
<parameter name="content">hello</parameter>
</invoke>
</function_calls>`;
		const calls = parseXmlToolCallsFromText(text, [write]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("write");
		expect(calls[0]?.arguments).toEqual({ path: "/tmp/a.txt", content: "hello" });
	});

	test("parses multiple invoke blocks", () => {
		const read = stubTool("read", { path: "path" });
		const grep = stubTool("grep", { pattern: "pattern", path: "path" });
		const text = `<function_calls>
<invoke name="read">
<parameter name="path">foo.ts</parameter>
</invoke>
<invoke name="grep">
<parameter name="pattern">TODO</parameter>
<parameter name="path">src/</parameter>
</invoke>
</function_calls>`;
		const calls = parseXmlToolCallsFromText(text, [read, grep]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.name).toBe("read");
		expect(calls[1]?.name).toBe("grep");
	});

	test("decodes XML entities", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const text = `<function_calls>
<invoke name="write">
<parameter name="path">a.ts</parameter>
<parameter name="content">x &amp; y &lt; z</parameter>
</invoke>
</function_calls>`;
		const calls = parseXmlToolCallsFromText(text, [write]);
		expect(calls[0]?.arguments.content).toBe("x & y < z");
	});
});

describe("parseCompletedInvokeBlocks", () => {
	test("detects complete invoke without closing function_calls", () => {
		const read = stubTool("read", { path: "path" });
		const text = `Some text\n<function_calls>\n<invoke name="read">\n<parameter name="path">foo.ts</parameter>\n</invoke>\n<invoke name="read">\n<parameter name="path">bar`;
		const calls = parseCompletedInvokeBlocks(text, [read]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.arguments.path).toBe("foo.ts");
	});
});

describe("stripParsedXmlToolBlocksFromText", () => {
	test("removes function_calls block and drops trailing text", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const raw = `Hello\n<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/a.txt</parameter>\n<parameter name="content">x</parameter>\n</invoke>\n</function_calls>\nTail`;
		const out = stripParsedXmlToolBlocksFromText(raw, [write]);
		expect(out).toContain("Hello");
		expect(out).not.toContain("Tail");
		expect(out).not.toContain("<function_calls>");
		expect(out).not.toContain("<invoke");
	});
});

describe("stripStreamingXmlToolBlocksFromText", () => {
	test("hides incomplete function_calls block while streaming", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const partial = `I will create a file.\n<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/a.txt</parameter>\n<parameter name="content">partial`;
		const out = stripStreamingXmlToolBlocksFromText(partial, [write]);
		expect(out).toContain("I will create a file.");
		expect(out).not.toContain("<function_calls>");
		expect(out).not.toContain("<invoke");
	});

	test("strips trailing partial tag prefix", () => {
		const write = stubTool("write");
		const partial = "Ok.\n<function_c";
		const out = stripStreamingXmlToolBlocksFromText(partial, [write]);
		expect(out).toContain("Ok.");
		expect(out).not.toContain("<");
	});
});

describe("augmentAssistantMessageWithXmlToolCalls", () => {
	test("strips XML from text and appends synthetic toolCall", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const msg = stubAssistantMessage([
			{
				type: "text",
				text: `Ok.\n<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/demo.txt</parameter>\n<parameter name="content">hello</parameter>\n</invoke>\n</function_calls>`,
			},
		]);
		const out = augmentAssistantMessageWithXmlToolCalls(msg, [write]);
		const text = out.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(text).not.toContain("<function_calls>");
		expect(text).not.toContain("<invoke");
		const tools = out.content.filter((c) => c.type === "toolCall");
		expect(tools).toHaveLength(1);
		expect(tools[0]?.type).toBe("toolCall");
		if (tools[0]?.type === "toolCall") {
			expect(tools[0].id).toBe("xml-synthetic-0");
			expect(tools[0].name).toBe("write");
			expect(tools[0].arguments).toMatchObject({
				path: "/tmp/demo.txt",
				content: "hello",
			});
		}
	});

	test("streaming augment strips XML and adds synthetic toolCall with stable id", () => {
		const write = stubTool("write", { path: "path", content: "content" });
		const msg = stubAssistantMessage([
			{
				type: "text",
				text: `Doing it.\n<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/demo.txt</parameter>\n<parameter name="content">hi`,
			},
		]);
		const out = augmentAssistantMessageForXmlStreaming(msg, [write]);
		const text = out.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(text).not.toContain("<function_calls>");
		expect(text).not.toContain("<invoke");
		const tools = out.content.filter((c) => c.type === "toolCall");
		expect(tools).toHaveLength(1);
		if (tools[0]?.type === "toolCall") {
			expect(tools[0].id).toBe("xml-synthetic-0");
			expect(tools[0].name).toBe("write");
			expect(tools[0].arguments).toMatchObject({ path: "/tmp/demo.txt", content: "hi" });
		}
	});
});
