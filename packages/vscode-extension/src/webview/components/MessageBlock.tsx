import * as React from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import type { TimelineAssistantItem, TimelineSystemItem, TimelineUserItem } from "../types/ui.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { PromptCollapsedCard, PromptEditorCard, type PromptEditorImage } from "./PromptEditorCard.js";

export function MessageBlock({
	item,
}: {
	item: TimelineAssistantItem | TimelineUserItem | TimelineSystemItem;
}) {
	if (item.kind === "system") {
		const isError = item.level === "error";
		return (
			<div
				role={isError ? "alert" : "status"}
				className={isError ? "px-2 py-1 text-xs text-[var(--vscode-errorForeground)]" : "px-2 py-1 text-xs text-muted"}
			>
				<div className="flex items-start gap-2">
					{isError ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 text-foreground/80" />}
					<span className="leading-5">{item.text}</span>
				</div>
			</div>
		);
	}

	if (item.kind === "assistant") {
		return (
			<div className="px-3 py-1.5">
				<div className="text-foreground message-text">
					<MarkdownMessage content={item.text || (item.isStreaming ? "Thinking..." : "")} />
				</div>
			</div>
		);
	}

	return <UserMessageCard item={item} />;
}

function UserMessageCard({ item }: { item: TimelineUserItem }) {
	const [expanded, setExpanded] = React.useState(false);
	const [value, setValue] = React.useState(item.text);
	const [images, setImages] = React.useState<PromptEditorImage[]>([]);
	const containerRef = React.useRef<any>(null);

	React.useEffect(() => {
		if (!expanded) {
			setValue(item.text);
			setImages([]);
		}
	}, [expanded, item.text]);

	React.useEffect(() => {
		if (!expanded) return;
		const doc = (globalThis as any).document;
		if (!doc) return;
		const handlePointerDown = (event: any) => {
			if (containerRef.current && !containerRef.current.contains(event.target)) {
				setExpanded(false);
			}
		};
		doc.addEventListener("mousedown", handlePointerDown);
		return () => {
			doc.removeEventListener("mousedown", handlePointerDown);
		};
	}, [expanded]);

	return (
		<div className="py-1.5" ref={containerRef}>
			{expanded ? (
				<PromptEditorCard
					value={value}
					model={undefined}
					availableModels={[]}
					isBusy={false}
					contextPills={item.context}
					images={images}
					sendDisabled
					autoFocus
					onRemoveContext={() => {}}
					onImagesChange={setImages}
					onAddCurrentFile={() => {}}
					onAddSelection={() => {}}
					onSelectModel={() => {}}
					onSubmit={() => {}}
					onStop={() => {}}
					onChange={setValue}
				/>
			) : (
				<PromptCollapsedCard
					content={<MarkdownMessage content={item.text} />}
					contextPills={item.context}
					onClick={() => setExpanded(true)}
				/>
			)}
		</div>
	);
}
