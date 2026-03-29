import * as vscode from "vscode";

export async function openChat(): Promise<void> {
	await vscode.commands.executeCommand("workbench.view.extension.pi");
	await vscode.commands.executeCommand("pi.chat.focus");
}
