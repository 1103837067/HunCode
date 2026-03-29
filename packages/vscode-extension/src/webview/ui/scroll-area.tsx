import * as React from "react";
import { cn } from "../lib/cn.js";

const ScrollArea = React.forwardRef<any, React.HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, forwardedRef) => {
	const viewportRef = React.useRef<any>(null);
	const dragStateRef = React.useRef<{ startY: number; startScrollTop: number } | null>(null);
	const [draggingScrollbar, setDraggingScrollbar] = React.useState(false);
	const [scrollState, setScrollState] = React.useState({ show: false, height: 0, top: 0 });

	const setRefs = React.useCallback((node: any) => {
		viewportRef.current = node;
		if (typeof forwardedRef === "function") {
			forwardedRef(node);
		} else if (forwardedRef) {
			forwardedRef.current = node;
		}
	}, [forwardedRef]);

	const updateScrollIndicator = React.useCallback(() => {
		const element = viewportRef.current as { clientHeight: number; scrollHeight: number; scrollTop: number } | null;
		if (!element) return;
		const { clientHeight, scrollHeight, scrollTop } = element;
		if (scrollHeight <= clientHeight + 1) {
			setScrollState({ show: false, height: 0, top: 0 });
			return;
		}
		const ratio = clientHeight / scrollHeight;
		const thumbHeight = Math.max(32, clientHeight * ratio);
		const maxTop = clientHeight - thumbHeight;
		const top = maxTop * (scrollTop / (scrollHeight - clientHeight));
		setScrollState({ show: true, height: thumbHeight, top });
	}, []);

	React.useEffect(() => {
		updateScrollIndicator();
	}, [children, updateScrollIndicator]);

	React.useEffect(() => {
		const element = viewportRef.current as {
			addEventListener?: (type: string, listener: () => void, options?: { passive?: boolean }) => void;
			removeEventListener?: (type: string, listener: () => void) => void;
		} | null;
		if (!element) return;
		const onScroll = () => updateScrollIndicator();
		element.addEventListener?.("scroll", onScroll, { passive: true });
		const ResizeObserverCtor = (globalThis as typeof globalThis & { ResizeObserver?: new (cb: () => void) => { observe: (target: unknown) => void; disconnect: () => void } }).ResizeObserver;
		const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(() => updateScrollIndicator()) : null;
		resizeObserver?.observe?.(viewportRef.current);
		return () => {
			element.removeEventListener?.("scroll", onScroll);
			resizeObserver?.disconnect?.();
		};
	}, [updateScrollIndicator]);

	React.useEffect(() => {
		const host = globalThis as typeof globalThis & {
			addEventListener?: (type: string, listener: (event: any) => void) => void;
			removeEventListener?: (type: string, listener: (event: any) => void) => void;
		};

		const onPointerMove = (event: any) => {
			const element = viewportRef.current as { clientHeight: number; scrollHeight: number; scrollTop: number } | null;
			const dragState = dragStateRef.current;
			if (!element || !dragState) return;
			const availableTrack = Math.max(1, element.clientHeight - scrollState.height);
			const scrollable = Math.max(1, element.scrollHeight - element.clientHeight);
			const deltaY = event.clientY - dragState.startY;
			element.scrollTop = dragState.startScrollTop + (deltaY / availableTrack) * scrollable;
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
	}, [scrollState.height, updateScrollIndicator]);

	return (
		<div className={cn("relative min-h-0 flex-1 overflow-hidden", className)} {...props}>
			<div ref={setRefs} className="scroll-area-overlay h-full overflow-y-auto overflow-x-hidden pb-[14px] pr-0">
				{children}
			</div>
			{scrollState.show ? (
				<div className={["pointer-events-none absolute right-0 top-0 bottom-0 w-[9px] transition-opacity", draggingScrollbar ? "opacity-100" : "opacity-100"].join(" ")}>
					<div className="pointer-events-auto absolute right-[2px] top-0 bottom-0 w-[5px] rounded-full bg-transparent">
						<div
							className="absolute right-0 w-[5px] cursor-pointer rounded-full bg-[var(--vscode-scrollbarSlider-background)] transition-[opacity,background-color] hover:bg-[var(--vscode-scrollbarSlider-hoverBackground)]"
							style={{ height: `${scrollState.height}px`, transform: `translateY(${scrollState.top}px)` }}
							onPointerDown={(event: any) => {
								const element = viewportRef.current as { scrollTop: number } | null;
								if (!element) return;
								dragStateRef.current = { startY: event.clientY, startScrollTop: element.scrollTop };
								setDraggingScrollbar(true);
							}}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
});

ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
