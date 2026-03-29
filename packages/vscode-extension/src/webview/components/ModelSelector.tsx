import * as React from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";

// provider icon mapping
function getProviderIcon(provider: string) {
	switch (provider.toLowerCase()) {
		case "anthropic":
			return "🐜"; // placeholder
		case "openai":
			return "⚡️";
		default:
			return <Cpu className="h-3 w-3" />;
	}
}

interface ModelSelectorProps {
	model?: string;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	onSelectModel: (modelId: string) => void;
	onOpen?: () => void;
}

export function ModelSelector({ model, availableModels, onSelectModel, onOpen }: ModelSelectorProps) {
	const [isOpen, setIsOpen] = React.useState(false);
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		function handleClickOutside(event: any) {
			if (containerRef.current && !(containerRef.current as any).contains(event.target)) {
				setIsOpen(false);
			}
		}
		const doc = (globalThis as any).document;
		if (doc) {
			doc.addEventListener("mousedown", handleClickOutside);
			return () => {
				doc.removeEventListener("mousedown", handleClickOutside);
			};
		}
	}, []);

	// Group models by provider
	const groupedModels = React.useMemo(() => {
		const groups: Record<string, typeof availableModels> = {};
		for (const m of availableModels) {
			if (!groups[m.provider]) {
				groups[m.provider] = [];
			}
			groups[m.provider].push(m);
		}
		return groups;
	}, [availableModels]);

	// Format text logic
	const currentLabel = React.useMemo(() => {
		if (availableModels.length === 0) return "No models";
		if (!model) return "Model";
		const found = availableModels.find((m) => `${m.provider}/${m.id}` === model);
		return found ? found.label : model;
	}, [model, availableModels]);

	return (
		<div className="relative inline-block text-left" ref={containerRef}>
			<button
				type="button"
				onClick={() => {
					const next = !isOpen;
					setIsOpen(next);
					if (next) onOpen?.();
				}}
				disabled={availableModels.length === 0}
				className="flex h-6 min-w-24 max-w-40 items-center justify-between gap-1.5 rounded-[4px] px-1.5 text-[11px] font-medium text-foreground hover:bg-[var(--vscode-toolbar-hoverBackground)] focus:outline-none disabled:opacity-50"
			>
				<span className="truncate">{currentLabel}</span>
				<ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
			</button>

			{isOpen && availableModels.length > 0 && (
				<div 
					className="absolute bottom-full left-0 z-[100] mb-1 min-w-[220px] origin-bottom-left rounded-[6px] border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] py-1 shadow-[0_4px_16px_var(--vscode-widget-shadow)]"
				>
					<div className="max-h-[300px] overflow-y-auto outline-none">
						{Object.entries(groupedModels).map(([provider, models], groupIndex) => (
							<div key={provider}>
								{groupIndex > 0 && <div className="mx-2 my-1 h-[1px] bg-[var(--vscode-widget-border)]" />}
								<div className="flex items-center px-2.5 py-1 text-[10px] font-semibold text-[var(--vscode-descriptionForeground)]">
									<span className="mr-1.5 opacity-70">{getProviderIcon(provider)}</span>
									{provider.toUpperCase()}
								</div>
								<div className="flex flex-col">
									{models.map((m) => {
										const fullId = `${m.provider}/${m.id}`;
										const isSelected = fullId === model;
										return (
											<button
												key={fullId}
												type="button"
												onClick={() => {
													onSelectModel(fullId);
													setIsOpen(false);
												}}
												className={[
													"group flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px]",
													isSelected 
														? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]" 
														: "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
												].join(" ")}
											>
												<span className="truncate pr-4">{m.label}</span>
												{isSelected && <Check className="h-3 w-3 shrink-0" />}
											</button>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
