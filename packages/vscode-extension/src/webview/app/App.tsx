import * as React from "react";
import { HeaderBar, type SessionTab } from "../components/HeaderBar.js";
import { normalizeLocale, type AppLocale, type DisplayLanguageSetting } from "../lib/i18n.js";
import { createInitialState, derivePromptContext, isAgentEvent, reduceState, type WebviewState } from "../lib/state.js";
import { mapHostContextToPills } from "../lib/state.js";
import { getConnectionSummary } from "../lib/selectors.js";
import { getPersistedState, postToHost, setPersistedState } from "../lib/vscode-api.js";
import { ChatPage } from "../pages/ChatPage.js";
import type { SessionHistoryItem } from "../types/ui.js";

function logToHost(message: string): void {
	postToHost({ type: "ui.log", message });
}

function errorToHost(message: string): void {
	postToHost({ type: "ui.error", message });
}

function createInitialAppState(): WebviewState {
	const persisted = getPersistedState<WebviewState>();
	return persisted ? { ...createInitialState(), ...persisted } : createInitialState();
}

function getInitialTabs(): { tabs: SessionTab[]; activeTabId: string } {
	const persisted = getPersistedState<{ __tabs?: unknown; __activeTabId?: unknown } | undefined>();
	const tabs = Array.isArray(persisted?.__tabs)
		? persisted.__tabs.filter(
				(item): item is SessionTab =>
					typeof item === "object" &&
					item !== null &&
					"id" in item &&
					"label" in item &&
					"kind" in item,
			)
		: [];
	if (tabs.length > 0) {
		const activeTabId = typeof persisted?.__activeTabId === "string" ? persisted.__activeTabId : tabs[0].id;
		return { tabs, activeTabId };
	}
	return {
		tabs: [{ id: "draft-initial", label: "New chat", kind: "draft" }],
		activeTabId: "draft-initial",
	};
}

function LoadingScreen({ locale, summary }: { locale: AppLocale; summary: string }) {
	return (
		<div className="flex flex-1 items-center justify-center px-4">
			<div className="flex w-full max-w-[280px] flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6 text-center shadow-sm">
				<div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-[14px] font-semibold text-foreground shadow-sm">HunCode</div>
				<div className="space-y-1">
					<div className="text-[13px] font-semibold text-foreground">{locale === "zh-CN" ? "正在启动 HunCode" : "Starting HunCode"}</div>
					<div className="text-[11px] leading-5 text-muted">{locale === "zh-CN" ? "正在等待后端和 RPC 就绪，然后再加载聊天界面。" : "Waiting for backend and RPC to become ready before loading the chat interface."}</div>
				</div>
				<div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted">
					<span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
					<span className="truncate">{summary}</span>
				</div>
			</div>
		</div>
	);
}

export function App() {
	const [state, setState] = React.useState<WebviewState>(createInitialAppState);
	const [locale, setLocale] = React.useState<AppLocale>("en");
	const [displayLanguage, setDisplayLanguage] = React.useState<DisplayLanguageSetting>("auto");
	const [tabState, setTabState] = React.useState(getInitialTabs);
	const [historyOpenSignal, setHistoryOpenSignal] = React.useState(0);
	const [historyLoading, setHistoryLoading] = React.useState(false);
	const [sessionHistory, setSessionHistory] = React.useState<SessionHistoryItem[]>([]);

	const windowObject = globalThis as typeof globalThis & {
		document?: {
			getElementById?: (id: string) => { remove?: () => void } | null;
		};
		window?: {
			addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
			removeEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
		};
	};

	React.useEffect(() => {
		setPersistedState({ ...state, __tabs: tabState.tabs, __activeTabId: tabState.activeTabId });
	}, [state, tabState]);

	React.useEffect(() => {
		setTabState((current) => {
			const activeTab = current.tabs.find((t) => t.id === current.activeTabId);
			if (activeTab?.kind !== "draft") return current;
			if (!state.sessionId && state.timeline.length === 0) return current;
			const firstUser = state.timeline.find((item) => item.kind === "user");
			const userText = firstUser?.kind === "user" ? firstUser.text : undefined;
			const label = userText
				? userText.slice(0, 30) + (userText.length > 30 ? "..." : "")
				: "New chat";
			if (label === activeTab.label && !state.sessionId) return current;
			return {
				...current,
				tabs: current.tabs.map((t) =>
					t.id === current.activeTabId
						? { ...t, label, kind: state.sessionId ? ("session" as const) : t.kind }
						: t,
				),
			};
		});
	}, [state.sessionId, state.timeline]);

	React.useEffect(() => {
		logToHost("App mounted");
		const doc = windowObject.document;
		if (doc?.getElementById) {
			const boot = doc.getElementById("pi-boot-debug");
			if (boot?.remove) boot.remove();
			const probe = doc.getElementById("pi-dom-probe");
			if (probe?.remove) probe.remove();
		}

		const onMessage = (event: MessageEvent) => {
			const data = event.data as Record<string, unknown> | undefined;
			if (!data?.type) return;

			if (data.type === "ui.context" && data.context) {
				setState((current) =>
					reduceState(current, {
						type: "setContextPills",
						pills: mapHostContextToPills(data.context as Parameters<typeof mapHostContextToPills>[0]),
					}),
				);
				return;
			}
			if (data.type === "ui.reset") {
				setState((current) => reduceState(current, { type: "reset" }));
				return;
			}
			if (data.type === "ui.showSessionHistory") {
				setHistoryLoading(true);
				setHistoryOpenSignal((value) => value + 1);
				return;
			}
			if (data.type === "ui.sessionHistory" && Array.isArray(data.sessions)) {
				const items = (data.sessions as Array<Record<string, unknown>>).map((s) => ({
					id: String(s.id ?? ""),
					path: String(s.path ?? ""),
					name: s.name ? String(s.name) : undefined,
					preview: String(s.firstMessage ?? ""),
					modifiedAt: String(s.modified ?? ""),
				}));
				setSessionHistory(items);
				setHistoryLoading(false);
				return;
			}
			if (data.type === "ui.newDraftTab") {
				createNewDraftTab();
				return;
			}
			if (data.type === "ui.locale" && typeof data.locale === "string") {
				setLocale(normalizeLocale(data.locale as string));
				if (data.setting === "auto" || data.setting === "zh-CN" || data.setting === "en") {
					setDisplayLanguage(data.setting as DisplayLanguageSetting);
				}
				return;
			}
			if (data.type === "ui.chatFontSize" && typeof data.value === "number") {
				setState((current) => reduceState(current, { type: "setChatFontSize", value: data.value as number }));
				return;
			}

			if (data.type === "rpc:state") {
				logToHost("rpc:state received");
				const rpcState = data.data as Record<string, unknown>;
				setState((current) => reduceState(current, { type: "setInitialState", state: rpcState }));
				const sessionName = typeof rpcState.sessionName === "string" ? rpcState.sessionName : undefined;
				const sessionId = typeof rpcState.sessionId === "string" ? rpcState.sessionId : undefined;
				if (sessionId) {
					setTabState((current) => {
						const activeTab = current.tabs.find((t) => t.id === current.activeTabId);
						if (activeTab?.kind === "draft") {
							return {
								...current,
								tabs: current.tabs.map((t) =>
									t.id === current.activeTabId
										? { ...t, kind: "session" as const, label: sessionName || t.label }
										: t,
								),
							};
						}
						return current;
					});
				}
				return;
			}
			if (data.type === "rpc:models") {
				logToHost("rpc:models received");
				const modelsData = data.data as { models: Array<{ id: string; provider: string; label: string }> };
				setState((current) => reduceState(current, { type: "setModels", models: modelsData.models }));
				return;
			}
			if (data.type === "rpc:messages") {
				logToHost("rpc:messages received");
				const messagesData = data.data as { messages: Array<Record<string, unknown>> };
				setState((current) => reduceState(current, { type: "loadMessages", messages: messagesData.messages }));
				return;
			}

			if (isAgentEvent(data)) {
				setState((current) => reduceState(current, { type: "applyAgentEvent", event: data }));
			}
		};

		const addMessageListener = windowObject.window?.addEventListener;
		const removeMessageListener = windowObject.window?.removeEventListener;
		if (addMessageListener) addMessageListener("message", onMessage);
		return () => {
			if (removeMessageListener) removeMessageListener("message", onMessage);
		};
	}, []);

	const postMessage = (message: unknown) => postToHost(message);
	const isWaitingForBackend = !state.sessionId && state.backendState === "starting";

	const createNewDraftTab = () => {
		const id = `draft-${Date.now()}`;
		setTabState((current) => ({
			tabs: [...current.tabs, { id, label: "New chat", kind: "draft" } satisfies SessionTab],
			activeTabId: id,
		}));
		setState((current) => reduceState(current, { type: "reset" }));
	};

	const rootStyle = { "--pi-chat-font-size": `${state.chatFontSize}px` } as React.CSSProperties;

	return (
		<div className="flex h-full flex-col bg-background text-foreground" style={rootStyle}>
			{isWaitingForBackend ? (
				<LoadingScreen locale={locale} summary={getConnectionSummary(state, locale)} />
			) : (
				<>
					<HeaderBar
						locale={locale}
						sessionHistory={sessionHistory}
						tabs={tabState.tabs}
						activeTabId={tabState.activeTabId}
						historyLoading={historyLoading}
						historyOpenSignal={historyOpenSignal}
						onSelectTab={(tabId) => {
							setTabState((current) => ({ ...current, activeTabId: tabId }));
						}}
						onCloseTab={(tabId) => {
							setTabState((current) => {
								const index = current.tabs.findIndex((tab) => tab.id === tabId);
								const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
								const fallback = nextTabs[Math.min(index, nextTabs.length - 1)] ?? { id: "draft-fallback", label: "New chat", kind: "draft" as const };
								return { tabs: nextTabs.length > 0 ? nextTabs : [fallback], activeTabId: fallback.id };
							});
						}}
						onRefreshSessions={() => {
							setHistoryLoading(true);
							postToHost({ type: "ui.refreshSessions" });
						}}
						onLog={(message) => logToHost(message)}
						onOpenSession={(sessionPath) => {
							const match = sessionHistory.find((s) => s.path === sessionPath);
							const label = match?.name || match?.preview?.slice(0, 30) || "Session";
							const tabId = `session-${Date.now()}`;
							setTabState((current) => ({
								tabs: [...current.tabs, { id: tabId, label, kind: "session", sessionPath }],
								activeTabId: tabId,
							}));
							setState((current) => reduceState(current, { type: "reset" }));
							postToHost({ type: "ui.openSession", sessionPath });
						}}
					/>
					<ChatPage
						state={state}
						onToggleTool={(toolCallId) => setState((current) => reduceState(current, { type: "toggleToolExpanded", toolCallId }))}
						onRemoveContext={(pill) =>
							setState((current) =>
								reduceState(current, {
									type: "setContextPills",
									pills: current.contextPills.filter((item) => JSON.stringify(item) !== JSON.stringify(pill)),
								}),
							)
						}
						onAddCurrentFile={() => postMessage({ type: "ui.addCurrentFileContext" })}
						onAddSelection={() => postMessage({ type: "ui.addSelectionContext" })}
						onSelectModel={(modelId) => {
							setState((current) => ({ ...current, model: modelId }));
							postMessage({ type: "setModel", modelId });
						}}
						onRefreshModels={() => postMessage({ type: "ui.refreshModels" })}
						onStop={() => postMessage({ type: "abort" })}
						onDraftChange={(draft) => setState((current) => reduceState(current, { type: "setDraft", draft }))}
					onSubmit={(text) => {
						setState((current) =>
							reduceState(current, {
								type: "appendUserPrompt",
								id: `user-${Date.now()}`,
								text,
								context: mapHostContextToPills(derivePromptContext(current)),
							}),
						);
						postMessage({ type: "prompt", text });
					}}
					/>
				</>
			)}
		</div>
	);
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error?: string }> {
	constructor(props: React.PropsWithChildren) {
		super(props);
		this.state = {};
	}

	static getDerivedStateFromError(error: Error) {
		return { error: error.message };
	}

	componentDidCatch(error: Error): void {
		errorToHost(`React error boundary: ${error.stack ?? error.message}`);
	}

	render() {
		if (this.state.error) {
			return (
				<div className="p-3 text-[12px] text-destructive">
					<div className="font-semibold">Pi webview failed to render</div>
					<div className="mt-1 whitespace-pre-wrap">{this.state.error}</div>
				</div>
			);
		}
		return this.props.children;
	}
}
