import * as vscode from "vscode";
import { getEditorContext } from "../context/editorContext.js";
import type { ChatViewProvider } from "../sidebar/ChatViewProvider.js";

export function addSelectionContext(provider: ChatViewProvider): void {
	const context = getEditorContext({ selectionOnly: true });
	if (!context || context.kind !== "selection") {
		void vscode.window.showInformationMessage("Pi: No selection to add as context.");
		return;
	}
	provider.setPromptContext({
		selection: {
			path: context.path,
			text: context.text,
			startLine: context.startLine,
			endLine: context.endLine,
		},
	});
	void vscode.window.showInformationMessage(
		`Added selection context: ${context.path}:${context.startLine ?? "?"}-${context.endLine ?? "?"}`,
	);
}
