import * as vscode from "vscode";
import { ProcessManager } from "./backend/ProcessManager.js";
import { RpcClient } from "./backend/RpcClient.js";
import { addCurrentFileContext } from "./commands/addCurrentFileContext.js";
import { addSelectionContext } from "./commands/addSelectionContext.js";
import { stopChat } from "./commands/stopChat.js";
import { getConfiguredChatFontSize, getConfiguredDisplayLanguage } from "./config/locale.js";
import { SettingsPanel } from "./settings/SettingsPanel.js";
import { ChatViewProvider } from "./sidebar/ChatViewProvider.js";

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("Pi");
	output.appendLine("[pi] Activating VS Code extension");
	const processManager = new ProcessManager(output);
	const rpcClient = new RpcClient((message: string) => output.appendLine(`[pi][rpc] ${message}`));
	const provider = new ChatViewProvider(context.extensionUri, context.extensionMode, processManager, rpcClient);
	const settingsPanel = new SettingsPanel(context.extensionUri, context.extensionMode, processManager, rpcClient);

	provider.setLocale(getConfiguredDisplayLanguage());
	provider.setChatFontSize(getConfiguredChatFontSize());

	context.subscriptions.push(
		output,
		processManager,
		provider,
		settingsPanel,
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("pi.displayLanguage")) {
				provider.setLocale(getConfiguredDisplayLanguage());
				settingsPanel.setLocale();
			}
			if (event.affectsConfiguration("pi.chatFontSize")) {
				provider.setChatFontSize(getConfiguredChatFontSize());
			}
		}),
		vscode.window.registerWebviewViewProvider("pi.chat", provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand("pi.openChat", async () => {
			await provider.focus();
		}),
		vscode.commands.registerCommand("pi.openSettings", async () => {
			await settingsPanel.show();
		}),
		vscode.commands.registerCommand("pi.showSessionHistory", async () => {
			await provider.focus();
			provider.showSessionHistory();
		}),
		vscode.commands.registerCommand("pi.newChat", async () => {
			await provider.focus();
			provider.createNewDraftTab();
		}),
		vscode.commands.registerCommand("pi.stopChat", () => {
			stopChat(rpcClient);
		}),
		vscode.commands.registerCommand("pi.addCurrentFileContext", () => {
			addCurrentFileContext(provider);
		}),
		vscode.commands.registerCommand("pi.addSelectionContext", () => {
			addSelectionContext(provider);
		}),
	);
}

export function deactivate(): void {
	// VS Code disposes registered subscriptions.
}
