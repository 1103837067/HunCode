import { describe, expect, it } from "vitest";
import { createInitialWebviewState, derivePromptContext, reduceState } from "../src/webview/lib/state.js";

describe("webview state", () => {
	it("switches to settings view", () => {
		const state = reduceState(createInitialWebviewState(), { type: "setView", view: "settings" });
		expect(state.view).toBe("settings");
	});

	it("sets models from setModels action", () => {
		const state = reduceState(createInitialWebviewState(), {
			type: "setModels",
			models: [{ provider: "anthropic", id: "claude-sonnet", label: "anthropic/claude-sonnet" }],
		});
		expect(state.availableModels).toHaveLength(1);
		expect(state.availableModels[0].id).toBe("claude-sonnet");
	});

	it("derives prompt context from pills and toggles", () => {
		let state = createInitialWebviewState();
		state = reduceState(state, {
			type: "setContextPills",
			pills: [
				{ kind: "workspace", label: "Workspace", workspacePath: "/repo" },
				{ kind: "current-file", label: "a.ts", path: "/repo/a.ts", language: "ts" },
				{ kind: "selection", label: "a.ts:1", path: "/repo/a.ts", text: "x", startLine: 1, endLine: 1 },
			],
		});
		const context = derivePromptContext(state);
		expect(context.workspacePath).toBe("/repo");
		expect(context.currentFile?.path).toBe("/repo/a.ts");
		expect(context.selection?.text).toBe("x");
	});
});
