import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import type { AgentTool } from "../src/types.js";
import {
	augmentAssistantMessageForXmlStreaming,
	augmentAssistantMessageWithXmlToolCalls,
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

function stubTool(name: string, rootTag: string, parameterTags: Record<string, string>): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: {} as never,
		xml: { rootTag, parameterTags },
		execute: async () => ({ content: [], details: {} }),
	} as AgentTool;
}

describe("stripParsedXmlToolBlocksFromText", () => {
	test("removes complete write block", () => {
		const write = stubTool("write", "write", { path: "path", content: "file_content" });
		const raw = `Hello\n<write>\n  <path>/tmp/a.txt</path>\n  <file_content>x</file_content>\n</write>\nTail`;
		const out = stripParsedXmlToolBlocksFromText(raw, [write]);
		expect(out).toContain("Hello");
		expect(out).toContain("Tail");
		expect(out).not.toContain("<write>");
		expect(out).not.toContain("file_content");
	});
});

describe("stripStreamingXmlToolBlocksFromText", () => {
	test("hides incomplete write block while streaming", () => {
		const write = stubTool("write", "write", { path: "path", content: "file_content" });
		const partial = `I will create a file.\n<write>\n  <path>/tmp/a.txt</path>\n  <file_content>partial`;
		const out = stripStreamingXmlToolBlocksFromText(partial, [write]);
		expect(out).toContain("I will create a file.");
		expect(out).not.toContain("<write>");
		expect(out).not.toContain("file_content");
	});

	test("strips trailing open-tag prefix to avoid raw angle brackets", () => {
		const write = stubTool("write", "write", { path: "path", content: "file_content" });
		const partial = "Ok.\n<wr";
		const out = stripStreamingXmlToolBlocksFromText(partial, [write]);
		expect(out).toContain("Ok.");
		expect(out).not.toContain("<");
	});
});

describe("augmentAssistantMessageWithXmlToolCalls", () => {
	test("strips XML from text and appends synthetic toolCall", () => {
		const write = stubTool("write", "write", { path: "path", content: "file_content" });
		const msg = stubAssistantMessage([
			{
				type: "text",
				text: `Ok.\n<write>\n  <path>/tmp/demo.txt</path>\n  <file_content>hello</file_content>\n</write>`,
			},
		]);
		const out = augmentAssistantMessageWithXmlToolCalls(msg, [write]);
		const text = out.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(text).not.toContain("<write>");
		expect(text).not.toContain("file_content");
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
		const write = stubTool("write", "write", { path: "path", content: "file_content" });
		const msg = stubAssistantMessage([
			{
				type: "text",
				text: `Doing it.\n<write>\n  <path>/tmp/demo.txt</path>\n  <file_content>hi`,
			},
		]);
		const out = augmentAssistantMessageForXmlStreaming(msg, [write]);
		const text = out.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
		expect(text).not.toContain("<write>");
		const tools = out.content.filter((c) => c.type === "toolCall");
		expect(tools).toHaveLength(1);
		if (tools[0]?.type === "toolCall") {
			expect(tools[0].id).toBe("xml-synthetic-0");
			expect(tools[0].name).toBe("write");
			expect(tools[0].arguments).toMatchObject({ path: "/tmp/demo.txt", content: "hi" });
		}
	});
});
