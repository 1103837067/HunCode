import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { cn } from "../lib/cn.js"

const buttonVariants = cva("", {
  variants: {
    variant: {
      default: "",
      destructive: "",
      outline: "",
      secondary: "",
      ghost: "",
      icon: "",
      link: "",
    },
    size: {
      default: "",
      sm: "",
      lg: "",
      icon: "",
      header: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

function mapAppearance(variant?: string): string {
  switch (variant) {
    case "secondary":
      return "secondary"
    case "icon":
      return "icon"
    case "ghost":
      return "icon"
    case "outline":
      return "secondary"
    default:
      return "primary"
  }
}

function sizeClass(size?: string, variant?: string): string {
  if (variant === "icon" || variant === "ghost") {
    // Override control height completely if fixed class 'h-6', etc. is passed via class merge later, 
    // but default to flex center styles to prevent icon offset.
    return "min-w-0 px-0 [&::part(control)]:flex [&::part(control)]:items-center [&::part(control)]:justify-center [&::part(control)]:min-w-0 [&::part(control)]:w-full [&::part(control)]:h-full [&::part(control)]:px-0"
  }
  switch (size) {
    case "sm":
      return "h-5 min-w-0 px-0 [&::part(control)]:h-5 [&::part(control)]:min-w-0 [&::part(control)]:px-1.5 [&::part(control)]:text-[10px]"
    case "lg":
      return "h-7 min-w-0 px-0 [&::part(control)]:h-7 [&::part(control)]:min-w-0 [&::part(control)]:px-3 [&::part(control)]:text-xs"
    case "icon":
      return "h-7 min-w-0 px-0 [&::part(control)]:h-7 [&::part(control)]:min-w-0 [&::part(control)]:px-0.5"
    case "header":
      return "h-7 min-w-0 px-0 [&::part(control)]:h-7 [&::part(control)]:min-w-0 [&::part(control)]:px-2 [&::part(control)]:text-[11px]"
    default:
      return "h-6 min-w-0 px-0 [&::part(control)]:h-6 [&::part(control)]:min-w-0 [&::part(control)]:px-2 [&::part(control)]:text-[11px]"
  }
}

function variantClass(variant?: string): string {
  switch (variant) {
    case "ghost":
      return "[&::part(control)]:border-0 [&::part(control)]:bg-transparent"
    case "icon":
      return "[&::part(control)]:border-0 [&::part(control)]:bg-transparent"
    case "outline":
      return ""
    case "destructive":
      return "[&::part(control)]:bg-[var(--vscode-errorForeground)] [&::part(control)]:border-[var(--vscode-errorForeground)] [&::part(control)]:text-[var(--vscode-button-foreground)]"
    default:
      return ""
  }
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    const resolvedVariant = variant ?? undefined
    const resolvedSize = size ?? undefined
    const toolkitProps = props as unknown as Record<string, unknown>

    return (
      <VSCodeButton
        ref={ref as never}
        appearance={mapAppearance(resolvedVariant) as never}
        className={cn(sizeClass(resolvedSize, resolvedVariant), variantClass(resolvedVariant), className)}
        {...toolkitProps}
      >
        {children}
      </VSCodeButton>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
