import * as React from "react";
import { Boxes, Cpu, FileStack, MessageSquareText, Settings2, Workflow } from "lucide-react";
import type { ConfigureModelPayload, ConfigureProviderPayload } from "../types/ui.js";
import type { DisplayLanguageSetting } from "../lib/i18n.js";
import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import type { WebviewState } from "../lib/state.js";
import { getConnectionSummary } from "../lib/selectors.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Select } from "../ui/select.js";
import { ConnectionStatusCard } from "../settings/ConnectionStatusCard.js";
import { ContextSettingsCard } from "../settings/ContextSettingsCard.js";
import { ModelSettingsCard } from "../settings/ModelSettingsCard.js";
import { SettingsPlaceholderList, SettingsRow, SettingsSection } from "../settings/SettingsSection.js";
import { WorkspaceInfoCard } from "../settings/WorkspaceInfoCard.js";

type SettingsTab = "general" | "model" | "session" | "messages" | "context" | "resources";

function SettingsTabButton({
	label,
	icon,
	active,
	onClick,
}: {
	label: string;
	icon: React.ReactNode;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			className={
				active
					? "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))] bg-[var(--vscode-list-activeSelectionBackground)]"
					: "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-foreground hover:bg-[var(--vscode-list-hoverBackground)]"
			}
			onClick={onClick}
		>
			<span className={active ? "shrink-0 text-[var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))]" : "shrink-0 text-foreground/75"}>{icon}</span>
			<span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
		</button>
	);
}

function GeneralTab({
	locale,
	displayLanguage,
	chatFontSize,
	onDisplayLanguageChange,
	onChatFontSizeChange,
}: {
	locale: AppLocale;
	displayLanguage: DisplayLanguageSetting;
	chatFontSize: number;
	onDisplayLanguageChange: (language: DisplayLanguageSetting) => void;
	onChatFontSizeChange: (value: number) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<SettingsSection locale={locale} title={t(locale, "displayLanguageTitle")} description={t(locale, "displayLanguageDescription")}>
				<SettingsRow
					label={t(locale, "displayLanguage")}
					value={
						<Select
							value={displayLanguage}
							onValueChange={(value) => {
								if (value === "auto" || value === "zh-CN" || value === "en") {
									onDisplayLanguageChange(value);
								}
							}}
							options={[
								{ value: "auto", label: t(locale, "displayLanguageAuto") },
								{ value: "zh-CN", label: t(locale, "displayLanguageChineseSimplified") },
								{ value: "en", label: t(locale, "displayLanguageEnglish") },
							]}
						/>
					}
				/>
			</SettingsSection>
			<SettingsSection locale={locale} title={t(locale, "chatFontSizeTitle")} description={t(locale, "chatFontSizeDescription")}>
				<SettingsRow
					label={t(locale, "chatFontSize")}
					value={
						<Select
							value={String(chatFontSize)}
							onValueChange={(value) => {
								const nextValue = Number.parseInt(value, 10);
								if (Number.isFinite(nextValue)) {
									onChatFontSizeChange(nextValue);
								}
							}}
							options={[11, 12, 13, 14, 15, 16, 17, 18].map((size) => ({ value: String(size), label: `${size}px` }))}
						/>
					}
				/>
			</SettingsSection>
			<SettingsPlaceholderList
				locale={locale}
				title={t(locale, "uiDisplayTitle")}
				description={t(locale, "uiDisplayDescription")}
				items={[
					{ label: t(locale, "theme") },
					{ label: t(locale, "startup") },
					{ label: t(locale, "tree") },
					{ label: t(locale, "editor") },
				]}
			/>
		</div>
	);
}

function ModelTab({
	locale,
	state,
	onConfigureProvider,
	onDeleteProvider,
	onConfigureModel,
	onDeleteModel,
}: {
	locale: AppLocale;
	state: WebviewState;
	onConfigureProvider: (payload: ConfigureProviderPayload) => void;
	onDeleteProvider: (provider: string) => void;
	onConfigureModel: (payload: ConfigureModelPayload) => void;
	onDeleteModel: (provider: string, modelId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<ModelSettingsCard
				locale={locale}
				model={state.model}
				availableModels={state.availableModels}
				providerConfigs={state.providerConfigs}
				onConfigureProvider={onConfigureProvider}
				onDeleteProvider={onDeleteProvider}
				onConfigureModel={onConfigureModel}
				onDeleteModel={onDeleteModel}
			/>
		</div>
	);
}

function SessionTab({
	locale,
	state,
	onToggleCurrentFile,
	onToggleSelection,
}: {
	locale: AppLocale;
	state: WebviewState;
	onToggleCurrentFile: () => void;
	onToggleSelection: () => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<WorkspaceInfoCard locale={locale} workspacePath={state.contextPills.find((pill) => pill.kind === "workspace")?.workspacePath} />
			<SettingsSection locale={locale} title={t(locale, "sessionStateTitle")} description={t(locale, "sessionStateDescription")}>
				<SettingsRow label={t(locale, "sessionId")} value={state.sessionId ?? t(locale, "unknown")} emphasis />
				<SettingsRow label={t(locale, "active")} value={state.status} />
			</SettingsSection>
			<ContextSettingsCard
				locale={locale}
				autoCurrentFile={state.autoCurrentFile}
				autoSelection={state.autoSelection}
				onToggleCurrentFile={onToggleCurrentFile}
				onToggleSelection={onToggleSelection}
			/>
		</div>
	);
}

function MessagesTab({ locale, state }: { locale: AppLocale; state: WebviewState }) {
	return (
		<div className="flex flex-col gap-1.5">
			<ConnectionStatusCard locale={locale} summary={getConnectionSummary(state, locale)} backend={state.backendState} rpc={state.rpcState} />
			<SettingsPlaceholderList
				locale={locale}
				title={t(locale, "messageDeliveryTitle")}
				description={t(locale, "messageDeliveryDescription")}
				items={[
					{ label: t(locale, "steeringMode") },
					{ label: t(locale, "followUpMode") },
					{ label: t(locale, "transport") },
					{ label: t(locale, "retry") },
				]}
			/>
		</div>
	);
}

function ContextTab({
	locale,
	state,
	onToggleCurrentFile,
	onToggleSelection,
}: {
	locale: AppLocale;
	state: WebviewState;
	onToggleCurrentFile: () => void;
	onToggleSelection: () => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<ContextSettingsCard
				locale={locale}
				autoCurrentFile={state.autoCurrentFile}
				autoSelection={state.autoSelection}
				onToggleCurrentFile={onToggleCurrentFile}
				onToggleSelection={onToggleSelection}
			/>
			<SettingsPlaceholderList
				locale={locale}
				title={t(locale, "contextRuntimeTitle")}
				description={t(locale, "contextRuntimeDescription")}
				items={[
					{ label: t(locale, "compaction") },
					{ label: t(locale, "terminal") },
					{ label: t(locale, "images") },
					{ label: t(locale, "shell") },
				]}
			/>
		</div>
	);
}

function ResourcesTab({ locale }: { locale: AppLocale }) {
	return (
		<div className="flex flex-col gap-1.5">
			<SettingsPlaceholderList
				locale={locale}
				title={t(locale, "resourcesTitle")}
				description={t(locale, "resourcesDescription")}
				items={[
					{ label: t(locale, "packages") },
					{ label: t(locale, "extensions") },
					{ label: t(locale, "skills") },
					{ label: t(locale, "prompts") },
					{ label: t(locale, "themes") },
					{ label: t(locale, "skillCommands") },
				]}
			/>
		</div>
	);
}

export function SettingsPage({
	locale,
	state,
	displayLanguage,
	onDisplayLanguageChange,
	onChatFontSizeChange,
	onToggleCurrentFile,
	onToggleSelection,
	onConfigureProvider,
	onDeleteProvider,
	onConfigureModel,
	onDeleteModel,
}: {
	locale: AppLocale;
	state: WebviewState;
	displayLanguage: DisplayLanguageSetting;
	onDisplayLanguageChange: (language: DisplayLanguageSetting) => void;
	onChatFontSizeChange: (value: number) => void;
	onToggleCurrentFile: () => void;
	onToggleSelection: () => void;
	onConfigureProvider: (payload: ConfigureProviderPayload) => void;
	onDeleteProvider: (provider: string) => void;
	onConfigureModel: (payload: ConfigureModelPayload) => void;
	onDeleteModel: (provider: string, modelId: string) => void;
}) {
	const [tab, setTab] = React.useState<SettingsTab>("general");

	const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
		{ id: "general", label: t(locale, "generalTab"), icon: <Settings2 className="h-3.5 w-3.5" /> },
		{ id: "model", label: t(locale, "modelTab"), icon: <Cpu className="h-3.5 w-3.5" /> },
		{ id: "session", label: t(locale, "sessionTab"), icon: <Workflow className="h-3.5 w-3.5" /> },
		{ id: "messages", label: t(locale, "messagesTab"), icon: <MessageSquareText className="h-3.5 w-3.5" /> },
		{ id: "context", label: t(locale, "contextTab"), icon: <FileStack className="h-3.5 w-3.5" /> },
		{ id: "resources", label: t(locale, "resourcesTab"), icon: <Boxes className="h-3.5 w-3.5" /> },
	];

	return (
		<div className="flex h-full min-h-0 bg-background text-foreground settings-shell">
			<aside className="flex w-[188px] shrink-0 flex-col gap-1 border-r border-border px-2 py-2">
				<div className="px-2 pb-2 text-[12px] font-medium leading-5 text-foreground">{t(locale, "settings")}</div>
				<div className="flex flex-col gap-1">
					{tabs.map((item) => (
						<SettingsTabButton key={item.id} label={item.label} icon={item.icon} active={tab === item.id} onClick={() => setTab(item.id)} />
					))}
				</div>
			</aside>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-1.5 px-3 py-2">
					{tab === "general" ? <GeneralTab locale={locale} displayLanguage={displayLanguage} chatFontSize={state.chatFontSize} onDisplayLanguageChange={onDisplayLanguageChange} onChatFontSizeChange={onChatFontSizeChange} /> : null}
					{tab === "model" ? <ModelTab locale={locale} state={state} onConfigureProvider={onConfigureProvider} onDeleteProvider={onDeleteProvider} onConfigureModel={onConfigureModel} onDeleteModel={onDeleteModel} /> : null}
					{tab === "session" ? <SessionTab locale={locale} state={state} onToggleCurrentFile={onToggleCurrentFile} onToggleSelection={onToggleSelection} /> : null}
					{tab === "messages" ? <MessagesTab locale={locale} state={state} /> : null}
					{tab === "context" ? <ContextTab locale={locale} state={state} onToggleCurrentFile={onToggleCurrentFile} onToggleSelection={onToggleSelection} /> : null}
					{tab === "resources" ? <ResourcesTab locale={locale} /> : null}
				</div>
			</ScrollArea>
		</div>
	);
}
