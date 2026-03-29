import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BoxPanelMessage, isBoxPanelBlock } from "./BoxPanelMessage.js";
import { CodeBlock } from "./CodeBlock.js";

function isExternalHref(href?: string): href is string {
	if (!href) return false;
	return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
}

function getCodeLanguage(className?: string): string | undefined {
	if (!className) return undefined;
	const match = /language-([\w-]+)/.exec(className);
	return match?.[1];
}

const components: Components = {
	table: ({ children }) => (
		<div className="pi-markdown-table-wrap">
			<table>{children}</table>
		</div>
	),
	a: ({ href, children }) => {
		if (!isExternalHref(href)) {
			return <span>{children}</span>;
		}
		return (
			<a href={href} target="_blank" rel="noreferrer noopener">
				{children}
			</a>
		);
	},
	img: () => null,
	pre: ({ children }) => <>{children}</>,
	code: ({ className, children }) => {
		const language = getCodeLanguage(className);
		if (!language) {
			return <code>{children}</code>;
		}
		return <CodeBlock language={language}>{children}</CodeBlock>;
	},
};

export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
	if (isBoxPanelBlock(content)) {
		return <BoxPanelMessage content={content} className={className} />;
	}

	return (
		<div className={className ? `pi-markdown ${className}` : "pi-markdown"}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
