import * as React from "react";
import { Separator } from "../ui/separator.js";
import { cn } from "../lib/cn.js";
import { t } from "../lib/i18n.js";
import type { AppLocale } from "../lib/i18n.js";

export function SettingsSection({
	locale: _locale,
	title,
	description,
	children,
}: React.PropsWithChildren<{ locale: AppLocale; title: string; description?: string }>) {
	return (
		<section className="px-0.5 py-0.5">
			<div className="text-[12px] font-medium text-foreground">{title}</div>
			{description ? <div className="mt-0.5 text-[10px] leading-4 text-muted">{description}</div> : null}
			<div className="mt-1">
				<Separator className="bg-border" />
			</div>
			<div className="flex flex-col gap-1 py-1.5 text-[10px] text-muted">{children}</div>
		</section>
	);
}

export function SettingsRow({
	label,
	value,
	emphasis = false,
}: {
	label: string;
	value: React.ReactNode;
	emphasis?: boolean;
}) {
	return (
		<div className="grid grid-cols-[88px_1fr] items-start gap-2">
			<div className="pt-0.5 text-[10px] leading-4 text-muted">{label}</div>
			<div className={cn("min-w-0 break-words text-[11px] leading-5 text-foreground/90", emphasis && "font-medium text-foreground")}>{value}</div>
		</div>
	);
}

export function SettingsPlaceholderList({
	locale,
	title,
	description,
	items,
}: {
	locale: AppLocale;
	title: string;
	description?: string;
	items: Array<{ label: string; value?: string; description?: string }>;
}) {
	return (
		<SettingsSection locale={locale} title={title} description={description}>
			{items.map((item, index) => (
				<React.Fragment key={item.label}>
					<div className="flex items-start justify-between gap-3 py-1">
						<div className="min-w-0 flex-1">
							<div className="truncate text-[11px] text-foreground">{item.label}</div>
							{item.description ? <div className="mt-0.5 text-[10px] leading-4 text-muted">{item.description}</div> : null}
						</div>
						<div className="shrink-0 pt-0.5 text-[10px] text-muted">{item.value ?? t(locale, "comingSoon")}</div>
					</div>
					{index < items.length - 1 ? <Separator className="bg-border/60" /> : null}
				</React.Fragment>
			))}
		</SettingsSection>
	);
}
