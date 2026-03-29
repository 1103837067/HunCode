import * as vscode from "vscode";

export type EditorPromptContext =
	| {
			kind: "current-file";
			path: string;
			language?: string;
	  }
	| {
			kind: "selection";
			path: string;
			language?: string;
			text: string;
			startLine?: number;
			endLine?: number;
	  };

export function getEditorContext(options: { selectionOnly: boolean }): EditorPromptContext | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return undefined;

	const path = editor.document.uri.fsPath;
	const language = editor.document.languageId;
	const selection = editor.selection;
	const hasSelection = !selection.isEmpty;

	if (options.selectionOnly) {
		if (!hasSelection) return undefined;
		return {
			kind: "selection",
			path,
			language,
			text: editor.document.getText(selection),
			startLine: selection.start.line + 1,
			endLine: selection.end.line + 1,
		};
	}

	if (hasSelection) {
		return {
			kind: "selection",
			path,
			language,
			text: editor.document.getText(selection),
			startLine: selection.start.line + 1,
			endLine: selection.end.line + 1,
		};
	}

	return {
		kind: "current-file",
		path,
		language,
	};
}
