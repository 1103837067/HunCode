import * as vscode from "vscode";
import { type EditorPromptContext, getEditorContext } from "../context/editorContext.js";
import type { ChatViewProvider } from "../sidebar/ChatViewProvider.js";

function toMessage(context: EditorPromptContext): string {
	if (context.kind === "current-file") {
		return `Added current file context: ${context.path}`;
	}
	return `Added selection context: ${context.path}:${context.startLine ?? "?"}-${context.endLine ?? "?"}`;
}

export function addCurrentFileContext(provider: ChatViewProvider): void {
	const context = getEditorContext({ selectionOnly: false });
	if (!context || context.kind !== "current-file") {
		void vscode.window.showInformationMessage("Pi: No active file to add as context.");
		return;
	}
	provider.setPromptContext({ currentFile: { path: context.path, language: context.language } });
	void vscode.window.showInformationMessage(toMessage(context));
}
