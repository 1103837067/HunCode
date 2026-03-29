import { existsSync, readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ProcessManager } from "../backend/ProcessManager.js";
import type { RpcClient } from "../backend/RpcClient.js";
import { getConfiguredDisplayLanguage, getDisplayLocale } from "../config/locale.js";
import type { DisplayLanguageSetting } from "../webview/lib/i18n.js";

const PANEL_VIEW_TYPE = "pi.settings";
const DEFAULT_WEBVIEW_DEV_PORT = 4173;

type PromptContext = {
	workspacePath?: string;
	currentFile?: { path: string; language?: string };
	selection?: { path: string; text: string; startLine?: number; endLine?: number };
};

type SettingsOutboundMessage =
	| Record<string, unknown>
	| { type: "ui.locale"; locale: string; setting: DisplayLanguageSetting }
	| { type: "ui.mode"; value: "settings" }
	| { type: "ui.context"; context: PromptContext };

export class SettingsPanel implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private webviewReady = false;
	private pendingEvents: SettingsOutboundMessage[] = [];
	private promptContext: PromptContext = {};

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly extensionMode: vscode.ExtensionMode,
		readonly _processManager: ProcessManager,
		private readonly rpcClient: RpcClient,
	) {}

	async show(): Promise<void> {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, "Pi Settings", vscode.ViewColumn.Active, {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.extensionUri, "dist"),
					vscode.Uri.joinPath(this.extensionUri, "resources"),
				],
			});
			this.panel.onDidDispose(() => {
				this.panel = undefined;
				this.webviewReady = false;
				this.pendingEvents = [];
			});
			this.panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
			this.panel.webview.html = await this.renderHtml(this.panel.webview);
		}
		this.panel.reveal(vscode.ViewColumn.Active);
		this.enqueueOrPost({ type: "ui.mode", value: "settings" });
		this.enqueueOrPost({ type: "ui.locale", locale: getDisplayLocale(), setting: getConfiguredDisplayLanguage() });
		this.enqueueOrPost({ type: "ui.context", context: this.promptContext });
		void this.refreshModelsConfig();
		void this.refreshModels();
	}

	setPromptContext(context: PromptContext): void {
		this.promptContext = context;
		this.enqueueOrPost({ type: "ui.context", context });
	}

	setLocale(): void {
		this.enqueueOrPost({ type: "ui.locale", locale: getDisplayLocale(), setting: getConfiguredDisplayLanguage() });
	}

	dispose(): void {
		this.panel?.dispose();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
	}

	private handleMessage(message: unknown): void {
		if (!message || typeof message !== "object") return;
		const event = message as Record<string, unknown>;
		if (event.type === "ui.ready") {
			this.webviewReady = true;
			for (const pending of this.pendingEvents.splice(0)) {
				void this.panel?.webview.postMessage(pending);
			}
			return;
		}
		if (event.type === "ui.log" && typeof event.message === "string") {
			console.log(`[pi][settings]`, event.message);
			return;
		}
		if (event.type === "ui.error" && typeof event.message === "string") {
			console.error(`[pi][settings]`, event.message);
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
		if (event.type === "configureProvider") {
			const p = event.payload as Record<string, unknown>;
			const { provider, ...config } = p;
			void this.mutateAndRefresh({
				type: "upsert_provider_config",
				payload: { provider, config },
			});
			return;
		}
		if (event.type === "configureModel") {
			const p = event.payload as Record<string, unknown>;
			const { provider, modelId, ...rest } = p;
			void this.mutateAndRefresh({
				type: "upsert_model_config",
				payload: { provider, model: { id: modelId, ...rest } },
			});
			return;
		}
		if (event.type === "deleteProvider" && typeof event.provider === "string") {
			void this.mutateAndRefresh({ type: "delete_provider_config", provider: event.provider });
			return;
		}
		if (event.type === "deleteModel" && typeof event.provider === "string" && typeof event.modelId === "string") {
			void this.mutateAndRefresh({ type: "delete_model_config", provider: event.provider, modelId: event.modelId });
		}
	}

	private async mutateAndRefresh(command: Record<string, unknown>): Promise<void> {
		try {
			await this.rpcClient.request(command);
		} catch {
			// mutation failed, still try to refresh to show current state
		}
		await Promise.all([this.refreshModelsConfig(), this.refreshModels()]);
	}

	private enqueueOrPost(event: SettingsOutboundMessage): void {
		if (!this.panel) return;
		if (!this.webviewReady) {
			this.pendingEvents.push(event);
			return;
		}
		void this.panel.webview.postMessage(event);
	}

	private async refreshModels(): Promise<void> {
		try {
			const data = await this.rpcClient.request<{ models: Array<{ id: string; provider: string }> }>({
				type: "get_available_models",
			});
			this.enqueueOrPost({
				type: "models",
				available: data.models.map((item) => ({
					id: item.id,
					provider: item.provider,
					label: `${item.provider}/${item.id}`,
				})),
			});
		} catch {
			// RPC not ready yet
		}
	}

	private async refreshModelsConfig(): Promise<void> {
		try {
			const data = await this.rpcClient.request<{ config: { providers?: Record<string, Record<string, unknown>> } }>(
				{ type: "get_models_config" },
			);
			const providers = Object.fromEntries(
				Object.entries(data.config.providers ?? {}).map(([name, config]) => [
					name,
					{
						baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : undefined,
						api: typeof config.api === "string" ? config.api : undefined,
						apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
						authHeader: typeof config.authHeader === "boolean" ? config.authHeader : undefined,
						headers:
							config.headers && typeof config.headers === "object"
								? (config.headers as Record<string, string>)
								: undefined,
						compat:
							config.compat && typeof config.compat === "object"
								? (config.compat as Record<string, unknown>)
								: undefined,
					},
				]),
			);
			this.enqueueOrPost({ type: "modelsConfig", providers });
		} catch {
			// RPC not ready yet
		}
	}

	private getDevServerPort(): number {
		const portFile = vscode.Uri.joinPath(this.extensionUri, ".vite-port").fsPath;
		try {
			if (existsSync(portFile)) {
				const value = Number.parseInt(readFileSync(portFile, "utf8").trim(), 10);
				if (Number.isFinite(value)) return value;
			}
		} catch {
			/* ignore */
		}
		return DEFAULT_WEBVIEW_DEV_PORT;
	}

	private async canUseDevServer(): Promise<boolean> {
		if (this.extensionMode !== vscode.ExtensionMode.Development) return false;
		if (vscode.env.uiKind !== vscode.UIKind.Desktop) return false;
		if (this.extensionUri.scheme !== "file") return false;
		const port = this.getDevServerPort();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}`);
				if (response.ok) return true;
			} catch {
				/* retry */
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return false;
	}

	private async renderHtml(webview: vscode.Webview): Promise<string> {
		if (await this.canUseDevServer()) {
			const nonce = String(Date.now());
			const port = this.getDevServerPort();
			const host = `127.0.0.1:${port}`;
			return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http://${host} https:; font-src http://${host} https:; style-src 'unsafe-inline' http://${host}; script-src 'unsafe-eval' 'nonce-${nonce}' http://${host}; connect-src ws://${host} http://${host};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pi Settings</title>
  <script nonce="${nonce}" type="module">
    import RefreshRuntime from "http://${host}/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="http://${host}/src/webview/main-settings.tsx"></script>
</body>
</html>`;
		}
		const nonce = String(Date.now());
		const scriptHref = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main-settings.js"),
		);
		const stylesCss = readFileSync(
			vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "styles.css").fsPath,
			"utf8",
		);
		const mainCss = readFileSync(
			vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css").fsPath,
			"utf8",
		);
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pi Settings</title>
  <style>html, body, #app { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }</style>
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
