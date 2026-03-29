import * as React from "react";
import type { TimelineToolItem } from "../types/ui.js";

export type ToolRenderer = {
	kind: "generic" | "enhanced";
	render: (item: TimelineToolItem) => React.ReactNode;
};

const enhancedRenderers = new Map<string, ToolRenderer>();

export function registerToolRenderer(name: string, renderer: ToolRenderer): void {
	enhancedRenderers.set(name, renderer);
}

export function getToolRenderer(name: string): ToolRenderer {
	return (
		enhancedRenderers.get(name) ?? {
			kind: "generic",
			render: () => null,
		}
	);
}
