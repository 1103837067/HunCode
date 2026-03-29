import * as React from "react";
import { createRoot } from "react-dom/client";
import { App, AppErrorBoundary } from "./app/App.js";
import { postToHost } from "./lib/vscode-api.js";
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
};

postToHost({ type: "ui.ready" });
log("main.tsx loaded");

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
			<AppErrorBoundary>
				<App />
			</AppErrorBoundary>
		</React.StrictMode>,
	);
	log("after root.render");
} catch (error) {
	report(`render bootstrap failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
