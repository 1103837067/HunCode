import type { TimelineToolItem } from "../types/ui.js";

function getLastNonEmptyLine(text: string): string | undefined {
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length === 0) return undefined;
	return lines[lines.length - 1]?.trim();
}

export function getToolPreviewText(item: TimelineToolItem): string {
	const output = item.output.trim();
	if (output.length > 0) {
		return getLastNonEmptyLine(output) ?? output;
	}
	return item.summary ?? (item.state === "running" ? "Running..." : "(no output)");
}

export function getToolSummaryText(item: TimelineToolItem): string {
	return item.summary ?? (item.state === "running" ? "Running..." : "(no summary)");
}
