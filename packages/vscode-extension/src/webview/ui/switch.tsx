import { cn } from "../lib/cn.js";

export interface SwitchProps {
	checked: boolean;
	disabled?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	className?: string;
	ariaLabel?: string;
}

export function Switch({ checked, disabled = false, onCheckedChange, className, ariaLabel }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			className={cn(
				"relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vscode-focusBorder)] disabled:cursor-not-allowed disabled:opacity-50",
				checked
					? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-button-background)]"
					: "border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)]",
				className,
			)}
			onClick={() => {
				if (disabled) return;
				onCheckedChange?.(!checked);
			}}
		>
			<span
				className={cn(
					"absolute top-[1px] h-3 w-3 rounded-full bg-[var(--vscode-button-foreground)] transition-transform",
					checked ? "translate-x-[12px]" : "translate-x-[1px]",
				)}
			/>
		</button>
	);
}
