import { ScrollArea } from "../ui/scroll-area.js";
import type { WebviewState } from "../lib/state.js";
import { ChatTimeline } from "../components/ChatTimeline.js";
import { ReactComposer } from "../components/ReactComposer.js";

export function ChatPage({
	state,
	onToggleTool,
	onRemoveContext,
	onAddCurrentFile,
	onAddSelection,
	onSelectModel,
	onRefreshModels,
	onStop,
	onDraftChange,
	onSubmit,
}: {
	state: WebviewState;
	onToggleTool: (toolCallId: string) => void;
	onRemoveContext: (pill: WebviewState["contextPills"][number]) => void;
	onAddCurrentFile: () => void;
	onAddSelection: () => void;
	onSelectModel: (modelId: string) => void;
	onRefreshModels?: () => void;
	onStop: () => void;
	onDraftChange: (draft: string) => void;
	onSubmit: (text: string, images?: { type: "image"; mimeType: string; data: string }[]) => void;
}) {
	const hasTimeline = state.timeline.length > 0;

	return (
		<>
			<ScrollArea className="flex-1">
				<div className="flex min-h-full flex-col px-3 pt-3 pb-0">
					{hasTimeline ? <ChatTimeline timeline={state.timeline} onToggleTool={onToggleTool} /> : <div className="flex-1" />}
				</div>
			</ScrollArea>
			<ReactComposer
				draft={state.draft}
				model={state.model}
				availableModels={state.availableModels}
				isBusy={state.status === "thinking" || state.status === "running-tools"}
				contextPills={state.contextPills}
				onRemoveContext={onRemoveContext}
				onAddCurrentFile={onAddCurrentFile}
				onAddSelection={onAddSelection}
				onSelectModel={onSelectModel}
				onRefreshModels={onRefreshModels}
				onStop={onStop}
				onDraftChange={onDraftChange}
				onSubmit={onSubmit}
			/>
		</>
	);
}
