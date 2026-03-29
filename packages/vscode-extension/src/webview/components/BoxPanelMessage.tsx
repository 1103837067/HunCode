import stringWidth from "string-width";

function isBoxDrawingLine(line: string): boolean {
	return /[┌┐└┘├┤┬┴┼│─]/.test(line);
}

export function isBoxPanelBlock(content: string): boolean {
	const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length < 3) return false;
	const boxLineCount = lines.filter((line) => isBoxDrawingLine(line)).length;
	const markerCount = lines.filter((line) => line.includes("▎[") || line.includes("│") || line.includes("┌") || line.includes("└")).length;
	return boxLineCount >= 3 && markerCount >= 3;
}

function normalizeBoxPanelContent(content: string): string {
	return content
		.replace(/｜/g, "│")
		.replace(/－/g, "─")
		.replace(/　/g, " ");
}

function padToDisplayWidth(text: string, targetWidth: number): string {
	const width = stringWidth(text);
	if (width >= targetWidth) return text;
	return text + " ".repeat(targetWidth - width);
}

function findRightBorderIndex(line: string): number {
	for (let index = line.length - 1; index >= 0; index -= 1) {
		if (line[index] === "│") {
			return index;
		}
	}
	return -1;
}

function alignBoxPanelContent(content: string): string {
	const lines = normalizeBoxPanelContent(content).split(/\r?\n/);
	const contentLines = lines
		.map((line, index) => {
			const first = line.indexOf("│");
			const last = findRightBorderIndex(line);
			if (first < 0 || last <= first) return null;
			const leftEdge = line.slice(0, first + 1);
			const inner = line.slice(first + 1, last);
			const rightEdge = line.slice(last);
			return { index, leftEdge, inner, rightEdge, width: stringWidth(inner) };
		})
		.filter((value): value is { index: number; leftEdge: string; inner: string; rightEdge: string; width: number } => value !== null);

	if (contentLines.length === 0) {
		return lines.join("\n");
	}

	const targetWidth = Math.max(...contentLines.map((line) => line.width));
	const alignedLines = [...lines];
	for (const line of contentLines) {
		alignedLines[line.index] = `${line.leftEdge}${padToDisplayWidth(line.inner, targetWidth)}${line.rightEdge}`;
	}
	return alignedLines.join("\n");
}

export function BoxPanelMessage({ content, className }: { content: string; className?: string }) {
	const alignedContent = alignBoxPanelContent(content);
	return (
		<pre className={className ? `pi-box-panel ${className}` : "pi-box-panel"}>
			<code>{alignedContent}</code>
		</pre>
	);
}
