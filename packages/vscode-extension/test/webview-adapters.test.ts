import { describe, expect, it } from "vitest";
import { adaptHostContext } from "../src/webview/lib/adapters.js";

describe("webview adapters", () => {
	it("maps host context into pills", () => {
		const pills = adaptHostContext({
			workspacePath: "/repo",
			currentFile: { path: "/repo/a.ts", language: "ts" },
		});
		expect(pills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "workspace", workspacePath: "/repo" }),
				expect.objectContaining({ kind: "current-file", path: "/repo/a.ts" }),
			]),
		);
	});
});
