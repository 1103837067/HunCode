import * as React from "react";
import { ChevronDown } from "lucide-react";

function formatDuration(seconds: number): string {
	if (seconds < 1) return "< 1s";
	if (seconds < 60) return `${Math.floor(seconds)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

export function StepsSummaryBar({
	toolCount,
	isExpanded,
	isProcessing,
	startTime,
	onToggle,
}: {
	toolCount: number;
	isExpanded: boolean;
	isProcessing: boolean;
	startTime?: number;
	onToggle: () => void;
}) {
	const [now, setNow] = React.useState(Date.now());
	const [debouncedWorkingStatus, setDebouncedWorkingStatus] = React.useState("Thinking...");
	const lastStatusChangeRef = React.useRef(Date.now());
	const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const finalTimeRef = React.useRef<number | null>(null);

	const isWorking = isProcessing;

	const rawWorkingStatus = "Thinking...";

	React.useEffect(() => {
		if (!isWorking) return undefined;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [isWorking]);

	React.useEffect(() => {
		if (isWorking) {
			finalTimeRef.current = null;
		} else if (finalTimeRef.current === null) {
			finalTimeRef.current = Date.now();
		}
	}, [isWorking]);

	React.useEffect(() => {
		if (!isWorking) return;
		const elapsed = Date.now() - lastStatusChangeRef.current;
		const apply = () => {
			setDebouncedWorkingStatus(rawWorkingStatus);
			lastStatusChangeRef.current = Date.now();
			statusTimeoutRef.current = null;
		};
		if (elapsed >= 1500) {
			apply();
			return;
		}
		if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
		statusTimeoutRef.current = setTimeout(apply, 1500 - elapsed);
	}, [isWorking, rawWorkingStatus]);

	React.useEffect(
		() => () => {
			if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
		},
		[],
	);

	const displayElapsed = startTime
		? Math.floor(((finalTimeRef.current ?? now) - startTime) / 1000)
		: null;

	const displayText = isWorking
		? debouncedWorkingStatus
		: isExpanded
			? "Hide steps"
			: `${toolCount} step${toolCount === 1 ? "" : "s"}`;

	return (
		<button
			type="button"
			onClick={onToggle}
			className={[
				"flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs transition-colors select-none",
				"hover:bg-muted/60 cursor-pointer",
				isWorking ? "text-foreground" : "text-muted-foreground",
			].join(" ")}
		>
			<ChevronDown
				className={[
					"h-3 w-3 flex-shrink-0 text-muted-foreground/50 transition-transform duration-200",
					isExpanded ? "rotate-180" : "",
				].join(" ")}
			/>
			<span className="truncate text-left">{displayText}</span>
			<div className="flex-1" />
			{displayElapsed !== null && displayElapsed > 0 ? (
				<span className="text-[10px] tabular-nums text-muted-foreground/50 flex-shrink-0">
					{formatDuration(displayElapsed)}
				</span>
			) : null}
		</button>
	);
}
