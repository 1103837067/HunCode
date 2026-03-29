import { describe, expect, it } from "vitest";
import { normalizeLocale, resolveDisplayLocale } from "../src/webview/lib/i18n.js";

describe("locale resolution", () => {
	it("normalizes zh variants to zh-CN", () => {
		expect(normalizeLocale("zh-cn")).toBe("zh-CN");
		expect(normalizeLocale("zh-TW")).toBe("zh-CN");
	});

	it("falls back to english for non-zh locales", () => {
		expect(normalizeLocale("en-us")).toBe("en");
		expect(normalizeLocale("fr")).toBe("en");
		expect(normalizeLocale(undefined)).toBe("en");
	});

	it("uses explicit configured language when not auto", () => {
		expect(resolveDisplayLocale("zh-CN", "en-us")).toBe("zh-CN");
		expect(resolveDisplayLocale("en", "zh-cn")).toBe("en");
	});

	it("follows environment language in auto mode", () => {
		expect(resolveDisplayLocale("auto", "zh-cn")).toBe("zh-CN");
		expect(resolveDisplayLocale("auto", "en-us")).toBe("en");
	});
});
