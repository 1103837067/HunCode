import * as React from "react";
import { FolderCode, X } from "lucide-react";
import type { ContextPill as ContextPillType } from "../types/ui.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function ReactContextPills({
	pills,
	onRemove,
}: {
	pills: ContextPillType[];
	onRemove?: (pill: ContextPillType) => void;
}) {
	if (pills.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-1">
			{pills.map((pill) => (
				<Badge
					key={`${pill.kind}-${pill.kind === "workspace" ? pill.workspacePath : pill.path}`}
					variant="outline"
					className="inline-flex h-5 max-w-full items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium text-muted"
					title={pill.kind === "workspace" ? pill.workspacePath : pill.path}
				>
					<FolderCode className="h-3 w-3 shrink-0" />
					<span className="truncate">{pill.label}</span>
					{onRemove ? (
						<Button
							variant="icon"
							size="icon"
							className="h-4 w-4 rounded-full"
							onClick={() => onRemove(pill)}
							aria-label={`Remove ${pill.label}`}
						>
							<X className="h-3 w-3" />
						</Button>
					) : null}
				</Badge>
			))}
		</div>
	);
}
