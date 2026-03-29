import * as vscode from "vscode";

export function getWorkspacePath(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
