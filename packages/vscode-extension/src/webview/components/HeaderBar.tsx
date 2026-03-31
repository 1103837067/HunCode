import * as React from "react";
import { Clock3, Loader2, X } from "lucide-react";
import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import type { SessionHistoryItem } from "../types/ui.js";

export type SessionTab = {
	id: string;
	label: string;
	sessionPath?: string;
	kind: "draft" | "session";
};

export interface HeaderBarProps {
	locale: AppLocale;
	sessionHistory: SessionHistoryItem[];
	tabs: SessionTab[];
	activeTabId: string;
	historyLoading: boolean;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onOpenSession: (sessionPath: string) => void;
	onRefreshSessions: () => void;
	onLog?: (message: string) => void;
	historyOpenSignal?: number;
}

type SessionGroup = {
	key: string;
	label: string;
	items: SessionHistoryItem[];
};

function groupLabel(locale: AppLocale, key: string): string {
	if (locale === "zh-CN") {
		switch (key) {
			case "today":
				return "今天";
			case "yesterday":
				return "一天前";
			case "week":
				return "一周内";
			default:
				return "更早";
		}
	}
	switch (key) {
		case "today":
			return "Today";
		case "yesterday":
			return "1 day ago";
		case "week":
			return "Within a week";
		default:
			return "Earlier";
	}
}

function groupSessions(locale: AppLocale, sessions: SessionHistoryItem[]): SessionGroup[] {
	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	const buckets: Array<{ key: string; items: SessionHistoryItem[] }> = [
		{ key: "today", items: [] },
		{ key: "yesterday", items: [] },
		{ key: "week", items: [] },
		{ key: "earlier", items: [] },
	];

	for (const item of sessions) {
		const modifiedAt = new Date(item.modifiedAt).getTime();
		const diff = Number.isNaN(modifiedAt) ? Number.POSITIVE_INFINITY : now - modifiedAt;
		if (diff < day) buckets[0].items.push(item);
		else if (diff < 2 * day) buckets[1].items.push(item);
		else if (diff < 7 * day) buckets[2].items.push(item);
		else buckets[3].items.push(item);
	}

	return buckets
		.filter((bucket) => bucket.items.length > 0)
		.map((bucket) => ({ key: bucket.key, label: groupLabel(locale, bucket.key), items: bucket.items }));
}

function getSessionLabel(item: SessionHistoryItem): string {
	return item.name?.trim() || item.preview?.trim() || item.id;
}

export function HeaderBar({
	locale,
	sessionHistory,
	tabs,
	activeTabId,
	historyLoading,
	onSelectTab,
	onCloseTab,
	onOpenSession,
	onRefreshSessions,
	onLog,
	historyOpenSignal,
}: HeaderBarProps) {
	const [historyOpen, setHistoryOpen] = React.useState(false);
	const [tabsHovered, setTabsHovered] = React.useState(false);
	const [draggingScrollbar, setDraggingScrollbar] = React.useState(false);
	const groupedSessions = React.useMemo(() => groupSessions(locale, sessionHistory), [locale, sessionHistory]);
	const activeTab = React.useMemo(() => tabs.find((tab) => tab.id === activeTabId), [tabs, activeTabId]);
	const tabsScrollRef = React.useRef<any>(null);
	const refreshSessionsRef = React.useRef(onRefreshSessions);
	const dragStateRef = React.useRef<{ startX: number; startScrollLeft: number } | null>(null);
	const [scrollState, setScrollState] = React.useState({ show: false, width: 0, left: 0 });
	const [pendingActiveId, setPendingActiveId] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (pendingActiveId && pendingActiveId !== activeTabId) {
			setPendingActiveId(null);
		}
	}, [activeTabId, pendingActiveId]);

	const updateScrollIndicator = React.useCallback(() => {
		const element = tabsScrollRef.current as { clientWidth: number; scrollWidth: number; scrollLeft: number } | null;
		if (!element) return;
		const { clientWidth, scrollWidth, scrollLeft } = element;
		if (scrollWidth <= clientWidth + 1) {
			setScrollState({ show: false, width: 0, left: 0 });
			return;
		}
		const ratio = clientWidth / scrollWidth;
		const thumbWidth = Math.max(40, clientWidth * ratio);
		const maxLeft = clientWidth - thumbWidth;
		const left = maxLeft * (scrollLeft / (scrollWidth - clientWidth));
		setScrollState({ show: true, width: thumbWidth, left });
	}, []);

	React.useEffect(() => {
		updateScrollIndicator();
	}, [tabs, activeTabId, updateScrollIndicator]);

	React.useEffect(() => {
		refreshSessionsRef.current = onRefreshSessions;
	}, [onRefreshSessions]);

	React.useEffect(() => {
		if (!historyOpenSignal) return;
		setHistoryOpen(true);
		refreshSessionsRef.current();
	}, [historyOpenSignal]);

	React.useEffect(() => {
		const element = tabsScrollRef.current as {
			addEventListener?: (type: string, listener: (event: any) => void, options?: { passive?: boolean }) => void;
			removeEventListener?: (type: string, listener: (event: any) => void) => void;
			scrollLeft?: number;
		} | null;
		if (!element) return;

		const onWheel = (event: any) => {
			const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (!delta) return;
			event.preventDefault?.();
			element.scrollLeft = (element.scrollLeft ?? 0) + delta;
			updateScrollIndicator();
		};

		element.addEventListener?.("wheel", onWheel, { passive: false });
		const ResizeObserverCtor = (globalThis as typeof globalThis & { ResizeObserver?: new (cb: () => void) => { observe: (target: unknown) => void; disconnect: () => void } }).ResizeObserver;
		const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(() => updateScrollIndicator()) : null;
		resizeObserver?.observe?.(tabsScrollRef.current);
		return () => {
			element.removeEventListener?.("wheel", onWheel);
			resizeObserver?.disconnect?.();
		};
	}, [updateScrollIndicator]);

	React.useEffect(() => {
		const host = globalThis as typeof globalThis & {
			addEventListener?: (type: string, listener: (event: any) => void) => void;
			removeEventListener?: (type: string, listener: (event: any) => void) => void;
		};

		const onPointerMove = (event: any) => {
			const element = tabsScrollRef.current as { clientWidth: number; scrollWidth: number; scrollLeft: number } | null;
			const dragState = dragStateRef.current;
			if (!element || !dragState) return;
			const availableTrack = Math.max(1, element.clientWidth - scrollState.width);
			const scrollable = Math.max(1, element.scrollWidth - element.clientWidth);
			const deltaX = event.clientX - dragState.startX;
			element.scrollLeft = dragState.startScrollLeft + (deltaX / availableTrack) * scrollable;
			updateScrollIndicator();
		};

		const onPointerUp = () => {
			dragStateRef.current = null;
			setDraggingScrollbar(false);
		};

		host.addEventListener?.("pointermove", onPointerMove);
		host.addEventListener?.("pointerup", onPointerUp);
		return () => {
			host.removeEventListener?.("pointermove", onPointerMove);
			host.removeEventListener?.("pointerup", onPointerUp);
		};
	}, [scrollState.width, updateScrollIndicator]);

	const handleOpenSession = (item: SessionHistoryItem) => {
		onLog?.(`history item clicked: ${item.path}`);
		onOpenSession(item.path);
		setHistoryOpen(false);
	};

	return (
		<div className="relative flex flex-col">
			{/* History panel - pure CSS transition */}
			<div
				className="relative z-10 overflow-hidden border-b border-border bg-[var(--vscode-editorWidget-background)] shadow-[0_10px_30px_var(--vscode-widget-shadow)] transition-[max-height,opacity] duration-200 ease-out"
				style={{
					maxHeight: historyOpen ? '240px' : '0',
					opacity: historyOpen ? 1 : 0,
				}}
			>
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
						<Clock3 className="h-3.5 w-3.5 text-[var(--vscode-descriptionForeground)]" />
						<span>{t(locale, "sessionHistory")}</span>
					</div>
					<button
						type="button"
						className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-foreground"
						title={locale === "zh-CN" ? "关闭历史" : "Close history"}
						onClick={() => setHistoryOpen(false)}
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
				<div className="h-[200px] overflow-y-auto px-2 py-2">
					{historyLoading ? (
						<div className="flex h-full items-center justify-center">
							<Loader2 className="h-4 w-4 animate-spin text-[var(--vscode-descriptionForeground)]" />
						</div>
					) : groupedSessions.length > 0 ? (
						groupedSessions.map((group) => (
							<div key={group.key} className="pb-3 last:pb-0">
								<div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--vscode-descriptionForeground)] opacity-70">
									{group.label}
								</div>
								<div className="space-y-1">
									{group.items.map((item) => {
										const isCurrentSession = activeTab?.kind === "session" && activeTab.sessionPath === item.path;
										return (
											<button
												key={item.path}
												type="button"
												className={[
													"flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]",
													isCurrentSession ? "bg-[var(--vscode-list-activeSelectionBackground)]" : "",
												].join(" ")}
												title={getSessionLabel(item)}
												onClick={() => handleOpenSession(item)}
											>
												<span className={["mt-1 h-[7px] w-[7px] shrink-0 rounded-full", isCurrentSession ? "bg-[var(--vscode-testing-iconPassed)]" : "bg-[var(--vscode-descriptionForeground)] opacity-40"].join(" ")} />
												<div className="min-w-0 flex-1">
													<div className="truncate text-[12px] text-foreground">{getSessionLabel(item)}</div>
													<div className="truncate pt-0.5 text-[10px] text-[var(--vscode-descriptionForeground)]">{item.path}</div>
												</div>
											</button>
										);
									})}
								</div>
							</div>
						))
					) : (
						<div className="flex h-full items-center justify-center text-[12px] text-muted">{t(locale, "noSessionHistory")}</div>
					)}
				</div>
			</div>
			<header className="flex h-9 items-center bg-background px-2">
				{/* Scrollable tabs list */}
				<div className="relative flex min-w-0 flex-1 overflow-hidden self-end" onMouseEnter={() => setTabsHovered(true)} onMouseLeave={() => setTabsHovered(false)}>
					<div className="min-w-0 flex-1 overflow-hidden pb-[18px] -mb-[18px]">
						<div ref={tabsScrollRef} className="tabs-scroll-overlay flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden">
							{tabs.map((tab) => {
								const isActive = activeTabId === tab.id;
								const isPending = pendingActiveId === tab.id;

								return (
									<React.Fragment key={tab.id}>
										<div
											className={[
												"flex h-8 shrink-0 px-2 text-[11px]",
												"border-t border-x border-[var(--vscode-panel-border)]",
												isActive || isPending
													? "relative z-10 rounded-t-md border-b-0 bg-[var(--vscode-editor-background)] text-foreground"
													: "rounded-t-sm border-b bg-[var(--vscode-sideBar-background)] text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-foreground",
											].join(" ")}
										>
											<button
												type="button"
												className="min-w-0 flex-1 truncate text-left"
												title={tab.label}
												onClick={() => {
													if (!isActive) {
														setPendingActiveId(tab.id);
														onSelectTab(tab.id);
													}
												}}
											>
												{tab.label}
											</button>
											<button
												type="button"
												className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:opacity-100"
												title={locale === "zh-CN" ? "关闭标签" : "Close tab"}
												onClick={() => onCloseTab(tab.id)}
											>
												<X className="h-3 w-3" />
											</button>
										</div>
										<div className={[
											"h-8 w-1 shrink-0",
											isActive || isPending ? "relative z-10 border-b-0 bg-[var(--vscode-editor-background)]" : "border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]",
										].join(" ")} />
									</React.Fragment>
								);
							})}
						</div>
					</div>
					{scrollState.show ? (
						<div className={[
							"absolute inset-x-0 bottom-0 h-[9px] transition-opacity",
							tabsHovered || draggingScrollbar ? "opacity-100" : "opacity-0",
						].join(" ")}>
							<div className="absolute bottom-0 left-0 right-0 h-[5px] rounded-full bg-transparent">
								<div
									className="absolute bottom-0 h-[5px] cursor-pointer rounded-full bg-[var(--vscode-scrollbarSlider-background)] transition-[opacity,background-color] hover:bg-[var(--vscode-scrollbarSlider-hoverBackground)]"
									style={{ width: `${scrollState.width}px`, transform: `translateX(${scrollState.left}px)` }}
									onPointerDown={(event: any) => {
										const element = tabsScrollRef.current as { scrollLeft: number } | null;
										if (!element) return;
										dragStateRef.current = { startX: event.clientX, startScrollLeft: element.scrollLeft };
										setDraggingScrollbar(true);
									}}
								/>
							</div>
						</div>
					) : null}
				</div>
			</header>
		</div>
	);
}
