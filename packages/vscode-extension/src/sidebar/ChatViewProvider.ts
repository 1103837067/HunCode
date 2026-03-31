import { existsSync, readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ProcessManager } from "../backend/ProcessManager.js";
import type { RpcClient } from "../backend/RpcClient.js";
import { getConfiguredChatFontSize, getConfiguredDisplayLanguage, getDisplayLocale } from "../config/locale.js";
import type { DisplayLanguageSetting } from "../webview/lib/i18n.js";

const VIEW_ID = "pi.chat";
const DEFAULT_WEBVIEW_DEV_PORT = 4173;

type PromptContext = {
	workspacePath?: string;
	currentFile?: { path: string; language?: string };
	selection?: { path: string; text: string; startLine?: number; endLine?: number };
};

type WebviewOutboundMessage =
	| Record<string, unknown>
	| { type: "rpc:state"; data: unknown }
	| { type: "rpc:models"; data: unknown }
	| { type: "ui.context"; context: PromptContext }
	| { type: "ui.reset" }
	| { type: "ui.locale"; locale: string; setting: DisplayLanguageSetting }
	| { type: "ui.chatFontSize"; value: number }
	| { type: "ui.showSessionHistory" }
	| { type: "ui.sessionHistory"; sessions: unknown }
	| { type: "ui.newDraftTab" };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly viewDisposables: vscode.Disposable[] = [];
	private view?: vscode.WebviewView;
	private previewPanel?: vscode.WebviewPanel;
	private promptContext: PromptContext = {};
	private webviewReady = false;
	private pendingEvents: WebviewOutboundMessage[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly extensionMode: vscode.ExtensionMode,
		private readonly processManager: ProcessManager,
		private readonly rpcClient: RpcClient,
	) {}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		for (const disposable of this.viewDisposables.splice(0)) {
			disposable.dispose();
		}
		this.view = webviewView;
		this.webviewReady = false;
		this.pendingEvents = [];
		this.processManager.log("Resolving chat webview");
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist"),
				vscode.Uri.joinPath(this.extensionUri, "resources"),
			],
		};
		webviewView.webview.html = await this.renderHtml(webviewView.webview);

		this.viewDisposables.push(
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				this.handleWebviewMessage(message);
			}),
			webviewView.onDidDispose(() => {
				if (this.view === webviewView) {
					this.view = undefined;
					this.webviewReady = false;
					this.pendingEvents = [];
				}
			}),
		);

		const child = this.processManager.start();
		this.rpcClient.attach(child);

		this.setupRpcListeners();

		this.enqueueOrPost({ type: "ui.locale", locale: getDisplayLocale(), setting: getConfiguredDisplayLanguage() });
		this.enqueueOrPost({ type: "ui.chatFontSize", value: getConfiguredChatFontSize() });
		this.postContextState();

		this.fetchInitialState();
	}

	private setupRpcListeners(): void {
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}

		const eventUnsub = this.rpcClient.onEvent((event) => {
			this.enqueueOrPost(event);
		});

		const uiUnsub = this.rpcClient.onExtensionUI((request) => {
			void this.handleExtensionUIRequest(request);
		});

		this.disposables.push(
			vscode.Disposable.from({ dispose: eventUnsub }),
			vscode.Disposable.from({ dispose: uiUnsub }),
		);
	}

	private fetchInitialState(): void {
		this.rpcClient
			.request<Record<string, unknown>>({ type: "get_state" }, 30000)
			.then((state) => {
				this.enqueueOrPost({ type: "rpc:state", data: state });
			})
			.catch((error) => {
				this.processManager.log(`[webview:error] get_state failed: ${String(error)}`);
			});

		this.refreshModels();
		this.fetchMessages();
	}

	refreshModels(): void {
		this.rpcClient
			.request<{ models: Array<{ id: string; provider: string; name?: string }> }>(
				{ type: "get_available_models" },
				30000,
			)
			.then((data) => {
				this.enqueueOrPost({
					type: "rpc:models",
					data: {
						models: data.models.map((m) => ({
							id: m.id,
							provider: m.provider,
							label: `${m.provider}/${m.id}`,
						})),
					},
				});
			})
			.catch((error) => {
				this.processManager.log(`[webview:error] get_available_models failed: ${String(error)}`);
			});
	}

	private fetchMessages(): void {
		this.rpcClient
			.request<{ messages: Array<Record<string, unknown>> }>({ type: "get_messages" }, 30000)
			.then((data) => {
				this.enqueueOrPost({ type: "rpc:messages", data: { messages: data.messages } });
			})
			.catch((error) => {
				this.processManager.log(`[webview:error] get_messages failed: ${String(error)}`);
			});
	}

	async focus(): Promise<void> {
		await vscode.commands.executeCommand("workbench.view.extension.pi");
		await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
	}

	setPromptContext(partial: PromptContext): void {
		this.promptContext = { ...this.promptContext, ...partial };
		this.postContextState();
	}

	setLocale(_locale: DisplayLanguageSetting): void {
		this.enqueueOrPost({ type: "ui.locale", locale: getDisplayLocale(), setting: getConfiguredDisplayLanguage() });
	}

	setChatFontSize(_value: number): void {
		this.enqueueOrPost({ type: "ui.chatFontSize", value: getConfiguredChatFontSize() });
	}

	resetViewState(): void {
		this.enqueueOrPost({ type: "ui.reset" });
	}

	showSessionHistory(): void {
		this.enqueueOrPost({ type: "ui.showSessionHistory" });
		this.fetchSessionHistory();
	}

	private fetchSessionHistory(): void {
		this.rpcClient
			.request<{ sessions: Array<Record<string, unknown>> }>({ type: "list_sessions" })
			.then((data) => {
				this.enqueueOrPost({ type: "ui.sessionHistory", sessions: data.sessions });
			})
			.catch((err) => {
				this.processManager.log(`[webview:error] list_sessions failed: ${String(err)}`);
				this.enqueueOrPost({ type: "ui.sessionHistory", sessions: [] });
			});
	}

	createNewDraftTab(): void {
		this.rpcClient.sendCommand({ type: "new_session" });
		this.enqueueOrPost({ type: "ui.reset" });
		this.enqueueOrPost({ type: "ui.newDraftTab" });
	}

	dispose(): void {
		for (const disposable of this.viewDisposables.splice(0)) {
			disposable.dispose();
		}
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.previewPanel?.dispose();
		this.view = undefined;
	}

	private handleWebviewMessage(message: unknown): void {
		if (!message || typeof message !== "object") return;
		const event = message as Record<string, unknown>;

		if (event.type === "ui.ready") {
			this.webviewReady = true;
			this.processManager.log("[webview] ready handshake received");
			for (const pending of this.pendingEvents.splice(0)) {
				this.view?.webview.postMessage(pending);
			}
			return;
		}

		if (event.type === "prompt" && typeof event.text === "string") {
			this.rpcClient.sendCommand({ type: "prompt", message: event.text });
			return;
		}

		if (event.type === "abort") {
			this.rpcClient.sendCommand({ type: "abort" });
			return;
		}

		if (event.type === "setModel" && typeof event.modelId === "string") {
			const separator = event.modelId.indexOf("/");
			if (separator === -1) {
				this.processManager.log(`[webview:error] Invalid model id: ${event.modelId}`);
				return;
			}
			const provider = event.modelId.slice(0, separator);
			const modelId = event.modelId.slice(separator + 1);
			this.rpcClient.sendCommand({ type: "set_model", provider, modelId });
			return;
		}

		if (event.type === "newSession") {
			this.createNewDraftTab();
			return;
		}

		if (event.type === "ui.openSettings") {
			void vscode.commands.executeCommand("pi.openSettings");
			return;
		}

		if (event.type === "ui.addCurrentFileContext") {
			void vscode.commands.executeCommand("pi.addCurrentFileContext");
			return;
		}

		if (event.type === "ui.addSelectionContext") {
			void vscode.commands.executeCommand("pi.addSelectionContext");
			return;
		}

		if (
			event.type === "ui.setDisplayLanguage" &&
			(event.language === "auto" || event.language === "zh-CN" || event.language === "en")
		) {
			void vscode.workspace
				.getConfiguration("pi")
				.update("displayLanguage", event.language, vscode.ConfigurationTarget.Global);
			return;
		}

		if (event.type === "ui.setChatFontSize" && typeof event.value === "number") {
			const nextValue = Math.min(18, Math.max(11, Math.round(event.value)));
			void vscode.workspace
				.getConfiguration("pi")
				.update("chatFontSize", nextValue, vscode.ConfigurationTarget.Global);
			return;
		}

		if (event.type === "ui.refreshSessions") {
			this.fetchSessionHistory();
			return;
		}

		if (event.type === "ui.refreshModels") {
			this.refreshModels();
			return;
		}

		if (event.type === "ui.openSession" && typeof event.sessionPath === "string") {
			this.rpcClient
				.request<{ cancelled: boolean }>({ type: "switch_session", sessionPath: event.sessionPath })
				.then((data) => {
					if (!data.cancelled) {
						this.enqueueOrPost({ type: "ui.reset" });
						this.fetchInitialState();
					}
				})
				.catch((err) => {
					this.processManager.log(`[webview:error] switch_session failed: ${String(err)}`);
				});
			return;
		}

		if (event.type === "ui.log" && typeof event.message === "string") {
			this.processManager.log(`[webview] ${event.message}`);
			return;
		}

		if (
			event.type === "ui.previewImage" &&
			typeof event.image === "object" &&
			event.image !== null &&
			typeof (event.image as { mimeType?: unknown }).mimeType === "string" &&
			typeof (event.image as { data?: unknown }).data === "string"
		) {
			this.openImagePreview(event.image as { mimeType: string; data: string });
			return;
		}

		if (event.type === "ui.error" && typeof event.message === "string") {
			this.processManager.log(`[webview:error] ${event.message}`);
			return;
		}

		if (event.type === "ui.openFile" && typeof event.path === "string") {
			const selection = event.selection as { startLine?: number; endLine?: number } | undefined;
			const range =
				selection?.startLine !== undefined
					? new vscode.Range(
							new vscode.Position(selection.startLine - 1, 0),
							new vscode.Position((selection.endLine ?? selection.startLine) - 1, Number.MAX_SAFE_INTEGER),
						)
					: undefined;
			void vscode.workspace.openTextDocument(event.path).then((doc) => {
				void vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: range });
			});
			return;
		}
	}

	private async handleExtensionUIRequest(request: Record<string, unknown>): Promise<void> {
		const id = request.id as string;
		const method = request.method as string;

		switch (method) {
			case "notify": {
				const msg = String(request.message ?? "");
				const notifyType = request.notifyType as string | undefined;
				if (notifyType === "error") {
					void vscode.window.showErrorMessage(msg);
				} else if (notifyType === "warning") {
					void vscode.window.showWarningMessage(msg);
				} else {
					void vscode.window.showInformationMessage(msg);
				}
				break;
			}
			case "select": {
				const options = request.options as string[];
				const title = String(request.title ?? "Select");
				const selected = await vscode.window.showQuickPick(options, { title });
				if (selected !== undefined) {
					this.rpcClient.sendCommand({ type: "extension_ui_response", id, value: selected });
				} else {
					this.rpcClient.sendCommand({ type: "extension_ui_response", id, cancelled: true });
				}
				break;
			}
			case "confirm": {
				const title = String(request.title ?? "");
				const msg = String(request.message ?? "");
				const result = await vscode.window.showWarningMessage(`${title}: ${msg}`, "Yes", "No");
				this.rpcClient.sendCommand({ type: "extension_ui_response", id, confirmed: result === "Yes" });
				break;
			}
			case "input": {
				const title = String(request.title ?? "");
				const placeholder = request.placeholder ? String(request.placeholder) : undefined;
				const value = await vscode.window.showInputBox({ title, placeHolder: placeholder });
				if (value !== undefined) {
					this.rpcClient.sendCommand({ type: "extension_ui_response", id, value });
				} else {
					this.rpcClient.sendCommand({ type: "extension_ui_response", id, cancelled: true });
				}
				break;
			}
			default:
				break;
		}
	}

	private postContextState(): void {
		this.enqueueOrPost({ type: "ui.context", context: this.promptContext });
	}

	private enqueueOrPost(event: WebviewOutboundMessage): void {
		if (!this.webviewReady) {
			this.pendingEvents.push(event);
			return;
		}
		this.view?.webview.postMessage(event);
	}

	private openImagePreview(image: { mimeType: string; data: string }): void {
		if (!this.previewPanel) {
			this.previewPanel = vscode.window.createWebviewPanel(
				"piImagePreview",
				"Image Preview",
				vscode.ViewColumn.Active,
				{
					enableScripts: false,
					retainContextWhenHidden: true,
				},
			);
			this.previewPanel.onDidDispose(() => {
				this.previewPanel = undefined;
			});
		}
		this.previewPanel.title = "Image Preview";
		this.previewPanel.reveal(vscode.ViewColumn.Active, true);
		const src = `data:${image.mimeType};base64,${image.data}`;
		this.previewPanel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Image Preview</title>
<style>:root{color-scheme:dark light}html,body{margin:0;width:100%;height:100%;background:#111}body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}img{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.45)}</style>
</head>
<body><img src="${src}" alt="Image Preview" /></body>
</html>`;
	}

	private readCssAsset(...segments: string[]): string {
		const path = vscode.Uri.joinPath(this.extensionUri, ...segments).fsPath;
		if (!existsSync(path)) {
			this.processManager.log(`Missing CSS asset: ${path}`);
			return "";
		}
		return readFileSync(path, "utf8");
	}

	private getDevServerPort(): number {
		const portFile = vscode.Uri.joinPath(this.extensionUri, ".vite-port").fsPath;
		try {
			if (existsSync(portFile)) {
				const value = Number.parseInt(readFileSync(portFile, "utf8").trim(), 10);
				if (Number.isFinite(value)) return value;
			}
		} catch (error) {
			this.processManager.log(`[webview] failed to read dev server port: ${String(error)}`);
		}
		return DEFAULT_WEBVIEW_DEV_PORT;
	}

	private async canUseDevServer(): Promise<boolean> {
		if (this.extensionMode !== vscode.ExtensionMode.Development) return false;
		if (vscode.env.uiKind !== vscode.UIKind.Desktop) return false;
		if (this.extensionUri.scheme !== "file") return false;
		const devServerPort = this.getDevServerPort();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			try {
				const response = await fetch(`http://127.0.0.1:${devServerPort}`);
				if (response.ok) {
					this.processManager.log(`[webview] dev server ready on port ${devServerPort}`);
					return true;
				}
			} catch {
				/* retry */
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		this.processManager.log(`[webview] dev server unreachable on port ${devServerPort}, falling back to dist assets`);
		return false;
	}

	private async renderHtml(webview: vscode.Webview): Promise<string> {
		if (await this.canUseDevServer()) return this.renderDevHtml();
		return this.renderProdHtml(webview);
	}

	private renderDevHtml(): string {
		const nonce = String(Date.now());
		const devServerPort = this.getDevServerPort();
		const webviewDevServer = `127.0.0.1:${devServerPort}`;
		const csp = [
			"default-src 'none'",
			`img-src data: http://${webviewDevServer} https:`,
			`font-src http://${webviewDevServer} https:`,
			`style-src 'unsafe-inline' http://${webviewDevServer}`,
			`script-src 'unsafe-eval' 'nonce-${nonce}' http://${webviewDevServer}`,
			`connect-src ws://${webviewDevServer} http://${webviewDevServer}`,
		];
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HunCode</title>
  <script nonce="${nonce}" type="module">
    import RefreshRuntime from "http://${webviewDevServer}/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="http://${webviewDevServer}/src/webview/main.tsx"></script>
</body>
</html>`;
	}

	private renderProdHtml(webview: vscode.Webview): string {
		const nonce = String(Date.now());
		const scriptHref = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"));
		const stylesCss = this.readCssAsset("dist", "webview", "styles.css");
		const mainCss = this.readCssAsset("dist", "webview", "main.css");
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HunCode</title>
  <style>
    html, body, #app { height: 100%; margin: 0; padding: 0; background: var(--vscode-sideBar-background, #0f172a); color: var(--vscode-sideBar-foreground, #f8fafc); }
    body { font: 12px/1.4 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
  </style>
  <style>${stylesCss}</style>
  <style>${mainCss}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${scriptHref}"></script>
</body>
</html>`;
	}
}
