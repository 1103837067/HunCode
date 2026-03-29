declare global {
	interface Window {
		acquireVsCodeApi?: () => {
			postMessage: (message: unknown) => void;
			getState: <T = unknown>() => T | undefined;
			setState: <T = unknown>(newState: T) => void;
		};
	}
}

export type WebviewInboundMessage =
	| { type: "ui.ready" }
	| { type: "ui.log"; message: string }
	| { type: "ui.error"; message: string }
	| { type: "prompt"; text: string; context?: unknown; images?: unknown[] }
	| { type: "newSession" }
	| { type: "abort" }
	| { type: "listModels" }
	| { type: "listSessions" }
	| { type: "openSession"; sessionPath: string }
	| { type: "setModel"; modelId: string }
	| { type: "ui.addCurrentFileContext" }
	| { type: "ui.addSelectionContext" }
	| { type: "ui.previewImage"; image: { mimeType: string; data: string } }
	| { type: "ui.setDisplayLanguage"; language: "auto" | "zh-CN" | "en" };

const vscodeApi = (globalThis as unknown as Window).acquireVsCodeApi?.();

export function postToHost(message: WebviewInboundMessage | unknown): void {
	vscodeApi?.postMessage(message);
}

export function getPersistedState<T = unknown>(): T | undefined {
	return vscodeApi?.getState<T>();
}

export function setPersistedState<T>(state: T): void {
	vscodeApi?.setState(state);
}

export function hasVsCodeApi(): boolean {
	return Boolean(vscodeApi);
}
