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

type AppTab = SessionTab & {
	sessionId?: string;
	draftState?: WebviewState;
};

type AppTabState = {
	tabs: AppTab[];
	activeTabId: string;
};

function toDraftSnapshot(state: WebviewState): WebviewState {
	return {
		...state,
		timeline: [...state.timeline],
		contextPills: [...state.contextPills],
		availableModels: [...state.availableModels],
		activeToolCallIds: [...state.activeToolCallIds],
		providerConfigs: { ...state.providerConfigs },
	};
}

function normalizeDraftState(value: unknown): WebviewState | undefined {
	if (!value || typeof value !== "object") return undefined;
	return { ...createInitialState(), ...(value as Partial<WebviewState>) };
}

function normalizePersistedTab(value: unknown): AppTab | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return undefined;
	if (candidate.kind !== "draft" && candidate.kind !== "session") return undefined;
	return {
		id: candidate.id,
		label: candidate.label,
		kind: candidate.kind,
		sessionPath: typeof candidate.sessionPath === "string" ? candidate.sessionPath : undefined,
		sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
		draftState: normalizeDraftState(candidate.draftState),
	};
}

function buildAutoScrollKey(state: WebviewState): string {
	const timelineKey = state.timeline
		.map((item) => {
			if (item.kind === "user") {
				return `u:${item.id}:${item.text.length}`;
			}
			if (item.kind === "system") {
				return `s:${item.id}:${item.text.length}:${item.level}`;
			}
			if (item.kind === "tool") {
				return `t:${item.id}:${item.state}:${item.summary?.length ?? 0}:${item.output.length}`;
			}
			const partsKey = item.parts
				.map((part) => {
					if (part.kind === "thinking") return `h:${part.id}:${part.text.length}`;
					if (part.kind === "text") return `x:${part.id}:${part.text.length}`;
					return `t:${part.toolCallId}:${part.state}:${part.summary?.length ?? 0}:${part.output.length}`;
				})
				.join(",");
			return `a:${item.id}:${item.streamState ?? "none"}:${Number(item.isStreaming)}:${item.text.length}:${partsKey}`;
		})
		.join("|");

	return [state.status, state.sessionId ?? "", state.activeAssistantMessageId ?? "", ...state.activeToolCallIds, timelineKey].join("::");
}

function getInitialTabs(): AppTabState {
	const persisted = getPersistedState<{ __tabs?: unknown; __activeTabId?: unknown } | undefined>();
	const tabs = Array.isArray(persisted?.__tabs)
		? persisted.__tabs
				.map(normalizePersistedTab)
				.filter((item): item is AppTab => item !== undefined)
		: [];
	if (tabs.length > 0) {
		const activeTabId = typeof persisted?.__activeTabId === "string" ? persisted.__activeTabId : tabs[0].id;
		const hasActiveTab = tabs.some((tab) => tab.id === activeTabId);
		return { tabs, activeTabId: hasActiveTab ? activeTabId : tabs[0].id };
	}
	const initialDraft = { id: "draft-initial", label: "New chat", kind: "draft", draftState: createInitialState() } satisfies AppTab;
	return {
		tabs: [initialDraft],
		activeTabId: initialDraft.id,
	};
}

// Initialize tabs and state together
function getInitialAppSetup(): { tabs: AppTabState; state: WebviewState } {
	const tabState = getInitialTabs();
	const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);

	// If active tab is a session, don't restore from cache - wait for backend data
	if (activeTab?.kind === "session") {
		logToHost(`Initial tab is session: ${activeTab.sessionPath}`);
		return { tabs: tabState, state: createInitialState() };
	}

	// If active tab is a draft with draftState, use it as initial state
	if (activeTab?.kind === "draft" && activeTab.draftState) {
		logToHost(`Initial tab is draft with draftState, timeline: ${activeTab.draftState.timeline.length}`);
		return { tabs: tabState, state: toDraftSnapshot(activeTab.draftState) };
	}

	// Otherwise, use empty initial state
	logToHost(`Initial tab has no draftState`);
	return { tabs: tabState, state: createInitialState() };
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
	const initialSetup = React.useMemo(() => getInitialAppSetup(), []);
	const [state, setState] = React.useState<WebviewState>(initialSetup.state);
	const [locale, setLocale] = React.useState<AppLocale>("en");
	const [displayLanguage, setDisplayLanguage] = React.useState<DisplayLanguageSetting>("auto");
	const [tabState, setTabState] = React.useState<AppTabState>(initialSetup.tabs);
	const [historyOpenSignal, setHistoryOpenSignal] = React.useState(0);
	const [historyLoading, setHistoryLoading] = React.useState(false);
	const [sessionHistory, setSessionHistory] = React.useState<SessionHistoryItem[]>([]);
	const timelineViewportRef = React.useRef<any>(null);
	const stateRef = React.useRef(state);
	const tabStateRef = React.useRef(tabState);

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
		stateRef.current = state;
	}, [state]);

	React.useEffect(() => {
		tabStateRef.current = tabState;
	}, [tabState]);

	const scrollToBottom = React.useCallback(() => {
		const viewport = timelineViewportRef.current as
			| { scrollTop: number; scrollHeight: number; scrollTo?: (options: { top: number; behavior?: "auto" | "smooth" }) => void }
			| null;
		if (!viewport) return;
		if (typeof viewport.scrollTo === "function") {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
			return;
		}
		viewport.scrollTop = viewport.scrollHeight;
	}, []);

	const scheduleScrollToBottom = React.useCallback(() => {
		setTimeout(() => scrollToBottom(), 0);
	}, [scrollToBottom]);

	const snapshotActiveTab = React.useCallback((tabs: AppTab[], activeTabId: string, currentState: WebviewState): AppTab[] => {
		return tabs.map((tab) => {
			if (tab.id !== activeTabId) return tab;
			if (tab.kind === "draft") {
				return { ...tab, draftState: toDraftSnapshot(currentState) };
			}
			return { ...tab, sessionId: currentState.sessionId ?? tab.sessionId };
		});
	}, []);

	const restoreDraftTab = React.useCallback(
		(tab: AppTab, fallbackState: WebviewState) => {
			setState(tab.draftState ? toDraftSnapshot(tab.draftState) : reduceState(fallbackState, { type: "reset" }));
			scheduleScrollToBottom();
		},
		[scheduleScrollToBottom],
	);

	const switchToSessionTab = React.useCallback(
		(tab: AppTab, tabs: AppTab[], nextActiveTabId: string) => {
			setTabState({ tabs, activeTabId: nextActiveTabId });
			setState((current) => reduceState(current, { type: "reset" }));
			if (tab.sessionPath) {
				postToHost({ type: "ui.openSession", sessionPath: tab.sessionPath });
			}
			scheduleScrollToBottom();
		},
		[scheduleScrollToBottom],
	);

	const activateTab = React.useCallback(
		(tabId: string) => {
			const currentState = stateRef.current;
			const currentTabState = tabStateRef.current;
			if (tabId === currentTabState.activeTabId) {
				scheduleScrollToBottom();
				return;
			}
			const tabs = snapshotActiveTab(currentTabState.tabs, currentTabState.activeTabId, currentState);
			const target = tabs.find((tab) => tab.id === tabId);
			if (!target) return;
			if (target.kind === "session") {
				switchToSessionTab(target, tabs, tabId);
				return;
			}
			setTabState({ tabs, activeTabId: tabId });
			restoreDraftTab(target, currentState);
		},
		[restoreDraftTab, scheduleScrollToBottom, snapshotActiveTab, switchToSessionTab],
	);

	const createNewDraftTab = React.useCallback(() => {
		const currentState = stateRef.current;
		const currentTabState = tabStateRef.current;
		const nextDraftState = reduceState(currentState, { type: "reset" });
		const tabs = snapshotActiveTab(currentTabState.tabs, currentTabState.activeTabId, currentState);
		const id = `draft-${Date.now()}`;
		setTabState({
			tabs: [...tabs, { id, label: "New chat", kind: "draft", draftState: nextDraftState } satisfies AppTab],
			activeTabId: id,
		});
		setState(nextDraftState);
		scheduleScrollToBottom();
	}, [scheduleScrollToBottom, snapshotActiveTab]);

	const openSessionInTab = React.useCallback(
		(sessionPath: string) => {
			const currentState = stateRef.current;
			const currentTabState = tabStateRef.current;
			const existingTab = currentTabState.tabs.find((tab) => tab.sessionPath === sessionPath);
			if (existingTab) {
				activateTab(existingTab.id);
				return;
			}
			const tabs = snapshotActiveTab(currentTabState.tabs, currentTabState.activeTabId, currentState);
			const match = sessionHistory.find((session) => session.path === sessionPath);
			const label = match?.name || match?.preview?.slice(0, 30) || "Session";
			const tabId = `session-${Date.now()}`;
			switchToSessionTab({ id: tabId, label, kind: "session", sessionPath }, [...tabs, { id: tabId, label, kind: "session", sessionPath }], tabId);
		},
		[activateTab, sessionHistory, snapshotActiveTab, switchToSessionTab],
	);

	const closeTab = React.useCallback(
		(tabId: string) => {
			const currentState = stateRef.current;
			const currentTabState = tabStateRef.current;
			const index = currentTabState.tabs.findIndex((tab) => tab.id === tabId);
			if (index === -1) return;
			const tabsWithSnapshot = snapshotActiveTab(currentTabState.tabs, currentTabState.activeTabId, currentState);
			const nextTabs = tabsWithSnapshot.filter((tab) => tab.id !== tabId);
			if (nextTabs.length === 0) {
				const nextDraftState = reduceState(currentState, { type: "reset" });
				const fallbackTab = { id: "draft-fallback", label: "New chat", kind: "draft", draftState: nextDraftState } satisfies AppTab;
				setTabState({ tabs: [fallbackTab], activeTabId: fallbackTab.id });
				setState(nextDraftState);
				scheduleScrollToBottom();
				return;
			}
			if (currentTabState.activeTabId !== tabId) {
				setTabState({ tabs: nextTabs, activeTabId: currentTabState.activeTabId });
				return;
			}
			const fallbackTab = nextTabs[Math.min(index, nextTabs.length - 1)] ?? nextTabs[nextTabs.length - 1];
			if (!fallbackTab) return;
			if (fallbackTab.kind === "session") {
				switchToSessionTab(fallbackTab, nextTabs, fallbackTab.id);
				return;
			}
			setTabState({ tabs: nextTabs, activeTabId: fallbackTab.id });
			restoreDraftTab(fallbackTab, currentState);
		},
		[restoreDraftTab, scheduleScrollToBottom, snapshotActiveTab, switchToSessionTab],
	);

	React.useEffect(() => {
		// Persist tabs including draftState for draft tabs
		const persistedTabs = tabState.tabs.map((tab) => {
			if (tab.kind === "draft" && tab.draftState) {
				return { ...tab, draftState: toDraftSnapshot(tab.draftState) };
			}
			return tab;
		});
		setPersistedState({ ...state, __tabs: persistedTabs, __activeTabId: tabState.activeTabId });
	}, [state, tabState]);

	React.useEffect(() => {
		setTabState((current) => {
			const activeTab = current.tabs.find((tab) => tab.id === current.activeTabId);
			if (activeTab?.kind !== "draft") return current;
			if (!state.sessionId && state.timeline.length === 0) return current;
			const firstUser = state.timeline.find((item) => item.kind === "user");
			const userText = firstUser?.kind === "user" ? firstUser.text : undefined;
			const label = userText ? userText.slice(0, 30) + (userText.length > 30 ? "..." : "") : "New chat";
			if (label === activeTab.label && !state.sessionId) return current;
			return {
				...current,
				tabs: current.tabs.map((tab) =>
					tab.id === current.activeTabId
						? { ...tab, label, kind: state.sessionId ? ("session" as const) : tab.kind }
						: tab,
				),
			};
		});
	}, [state.sessionId, state.timeline]);

	const autoScrollKey = React.useMemo(() => buildAutoScrollKey(state), [state]);

	React.useLayoutEffect(() => {
		scrollToBottom();
	}, [scrollToBottom, autoScrollKey, tabState.activeTabId]);

	const [initialSessionPath] = React.useState(() => {
		const activeTab = initialSetup.tabs.tabs.find((tab) => tab.id === initialSetup.tabs.activeTabId);
		return activeTab?.kind === "session" ? activeTab.sessionPath : undefined;
	});
	const hasSwitchedSession = React.useRef(false);

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
				const items = (data.sessions as Array<Record<string, unknown>>).map((session) => ({
					id: String(session.id ?? ""),
					path: String(session.path ?? ""),
					name: session.name ? String(session.name) : undefined,
					preview: String(session.firstMessage ?? ""),
					modifiedAt: String(session.modified ?? ""),
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
				const sessionPath = typeof rpcState.sessionFile === "string" ? rpcState.sessionFile : undefined;
				if (sessionId || sessionPath || sessionName) {
					setTabState((current) => ({
						...current,
						tabs: current.tabs.map((tab) => {
							if (tab.id !== current.activeTabId) return tab;
							return {
								...tab,
								kind: "session",
								label: sessionName || tab.label,
								sessionId: sessionId ?? tab.sessionId,
								sessionPath: sessionPath ?? tab.sessionPath,
								draftState: undefined,
							};
						}),
					}));
				}

				// Check if we need to switch to a different session (only once on initial load)
				if (!hasSwitchedSession.current && initialSessionPath && initialSessionPath !== sessionPath) {
					logToHost(`Need to switch session: ${initialSessionPath} (current: ${sessionPath})`);
					postToHost({ type: "ui.openSession", sessionPath: initialSessionPath });
					hasSwitchedSession.current = true;
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
				logToHost(`rpc:messages count: ${messagesData.messages.length}`);
				setState((current) => {
					const next = reduceState(current, { type: "loadMessages", messages: messagesData.messages });
					logToHost(`after loadMessages timeline length: ${next.timeline.length}`);
					return next;
				});
				scheduleScrollToBottom();
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
	}, [createNewDraftTab, scheduleScrollToBottom]);

	const postMessage = (message: unknown) => postToHost(message);
	const isWaitingForBackend = !state.sessionId && state.backendState === "starting";
	const rootStyle = { "--pi-chat-font-size": `${state.chatFontSize}px` } as React.CSSProperties;
	const visibleTabs = React.useMemo(() => tabState.tabs.map(({ draftState, sessionId, ...tab }) => tab), [tabState.tabs]);

	void displayLanguage;

	return (
		<div className="flex h-full flex-col bg-background text-foreground" style={rootStyle}>
			{isWaitingForBackend ? (
				<LoadingScreen locale={locale} summary={getConnectionSummary(state, locale)} />
			) : (
				<>
					<HeaderBar
						locale={locale}
						sessionHistory={sessionHistory}
						tabs={visibleTabs}
						activeTabId={tabState.activeTabId}
						historyLoading={historyLoading}
						historyOpenSignal={historyOpenSignal}
						onSelectTab={activateTab}
						onCloseTab={closeTab}
						onRefreshSessions={() => {
							setHistoryLoading(true);
							postToHost({ type: "ui.refreshSessions" });
						}}
						onLog={(message) => logToHost(message)}
						onOpenSession={(sessionPath) => {
							openSessionInTab(sessionPath);
						}}
					/>
					<ChatPage
						state={state}
						viewportRef={timelineViewportRef}
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
