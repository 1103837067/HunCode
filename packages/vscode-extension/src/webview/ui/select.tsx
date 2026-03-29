import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import { cn } from "../lib/cn.js"

export interface SelectOption {
	value: string
	label: string
}

export interface SelectProps {
	className?: string
	options: SelectOption[]
	onValueChange?: (value: string) => void
	placeholder?: string
	value?: string
	defaultValue?: string
	disabled?: boolean
}

export function Select({ className, options, onValueChange, placeholder = "Select", value, defaultValue, disabled }: SelectProps) {
	const fallbackValue = defaultValue ?? options[0]?.value
	const currentValue = value ?? fallbackValue
	const hasCurrentValue = currentValue !== undefined && options.some((option) => option.value === currentValue)

	return (
		<VSCodeDropdown
			className={cn("h-6 min-w-[96px] [&::part(control)]:h-6 [&::part(control)]:min-w-[96px] [&::part(control)]:px-2 [&::part(control)]:text-[10px]", className)}
			disabled={disabled || options.length === 0}
			{...(hasCurrentValue ? { value: currentValue } : {})}
			onChange={(event) => {
				const next = (event.currentTarget as { value?: string } | null)?.value
				if (!next || next === currentValue) return
				onValueChange?.(next)
			}}
		>
			{options.length === 0 ? (
				<VSCodeOption value="" disabled>
					{placeholder}
				</VSCodeOption>
			) : null}
			{options.map((option) => (
				<VSCodeOption key={option.value} value={option.value}>
					{option.label}
				</VSCodeOption>
			))}
		</VSCodeDropdown>
	)
}
