import * as React from "react"
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react"

import { cn } from "../lib/cn.js"

const Separator = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <VSCodeDivider
      ref={ref as never}
      className={cn("block w-full", className)}
      {...props}
    />
  )
)
Separator.displayName = "Separator"

export { Separator }
