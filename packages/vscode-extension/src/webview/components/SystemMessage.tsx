import { Sparkles, TriangleAlert } from "lucide-react";
import type { TimelineSystemItem } from "../types/ui.js";

export function SystemMessage({ item }: { item: TimelineSystemItem }) {
	const isError = item.level === "error";
	return (
		<div role={isError ? "alert" : "status"} className={isError ? "px-2 py-1 text-xs text-[var(--vscode-errorForeground)]" : "px-2 py-1 text-xs text-muted"}>
			<div className="flex items-start gap-2">
				{isError ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 text-foreground/80" />}
				<span className="leading-5">{item.text}</span>
			</div>
		</div>
	);
}
