import * as React from "react"
import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"

import { cn } from "../lib/cn.js"

const Textarea = React.forwardRef<HTMLElement, React.ComponentProps<"textarea">>(
  ({ className, onChange, ...props }, ref) => {
    return (
      <VSCodeTextArea
        className={cn("min-h-[52px] w-full [&::part(control)]:min-h-[52px] [&::part(control)]:px-2.5 [&::part(control)]:py-2 [&::part(control)]:text-sm", className)}
        ref={ref as never}
        onInput={(event) => {
          const target = event.target as HTMLTextAreaElement | undefined
          onChange?.({ currentTarget: target, target } as React.ChangeEvent<HTMLTextAreaElement>)
        }}
        {...(props as unknown as Record<string, unknown>)}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
