import * as React from "react";
import { Check, Copy } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

function normalizeCodeContent(value: React.ReactNode): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) {
		return value.map((item) => normalizeCodeContent(item)).join("");
	}
	return "";
}

function getClipboardApi(): { writeText?: (text: string) => Promise<void> } | undefined {
	const navigatorLike = globalThis.navigator as { clipboard?: { writeText?: (text: string) => Promise<void> } } | undefined;
	return navigatorLike?.clipboard;
}

function normalizeLanguage(language?: string): string {
	if (!language) return "text";
	const normalized = language.trim().toLowerCase();
	const aliases: Record<string, string> = {
		js: "javascript",
		ts: "typescript",
		sh: "bash",
		shell: "bash",
		yml: "yaml",
		md: "markdown",
	};
	return aliases[normalized] ?? normalized;
}

function highlightCode(code: string, language?: string): string {
	const normalizedLanguage = normalizeLanguage(language);
	const grammar = Prism.languages[normalizedLanguage];
	if (!grammar) {
		return code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}
	return Prism.highlight(code, grammar, normalizedLanguage);
}

function setSafeTimeout(callback: () => void, delay: number): ReturnType<typeof globalThis.setTimeout> {
	return globalThis.setTimeout(callback, delay);
}

function clearSafeTimeout(id: ReturnType<typeof globalThis.setTimeout>): void {
	globalThis.clearTimeout(id);
}

export function CodeBlock({ language, children }: { language?: string; children: React.ReactNode }) {
	const [copied, setCopied] = React.useState(false);
	const resetTimerRef = React.useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
	const code = React.useMemo(() => normalizeCodeContent(children).replace(/\n$/, ""), [children]);
	const normalizedLanguage = React.useMemo(() => normalizeLanguage(language), [language]);
	const highlightedHtml = React.useMemo(() => highlightCode(code, normalizedLanguage), [code, normalizedLanguage]);

	React.useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				clearSafeTimeout(resetTimerRef.current);
			}
		};
	}, []);

	const handleCopy = React.useCallback(async () => {
		if (!code) return;
		const clipboard = getClipboardApi();
		if (!clipboard?.writeText) return;
		try {
			await clipboard.writeText(code);
			setCopied(true);
			if (resetTimerRef.current !== null) {
				clearSafeTimeout(resetTimerRef.current);
			}
			resetTimerRef.current = setSafeTimeout(() => {
				setCopied(false);
				resetTimerRef.current = null;
			}, 1800);
		} catch {
			setCopied(false);
		}
	}, [code]);

	return (
		<div className="pi-code-block">
			<div className="pi-code-block__header">
				<span className="pi-code-block__language">{normalizedLanguage}</span>
				<button
					type="button"
					className="pi-code-block__copy"
					onClick={handleCopy}
					aria-label={copied ? "Copied" : "Copy code"}
					title={copied ? "Copied" : "Copy code"}
				>
					{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
					<span>{copied ? "已复制" : "Copy"}</span>
				</button>
			</div>
			<pre>
				<code className={`language-${normalizedLanguage}`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
			</pre>
		</div>
	);
}
