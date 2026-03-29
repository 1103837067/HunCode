import * as React from "react"
import { VSCodeTag } from "@vscode/webview-ui-toolkit/react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn.js"

const badgeVariants = cva("", {
  variants: {
    variant: {
      default: "",
      secondary: "",
      destructive: "",
      outline: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <VSCodeTag className={cn("h-5 min-w-0 px-0 [&::part(control)]:h-5 [&::part(control)]:min-w-0 [&::part(control)]:px-1.5 [&::part(control)]:text-[9px]", className)} {...props} />
  )
}

export { Badge, badgeVariants }
