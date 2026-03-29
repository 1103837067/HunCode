import * as React from "react";
import type { ContextPill } from "../types/ui.js";
import { PromptEditorCard, type PromptEditorImage } from "./PromptEditorCard.js";

export function ReactComposer({
	draft,
	model,
	availableModels,
	isBusy,
	contextPills,
	onRemoveContext,
	onAddCurrentFile,
	onAddSelection,
	onSelectModel,
	onRefreshModels,
	onSubmit,
	onStop,
	onDraftChange,
}: {
	draft: string;
	model?: string;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	isBusy: boolean;
	contextPills: ContextPill[];
	onRemoveContext: (pill: ContextPill) => void;
	onAddCurrentFile: () => void;
	onAddSelection: () => void;
	onSelectModel: (modelId: string) => void;
	onRefreshModels?: () => void;
	onSubmit: (text: string, images?: { type: "image"; mimeType: string; data: string }[]) => void;
	onStop: () => void;
	onDraftChange: (draft: string) => void;
}) {
	const [images, setImages] = React.useState<PromptEditorImage[]>([]);

	return (
		<div className="bg-background px-3 pb-4 pt-0">
			<PromptEditorCard
				value={draft}
				model={model}
				availableModels={availableModels}
				isBusy={isBusy}
				contextPills={contextPills}
				images={images}
				onRemoveContext={onRemoveContext}
				onImagesChange={setImages}
				onAddCurrentFile={onAddCurrentFile}
				onAddSelection={onAddSelection}
				onSelectModel={onSelectModel}
				onRefreshModels={onRefreshModels}
				onSubmit={onSubmit}
				onStop={onStop}
				onChange={onDraftChange}
			/>
		</div>
	);
}
