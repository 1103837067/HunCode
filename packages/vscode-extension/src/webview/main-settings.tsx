import * as React from "react";
import { createRoot } from "react-dom/client";
import { postToHost } from "./lib/vscode-api.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { createInitialState, reduceState, type WebviewState } from "./lib/state.js";
import { normalizeLocale, type AppLocale, type DisplayLanguageSetting } from "./lib/i18n.js";
import "./styles/globals.css";

function report(message: string): void {
	postToHost({ type: "ui.error", message });
}

function log(message: string): void {
	postToHost({ type: "ui.log", message });
}

const browser = globalThis as typeof globalThis & {
	document?: { getElementById?: (id: string) => unknown };
	addEventListener?: (type: string, listener: (event: any) => void) => void;
	removeEventListener?: (type: string, listener: (event: any) => void) => void;
};

class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	componentDidCatch(error: Error) {
		report(`settings render error: ${error.stack ?? error.message}`);
	}
	render() {
		if (this.state.error) {
			return (
				<div style={{ padding: 16, color: "var(--vscode-errorForeground, red)" }}>
					<p>Settings crashed: {this.state.error.message}</p>
					<button type="button" style={{ marginTop: 8, cursor: "pointer" }} onClick={() => this.setState({ error: undefined })}>
						Retry
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

function SettingsApp() {
	const [state, setState] = React.useState<WebviewState>(createInitialState);
	const [locale, setLocale] = React.useState<AppLocale>("en");
	const [displayLanguage, setDisplayLanguage] = React.useState<DisplayLanguageSetting>("auto");

	React.useEffect(() => {
		const onMessage = (event: any) => {
			const data = event?.data as Record<string, unknown> | undefined;
			if (!data?.type) return;

			if (data.type === "ui.locale" && typeof data.locale === "string") {
				setLocale(normalizeLocale(data.locale as string));
				if (data.setting === "auto" || data.setting === "zh-CN" || data.setting === "en") {
					setDisplayLanguage(data.setting as DisplayLanguageSetting);
				}
				return;
			}
			if (data.type === "models" && data.available) {
				setState((current) =>
					reduceState(current, {
						type: "setModels",
						models: data.available as Array<{ id: string; provider: string; label: string }>,
					}),
				);
				return;
			}
			if (data.type === "modelsConfig" && data.providers) {
				setState((current) => ({
					...current,
					providerConfigs: data.providers as WebviewState["providerConfigs"],
				}));
				return;
			}
			setState((current) => reduceState(current, { type: "applyAgentEvent", event: data }));
		};
		browser.addEventListener?.("message", onMessage);
		return () => browser.removeEventListener?.("message", onMessage);
	}, []);

	return (
		<SettingsPage
			locale={locale}
			state={state}
			displayLanguage={displayLanguage}
			onDisplayLanguageChange={(language) => {
				setDisplayLanguage(language);
				postToHost({ type: "ui.setDisplayLanguage", language });
			}}
			onChatFontSizeChange={(value) => {
				setState((current) => reduceState(current, { type: "setChatFontSize", value }));
				postToHost({ type: "ui.setChatFontSize", value });
			}}
			onToggleCurrentFile={() => setState((current) => reduceState(current, { type: "setAutoCurrentFile", value: !current.autoCurrentFile }))}
			onToggleSelection={() => setState((current) => reduceState(current, { type: "setAutoSelection", value: !current.autoSelection }))}
			onConfigureProvider={(payload) => postToHost({ type: "configureProvider", payload })}
			onDeleteProvider={(provider) => postToHost({ type: "deleteProvider", provider })}
			onConfigureModel={(payload) => postToHost({ type: "configureModel", payload })}
			onDeleteModel={(provider, modelId) => postToHost({ type: "deleteModel", provider, modelId })}
		/>
	);
}

postToHost({ type: "ui.ready" });
log("main-settings.tsx loaded");

browser.addEventListener?.("error", (event: any) => {
	report(`window.error: ${String(event?.message ?? event)}`);
});

browser.addEventListener?.("unhandledrejection", (event: any) => {
	report(`window.unhandledrejection: ${String(event?.reason ?? event)}`);
});

const container = browser.document?.getElementById?.("app");
if (!container) {
	throw new Error("Missing #app root");
}

try {
	const root = createRoot(container as Element);
	root.render(
		<React.StrictMode>
			<SettingsErrorBoundary>
				<SettingsApp />
			</SettingsErrorBoundary>
		</React.StrictMode>,
	);
	log("after root.render");
} catch (error) {
	report(`render bootstrap failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
