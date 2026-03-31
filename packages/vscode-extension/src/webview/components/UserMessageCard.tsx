import * as React from "react";
import type { TimelineUserItem } from "../types/ui.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { PromptCollapsedCard, PromptEditorCard, type PromptEditorImage } from "./PromptEditorCard.js";

export function UserMessageCard({ item }: { item: TimelineUserItem }) {
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
		<div ref={containerRef}>
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
