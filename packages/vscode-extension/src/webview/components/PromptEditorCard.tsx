import * as React from "react";
import { FilePlus2, ImagePlus, ScissorsLineDashed, SendHorizonal, Square, X } from "lucide-react";
import { postToHost } from "../lib/vscode-api.js";
import type { ContextPill } from "../types/ui.js";
import { Button } from "../ui/button.js";
import { ModelSelector } from "./ModelSelector.js";
import { ReactContextPills } from "./ReactContextPills.js";

export interface PromptEditorImage {
	id: string;
	mimeType: string;
	data: string;
}

export function PromptEditorCard({
	value,
	model,
	availableModels,
	isBusy,
	contextPills,
	images,
	sendDisabled,
	showFooterTools,
	autoFocus,
	onRemoveContext,
	onImagesChange,
	onAddCurrentFile,
	onAddSelection,
	onSelectModel,
	onRefreshModels,
	onSubmit,
	onStop,
	onChange,
}: {
	value: string;
	model?: string;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	isBusy: boolean;
	contextPills: ContextPill[];
	images: PromptEditorImage[];
	sendDisabled?: boolean;
	showFooterTools?: boolean;
	autoFocus?: boolean;
	onRemoveContext: (pill: ContextPill) => void;
	onImagesChange: (images: PromptEditorImage[]) => void;
	onAddCurrentFile: () => void;
	onAddSelection: () => void;
	onSelectModel: (modelId: string) => void;
	onRefreshModels?: () => void;
	onSubmit: (text: string, images?: { type: "image"; mimeType: string; data: string }[]) => void;
	onStop: () => void;
	onChange: (draft: string) => void;
}) {
	const textareaRef = React.useRef<any>(null);
	const fileInputRef = React.useRef<any>(null);

	const adjustHeight = React.useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
	}, []);

	React.useEffect(() => {
		adjustHeight();
	}, [value, adjustHeight]);

	React.useEffect(() => {
		if (!autoFocus) return;
		const el = textareaRef.current;
		if (!el) return;
		const timer = setTimeout(() => {
			el.focus?.();
			const length = typeof el.value === "string" ? el.value.length : 0;
			el.setSelectionRange?.(length, length);
		}, 0);
		return () => clearTimeout(timer);
	}, [autoFocus]);

	const handleImageAdd = React.useCallback(async (file: any) => {
		if (!file.type.startsWith("image/")) return;
		const reader = new (globalThis as any).FileReader();
		reader.onload = (event: any) => {
			const base64WithPrefix = event.target?.result as string;
			const data = base64WithPrefix.split(",")[1];
			if (data) {
				onImagesChange([...images, { id: Math.random().toString(36).slice(2), mimeType: file.type, data }]);
			}
		};
		reader.readAsDataURL(file);
	}, [images, onImagesChange]);

	const onPaste = React.useCallback((event: any) => {
		if (!event.clipboardData?.items) return;
		for (const item of Array.from(event.clipboardData.items) as any[]) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					event.preventDefault();
					void handleImageAdd(file);
				}
			}
		}
	}, [handleImageAdd]);

	const onFileSelected = React.useCallback((event: any) => {
		const files = event.target.files;
		if (!files) return;
		for (const file of Array.from(files)) {
			void handleImageAdd(file);
		}
		event.target.value = "";
	}, [handleImageAdd]);

	const onFormSubmit = React.useCallback((event?: React.FormEvent<HTMLFormElement>) => {
		event?.preventDefault();
		const text = value.trim();
		if (isBusy) {
			onStop();
			return;
		}
		if (sendDisabled) return;
		if (text.length > 0 || images.length > 0) {
			const imagesPayload = images.length > 0 ? images.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data })) : undefined;
			onSubmit(text, imagesPayload);
			onImagesChange([]);
		}
	}, [images, isBusy, onImagesChange, onStop, onSubmit, sendDisabled, value]);

	const submitDisabled = sendDisabled || (!isBusy && value.trim().length === 0 && images.length === 0);

	return (
		<form className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2 shadow-sm" onSubmit={onFormSubmit}>
			{contextPills.length > 0 ? <ReactContextPills pills={contextPills} onRemove={onRemoveContext} /> : null}
			{images.length > 0 ? (
				<div className="flex overflow-hidden gap-1.5 px-1 pb-1">
					{images.map((img) => (
						<div
							key={img.id}
							className="group relative h-10 w-10 flex-shrink-0 cursor-pointer overflow-hidden rounded-md bg-transparent select-none shadow-md"
							onClick={() => postToHost({ type: "ui.previewImage", image: { mimeType: img.mimeType, data: img.data } })}
						>
							<img src={`data:${img.mimeType};base64,${img.data}`} alt="Paste" className="block h-full w-full object-cover pointer-events-none" />
							<button
								type="button"
								className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 group-hover:flex"
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									onImagesChange(images.filter((item) => item.id !== img.id));
								}}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			) : null}
			<textarea
				ref={textareaRef}
				className="message-text w-full resize-none overflow-y-auto bg-transparent px-1 py-1 outline-none placeholder:text-muted"
				rows={1}
				style={{ minHeight: "20px", maxHeight: "180px" }}
				placeholder="Ask anything..."
				value={value}
				onPaste={onPaste}
				onChange={(event: any) => {
					onChange(event.currentTarget.value);
					adjustHeight();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						onFormSubmit();
					}
				}}
			/>
			{showFooterTools === false ? null : (
				<div className="flex items-center justify-between gap-1 pt-2">
					<div className="flex min-w-0 items-center gap-1">
						<ModelSelector model={model} availableModels={availableModels} onSelectModel={onSelectModel} onOpen={onRefreshModels} />
					</div>
					<div className="flex flex-shrink-0 items-center gap-0.5">
						<input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={onFileSelected} />
						<Button className="h-6 w-6 rounded-[4px] text-foreground/80 hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-foreground" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} title="Add Image" type="button">
							<ImagePlus className="h-3.5 w-3.5 stroke-[2]" />
						</Button>
						<Button className="h-6 w-6 rounded-[4px] text-foreground/80 hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-foreground" variant="ghost" size="icon" onClick={onAddCurrentFile} title="Add File" type="button">
							<FilePlus2 className="h-3.5 w-3.5 stroke-[2]" />
						</Button>
						<Button className="h-6 w-6 rounded-[4px] text-foreground/80 hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-foreground" variant="ghost" size="icon" onClick={onAddSelection} title="Add Selection" type="button">
							<ScissorsLineDashed className="h-3.5 w-3.5 stroke-[2]" />
						</Button>
						<div className="mx-0.5 h-3.5 w-[1px] bg-[var(--vscode-widget-border)] opacity-50"></div>
						<Button
							className={[
								"h-6 w-6 min-w-0 rounded-full border-0 border-transparent p-0",
								"flex items-center justify-center overflow-hidden",
								"[&::part(control)]:h-full [&::part(control)]:w-full [&::part(control)]:min-w-0 [&::part(control)]:rounded-full [&::part(control)]:border-0 [&::part(control)]:border-transparent [&::part(control)]:p-0",
								"[&::part(control)]:flex [&::part(control)]:items-center [&::part(control)]:justify-center",
								isBusy ? "[&::part(control)]:bg-[var(--vscode-errorForeground)] [&::part(control)]:text-white [&::part(control)]:hover:bg-[var(--vscode-errorForeground)] hover:opacity-80" : "[&::part(control)]:bg-[var(--vscode-button-background)] [&::part(control)]:text-[var(--vscode-button-foreground)] [&::part(control)]:hover:bg-[var(--vscode-button-hoverBackground)] transition-opacity",
								submitDisabled ? "opacity-40" : "hover:opacity-90",
							].join(" ")}
							disabled={submitDisabled}
							type="submit"
							title={isBusy ? "Stop" : "Send"}
						>
							{isBusy ? <Square className="h-3 w-3 fill-current" /> : <SendHorizonal className="h-3.5 w-3.5 stroke-[2]" />}
						</Button>
					</div>
				</div>
			)}
		</form>
	);
}

export function PromptCollapsedCard({
	content,
	contextPills,
	onClick,
}: {
	content: React.ReactNode;
	contextPills: ContextPill[];
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-2 text-left shadow-sm transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
		>
			<div className="px-1 py-1 text-foreground message-text">{content}</div>
			{contextPills.length > 0 ? <ReactContextPills pills={contextPills} /> : null}
		</button>
	);
}
