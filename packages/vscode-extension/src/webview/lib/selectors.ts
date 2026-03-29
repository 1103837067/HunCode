import type { AppLocale } from "./i18n.js";
import { t } from "./i18n.js";
import type { WebviewState } from "./state.js";

export function getActiveModelLabel(state: WebviewState, locale: AppLocale): string {
	return state.model ?? t(locale, "noModels");
}

export function getConnectionSummary(state: WebviewState, locale: AppLocale): string {
	if (state.lastError) return state.lastError;
	if (state.connectionState === "error") return t(locale, "connectionError");
	if (state.sessionId || state.rpcState === "connected" || state.backendState === "running")
		return t(locale, "connected");
	if (state.backendState === "starting") return t(locale, "connecting");
	if (state.backendState === "exited") return t(locale, "connectionError");
	return t(locale, "connecting");
}

export function isChatBusy(state: WebviewState): boolean {
	return state.status === "thinking" || state.status === "running-tools";
}

export function getEmptyStateMode(state: WebviewState): "no-model" | "error" | "disconnected" | "ready" {
	if (!state.model && state.availableModels.length === 0) return "no-model";
	if (state.connectionState === "error" || state.lastError) return "error";
	if (!state.sessionId && state.rpcState === "disconnected") return "disconnected";
	return "ready";
}
