import * as React from "react";
import { ChevronDown, ChevronUp, Cpu, Plus, Trash2 } from "lucide-react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import type { ConfigureModelPayload, ConfigureProviderPayload, ProviderConfigState } from "../types/ui.js";
import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { Select } from "../ui/select.js";
import { Separator } from "../ui/separator.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import { SettingsSection } from "./SettingsSection.js";

interface ModelListItem {
	id: string;
	provider: string;
	label: string;
	isActive: boolean;
	isEnabled: boolean;
}

interface ProviderFormState {
	provider: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	authHeader: boolean;
	headersJson: string;
	compatJson: string;
}

interface ModelFormState {
	provider: string;
	modelId: string;
	name: string;
	reasoning: boolean;
	inputText: boolean;
	inputImage: boolean;
	contextWindow: string;
	maxTokens: string;
	headersJson: string;
	costJson: string;
	compatJson: string;
}

const API_OPTIONS = [
	{ value: "openai-completions", label: "openai-completions" },
	{ value: "openai-responses", label: "openai-responses" },
	{ value: "anthropic-messages", label: "anthropic-messages" },
	{ value: "google-generative-ai", label: "google-generative-ai" },
];

function buildInitialProviderFormState(): ProviderFormState {
	return {
		provider: "",
		baseUrl: "",
		api: "openai-completions",
		apiKey: "",
		authHeader: false,
		headersJson: "",
		compatJson: "",
	};
}

function buildInitialModelFormState(providers: string[]): ModelFormState {
	return {
		provider: providers[0] ?? "",
		modelId: "",
		name: "",
		reasoning: false,
		inputText: true,
		inputImage: false,
		contextWindow: "",
		maxTokens: "",
		headersJson: "",
		costJson: "",
		compatJson: "",
	};
}

function parseJsonObject<T>(value: string): T | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return JSON.parse(trimmed) as T;
}

function inputValue(e: { target: unknown }): string {
	return String(((e as Record<string, unknown>).target as Record<string, unknown>)?.value ?? "");
}

export function ModelSettingsCard({
	locale,
	model,
	availableModels,
	providerConfigs,
	onConfigureProvider,
	onDeleteProvider,
	onConfigureModel,
	onDeleteModel,
}: {
	locale: AppLocale;
	model?: string;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	providerConfigs: Record<string, ProviderConfigState>;
	onConfigureProvider: (payload: ConfigureProviderPayload) => void;
	onDeleteProvider: (provider: string) => void;
	onConfigureModel: (payload: ConfigureModelPayload) => void;
	onDeleteModel: (provider: string, modelId: string) => void;
}) {
	const providers = React.useMemo(() => {
		const set = new Set(availableModels.map((item) => item.provider));
		for (const key of Object.keys(providerConfigs)) set.add(key);
		return Array.from(set).sort();
	}, [availableModels, providerConfigs]);
	const [expanded, setExpanded] = React.useState(false);
	const [showAddProvider, setShowAddProvider] = React.useState(false);
	const [showAddModel, setShowAddModel] = React.useState(false);
	const [showModelAdvanced, setShowModelAdvanced] = React.useState(false);
	const [localEnabled, setLocalEnabled] = React.useState<Record<string, boolean>>({});
	const [expandedProviders, setExpandedProviders] = React.useState<Record<string, boolean>>({});
	const [providerForm, setProviderForm] = React.useState<ProviderFormState>(buildInitialProviderFormState);
	const [modelForm, setModelForm] = React.useState<ModelFormState>(() => buildInitialModelFormState(providers));

	React.useEffect(() => {
		setModelForm((current) => (current.provider && providers.includes(current.provider) ? current : buildInitialModelFormState(providers)));
	}, [providers]);

	const items = React.useMemo<ModelListItem[]>(() => {
		return availableModels
			.map((item) => {
				const fullId = `${item.provider}/${item.id}`;
				return {
					...item,
					isActive: model === fullId,
					isEnabled: localEnabled[fullId] ?? true,
				};
			})
			.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.label.localeCompare(b.label));
	}, [availableModels, localEnabled, model]);

	const visibleItems = expanded ? items : items.slice(0, 15);
	const canExpand = items.length > 15;
	const providerEntries = React.useMemo(
		() =>
			providers.map((provider) => ({
				name: provider,
				modelCount: availableModels.filter((item) => item.provider === provider).length,
				config: providerConfigs[provider],
			})),
		[availableModels, providerConfigs, providers],
	);

	const submitProviderForm = () => {
		if (!providerForm.provider.trim() || !providerForm.baseUrl.trim() || !providerForm.api || !providerForm.apiKey.trim()) {
			return;
		}
		try {
			onConfigureProvider({
				provider: providerForm.provider.trim(),
				baseUrl: providerForm.baseUrl.trim(),
				api: providerForm.api,
				apiKey: providerForm.apiKey.trim(),
				...(providerForm.authHeader ? { authHeader: true } : {}),
				...(parseJsonObject<Record<string, string>>(providerForm.headersJson) ? { headers: parseJsonObject<Record<string, string>>(providerForm.headersJson) } : {}),
				...(parseJsonObject<Record<string, unknown>>(providerForm.compatJson) ? { compat: parseJsonObject<Record<string, unknown>>(providerForm.compatJson) } : {}),
			});
			setShowAddProvider(false);
			setProviderForm(buildInitialProviderFormState());
		} catch {
			return;
		}
	};

	const submitModelForm = () => {
		if (!modelForm.provider || !modelForm.modelId.trim()) return;
		const input: Array<"text" | "image"> = [];
		if (modelForm.inputText) input.push("text");
		if (modelForm.inputImage) input.push("image");
		try {
			onConfigureModel({
				provider: modelForm.provider,
				modelId: modelForm.modelId.trim(),
				...(modelForm.name.trim() ? { name: modelForm.name.trim() } : {}),
				...(modelForm.reasoning ? { reasoning: true } : {}),
				...(input.length > 0 ? { input } : {}),
				...(modelForm.contextWindow.trim() ? { contextWindow: Number(modelForm.contextWindow) } : {}),
				...(modelForm.maxTokens.trim() ? { maxTokens: Number(modelForm.maxTokens) } : {}),
				...(parseJsonObject<Record<string, string>>(modelForm.headersJson) ? { headers: parseJsonObject<Record<string, string>>(modelForm.headersJson) } : {}),
				...(parseJsonObject<ConfigureModelPayload["cost"]>(modelForm.costJson) ? { cost: parseJsonObject<ConfigureModelPayload["cost"]>(modelForm.costJson) } : {}),
				...(parseJsonObject<Record<string, unknown>>(modelForm.compatJson) ? { compat: parseJsonObject<Record<string, unknown>>(modelForm.compatJson) } : {}),
			});
			setShowAddModel(false);
			setShowModelAdvanced(false);
			setModelForm(buildInitialModelFormState(providers));
		} catch {
			return;
		}
	};

	return (
		<SettingsSection locale={locale} title={t(locale, "modelSectionTitle")} description={t(locale, "modelSectionDescription")}>
			<div className="flex items-center justify-between gap-2 text-[11px] text-foreground">
				<div className="inline-flex items-center gap-1.5">
					<Cpu className="h-3.5 w-3.5 shrink-0 text-foreground/80" />
					<span className="truncate">{model ?? t(locale, "noModelSelected")}</span>
				</div>
				<span className="shrink-0 text-[10px] text-muted">{t(locale, "modelsCount", availableModels.length)}</span>
			</div>
			<Separator className="bg-border/70" />

			<div className="overflow-hidden rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)]/35">
				{visibleItems.map((item, index) => {
					const fullId = `${item.provider}/${item.id}`;
					return (
						<React.Fragment key={fullId}>
							<div
								className={[
									"flex items-center justify-between gap-2 px-2 py-1.5",
									item.isActive ? "bg-[var(--vscode-list-activeSelectionBackground)]/35" : "",
									!item.isEnabled ? "opacity-60" : "",
								].join(" ")}
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[11px] font-medium text-foreground">{item.id}</div>
									<div className="truncate text-[10px] text-muted">{item.provider}</div>
								</div>
								<div className="inline-flex items-center gap-1.5">
									<Switch
										checked={item.isEnabled}
										ariaLabel={item.isEnabled ? "Disable model" : "Enable model"}
										onCheckedChange={() => setLocalEnabled((current) => ({ ...current, [fullId]: !item.isEnabled }))}
									/>
									<VSCodeButton appearance="icon" aria-label="Remove model" title="Remove model" onClick={() => onDeleteModel(item.provider, item.id)}>
										<Trash2 className="h-3.5 w-3.5" />
									</VSCodeButton>
								</div>
							</div>
							{index < visibleItems.length - 1 ? <Separator className="bg-border/60" /> : null}
						</React.Fragment>
					);
				})}
			</div>

			{canExpand ? (
				<div>
					<Separator className="bg-border/70" />
					<VSCodeButton appearance="icon" className="[&::part(control)]:px-0 [&::part(control)]:text-[11px]" onClick={() => setExpanded((current) => !current)}>
						{expanded ? "Show fewer models" : "View all models"}
					</VSCodeButton>
				</div>
			) : null}

			<div>
				<Separator className="bg-border/70" />
				<div className="flex items-center justify-between gap-2 py-1.5 text-[11px] text-foreground">
					<div className="font-medium text-foreground">{t(locale, "providerConfiguration")}</div>
					<VSCodeButton appearance="icon" className="[&::part(control)]:px-0 [&::part(control)]:text-[11px]" onClick={() => setShowAddProvider((current) => !current)}>
						<Plus className="mr-1 h-3.5 w-3.5" />
						Provider configuration
					</VSCodeButton>
				</div>

				<div className="overflow-hidden rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)]/20">
					{providerEntries.length === 0 ? (
						<div className="px-2 py-2 text-[11px] text-muted">{t(locale, "unknown")}</div>
					) : (
						providerEntries.map((providerEntry, index) => {
							const providerExpanded = expandedProviders[providerEntry.name] ?? false;
							const providerConfig = providerEntry.config;
							const isEditingCurrentProvider = providerForm.provider === providerEntry.name;
							return (
								<React.Fragment key={providerEntry.name}>
									<div className="px-2 py-1.5">
										<button
											type="button"
											className="flex w-full items-center justify-between gap-2 text-left"
											onClick={() => {
												setExpandedProviders((current) => ({ ...current, [providerEntry.name]: !providerExpanded }));
												setProviderForm({
													provider: providerEntry.name,
													baseUrl: providerConfig?.baseUrl ?? "",
													api: providerConfig?.api ?? "openai-completions",
													apiKey: providerConfig?.apiKey ?? "",
													authHeader: providerConfig?.authHeader ?? false,
													headersJson: providerConfig?.headers ? JSON.stringify(providerConfig.headers, null, 2) : "",
													compatJson: providerConfig?.compat ? JSON.stringify(providerConfig.compat, null, 2) : "",
												});
											}}
										>
											<div>
												<div className="text-[11px] font-medium text-foreground">{providerEntry.name}</div>
												<div className="text-[10px] text-muted">{providerEntry.modelCount} models</div>
											</div>
											{providerExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
										</button>
										{providerExpanded ? (
											<div className="space-y-2 pt-2">
												<div>
													<div className="mb-1 text-[10px] text-muted">Base URL</div>
													<input
														className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground"
														value={isEditingCurrentProvider ? providerForm.baseUrl : providerConfig?.baseUrl ?? ""}
														onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, baseUrl: v })); }}
													/>
												</div>
												<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
													<div>
														<div className="mb-1 text-[10px] text-muted">API type</div>
														<Select
															value={isEditingCurrentProvider ? providerForm.api : providerConfig?.api ?? undefined}
															options={API_OPTIONS}
															placeholder="API type"
															onValueChange={(value) => setProviderForm((current) => ({ ...current, api: value }))}
														/>
													</div>
													<div>
														<div className="mb-1 text-[10px] text-muted">API key</div>
														<input
															className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground"
															value={isEditingCurrentProvider ? providerForm.apiKey : providerConfig?.apiKey ?? ""}
														onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, apiKey: v })); }}
													/>
													</div>
												</div>
												<div className="flex items-center gap-2 text-[11px] text-foreground">
													<Switch checked={isEditingCurrentProvider ? providerForm.authHeader : providerConfig?.authHeader ?? false} onCheckedChange={(checked) => setProviderForm((current) => ({ ...current, authHeader: checked }))} />
													<span>Auth header</span>
												</div>
												<div>
													<div className="mb-1 text-[10px] text-muted">Headers JSON</div>
													<Textarea value={isEditingCurrentProvider ? providerForm.headersJson : providerConfig?.headers ? JSON.stringify(providerConfig.headers, null, 2) : ""} rows={3} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, headersJson: v })); }} />
												</div>
												<div>
													<div className="mb-1 text-[10px] text-muted">Compatibility JSON</div>
													<Textarea value={isEditingCurrentProvider ? providerForm.compatJson : providerConfig?.compat ? JSON.stringify(providerConfig.compat, null, 2) : ""} rows={3} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, compatJson: v })); }} />
												</div>
												<div className="flex items-center gap-2">
													<VSCodeButton onClick={submitProviderForm}>Save provider</VSCodeButton>
													<VSCodeButton appearance="icon" aria-label="Delete provider" title="Delete provider" onClick={() => onDeleteProvider(providerEntry.name)}>
														<Trash2 className="h-3.5 w-3.5" />
													</VSCodeButton>
												</div>
											</div>
										) : null}
									</div>
									{index < providerEntries.length - 1 ? <Separator className="bg-border/60" /> : null}
								</React.Fragment>
							);
						})
					)}
				</div>

				{showAddProvider ? (
					<div className="space-y-2 pt-2">
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<div>
								<div className="mb-1 text-[10px] text-muted">Provider</div>
								<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={providerForm.provider} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, provider: v })); }} />
							</div>
							<div>
								<div className="mb-1 text-[10px] text-muted">API type</div>
								<Select value={providerForm.api} options={API_OPTIONS} placeholder="API type" onValueChange={(value) => setProviderForm((current) => ({ ...current, api: value }))} />
							</div>
						</div>
						<div>
							<div className="mb-1 text-[10px] text-muted">Base URL</div>
							<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={providerForm.baseUrl} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, baseUrl: v })); }} />
						</div>
						<div>
							<div className="mb-1 text-[10px] text-muted">API key</div>
							<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={providerForm.apiKey} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, apiKey: v })); }} />
						</div>
						<div className="flex items-center gap-2 text-[11px] text-foreground">
							<Switch checked={providerForm.authHeader} onCheckedChange={(checked) => setProviderForm((current) => ({ ...current, authHeader: checked }))} />
							<span>Auth header</span>
						</div>
						<div>
							<div className="mb-1 text-[10px] text-muted">Headers JSON</div>
							<Textarea value={providerForm.headersJson} rows={3} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, headersJson: v })); }} />
						</div>
						<div>
							<div className="mb-1 text-[10px] text-muted">Compatibility JSON</div>
							<Textarea value={providerForm.compatJson} rows={3} onChange={(e) => { const v = inputValue(e); setProviderForm((current) => ({ ...current, compatJson: v })); }} />
						</div>
						<div className="flex items-center gap-2">
							<VSCodeButton onClick={submitProviderForm}>Save provider</VSCodeButton>
							<VSCodeButton appearance="secondary" onClick={() => setShowAddProvider(false)}>Cancel</VSCodeButton>
						</div>
					</div>
				) : null}
			</div>

			<div>
				<Separator className="bg-border/70" />
				<VSCodeButton appearance="icon" className="[&::part(control)]:px-0 [&::part(control)]:text-[11px]" onClick={() => setShowAddModel((current) => !current)}>
					<Plus className="mr-1 h-3.5 w-3.5" />
					Add model
				</VSCodeButton>
				{showAddModel ? (
					<div className="space-y-2 pt-2">
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<div>
								<div className="mb-1 text-[10px] text-muted">Provider</div>
								<Select value={modelForm.provider || undefined} options={providers.map((provider) => ({ value: provider, label: provider }))} placeholder="Provider" onValueChange={(value) => setModelForm((current) => ({ ...current, provider: value }))} />
							</div>
							<div>
								<div className="mb-1 text-[10px] text-muted">Model ID</div>
								<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={modelForm.modelId} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, modelId: v })); }} />
							</div>
						</div>
						<div>
							<VSCodeButton appearance="icon" className="[&::part(control)]:px-0 [&::part(control)]:text-[11px]" onClick={() => setShowModelAdvanced((current) => !current)}>
								{showModelAdvanced ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
								Advanced
							</VSCodeButton>
						</div>
						{showModelAdvanced ? (
							<div className="space-y-2 rounded-md border border-[var(--vscode-widget-border)] px-2 py-2">
								<div>
									<div className="mb-1 text-[10px] text-muted">Display name</div>
									<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={modelForm.name} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, name: v })); }} />
								</div>
								<div className="flex flex-wrap items-center gap-3">
									<label className="inline-flex items-center gap-2 text-[11px] text-foreground">
										<Switch checked={modelForm.reasoning} onCheckedChange={(checked) => setModelForm((current) => ({ ...current, reasoning: checked }))} />
										<span>Reasoning</span>
									</label>
									<label className="inline-flex items-center gap-2 text-[11px] text-foreground">
										<Switch checked={modelForm.inputText} onCheckedChange={(checked) => setModelForm((current) => ({ ...current, inputText: checked }))} />
										<span>Text input</span>
									</label>
									<label className="inline-flex items-center gap-2 text-[11px] text-foreground">
										<Switch checked={modelForm.inputImage} onCheckedChange={(checked) => setModelForm((current) => ({ ...current, inputImage: checked }))} />
										<span>Image input</span>
									</label>
								</div>
								<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
									<div>
										<div className="mb-1 text-[10px] text-muted">Context window</div>
										<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={modelForm.contextWindow} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, contextWindow: v })); }} />
									</div>
									<div>
										<div className="mb-1 text-[10px] text-muted">Max tokens</div>
										<input className="w-full rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-foreground" value={modelForm.maxTokens} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, maxTokens: v })); }} />
									</div>
								</div>
								<div>
									<div className="mb-1 text-[10px] text-muted">Headers JSON</div>
									<Textarea value={modelForm.headersJson} rows={3} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, headersJson: v })); }} />
								</div>
								<div>
									<div className="mb-1 text-[10px] text-muted">Cost JSON</div>
									<Textarea value={modelForm.costJson} rows={3} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, costJson: v })); }} />
								</div>
								<div>
									<div className="mb-1 text-[10px] text-muted">Compatibility JSON</div>
									<Textarea value={modelForm.compatJson} rows={3} onChange={(e) => { const v = inputValue(e); setModelForm((current) => ({ ...current, compatJson: v })); }} />
								</div>
							</div>
						) : null}
						<div className="flex items-center gap-2">
							<VSCodeButton onClick={submitModelForm}>Save model</VSCodeButton>
							<VSCodeButton appearance="secondary" onClick={() => setShowAddModel(false)}>Cancel</VSCodeButton>
						</div>
					</div>
				) : null}
			</div>
		</SettingsSection>
	);
}
