import type { AppLocale } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { Separator } from "../ui/separator.js";
import { SettingsRow, SettingsSection } from "./SettingsSection.js";

export function ConnectionStatusCard({
	locale,
	summary,
	backend,
	rpc,
}: {
	locale: AppLocale;
	summary: string;
	backend?: string;
	rpc: string;
}) {
	return (
		<SettingsSection locale={locale} title={t(locale, "connectionTitle")} description={t(locale, "connectionDescription")}>
			<SettingsRow label={t(locale, "summary")} value={summary} emphasis />
			<Separator className="bg-border/70" />
			<SettingsRow label={t(locale, "backend")} value={backend ?? t(locale, "unknown")} />
			<SettingsRow label={t(locale, "rpc")} value={rpc} />
		</SettingsSection>
	);
}
