import * as vscode from "vscode";
import type { AppLocale, DisplayLanguageSetting } from "../webview/lib/i18n.js";
import { resolveDisplayLocale as resolveDisplayLocaleFromShared } from "../webview/lib/i18n.js";

export const DISPLAY_LANGUAGE_CONFIG_KEY = "displayLanguage";
export const CHAT_FONT_SIZE_CONFIG_KEY = "chatFontSize";
export const DISPLAY_LANGUAGE_SECTION = "pi";

export function getConfiguredDisplayLanguage(): DisplayLanguageSetting {
	const value = vscode.workspace
		.getConfiguration(DISPLAY_LANGUAGE_SECTION)
		.get<string>(DISPLAY_LANGUAGE_CONFIG_KEY, "auto");
	if (value === "zh-CN" || value === "en" || value === "auto") {
		return value;
	}
	return "auto";
}

export function resolveDisplayLocale(configured: DisplayLanguageSetting, envLanguage: string): AppLocale {
	return resolveDisplayLocaleFromShared(configured, envLanguage);
}

export function getDisplayLocale(): AppLocale {
	return resolveDisplayLocaleFromShared(getConfiguredDisplayLanguage(), vscode.env.language);
}

export function getConfiguredChatFontSize(): number {
	const value = vscode.workspace.getConfiguration(DISPLAY_LANGUAGE_SECTION).get<number>(CHAT_FONT_SIZE_CONFIG_KEY, 13);
	if (typeof value !== "number" || Number.isNaN(value)) {
		return 13;
	}
	return Math.min(18, Math.max(11, Math.round(value)));
}
