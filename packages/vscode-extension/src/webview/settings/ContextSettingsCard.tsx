import * as React from "react";
import { FileCode2, ScissorsLineDashed } from "lucide-react";
import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { Button } from "../ui/button.js";
import { SettingsRow, SettingsSection } from "./SettingsSection.js";

export function ContextSettingsCard({
	locale,
	autoCurrentFile,
	autoSelection,
	onToggleCurrentFile,
	onToggleSelection,
}: {
	locale: AppLocale;
	autoCurrentFile: boolean;
	autoSelection: boolean;
	onToggleCurrentFile: () => void;
	onToggleSelection: () => void;
}) {
	return (
		<SettingsSection locale={locale} title={t(locale, "promptContextTitle")} description={t(locale, "promptContextDescription")}>
			<SettingsRow
				label={t(locale, "file")}
				value={
					<Button
						variant={autoCurrentFile ? "secondary" : "outline"}
						size="sm"
						className="h-5 justify-start gap-1 px-1.5 text-[10px]"
						onClick={onToggleCurrentFile}
					>
						<FileCode2 className="h-3 w-3 stroke-[1.5]" />
						{autoCurrentFile ? t(locale, "currentFileOn") : t(locale, "currentFileOff")}
					</Button>
				}
			/>
			<SettingsRow
				label={t(locale, "selection")}
				value={
					<Button
						variant={autoSelection ? "secondary" : "outline"}
						size="sm"
						className="h-5 justify-start gap-1 px-1.5 text-[10px]"
						onClick={onToggleSelection}
					>
						<ScissorsLineDashed className="h-3 w-3 stroke-[1.5]" />
						{autoSelection ? t(locale, "selectionOn") : t(locale, "selectionOff")}
					</Button>
				}
			/>
		</SettingsSection>
	);
}
