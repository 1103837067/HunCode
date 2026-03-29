import { FolderTree } from "lucide-react";
import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { SettingsSection } from "./SettingsSection.js";

export function WorkspaceInfoCard({ locale, workspacePath }: { locale: AppLocale; workspacePath?: string }) {
	return (
		<SettingsSection locale={locale} title={t(locale, "workspaceTitle")} description={t(locale, "workspaceDescription")}>
			<div className="inline-flex items-start gap-1.5 text-[11px] leading-5 text-foreground">
				<FolderTree className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/80" />
				<span className="break-all">{workspacePath ?? t(locale, "noWorkspaceFolder")}</span>
			</div>
		</SettingsSection>
	);
}
