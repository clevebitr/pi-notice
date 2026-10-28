import { CHANNEL_NAMES, EVENT_KEYS, SESSION_REASONS } from "./config.ts";
import { LOCALES, localeLabel, translate as defaultTranslate, type Translator } from "./i18n.ts";
import type { ChannelChoice, EventKey, NoticeConfig, SessionReason } from "./types.ts";

/**
 * Structural subset of `SettingItem` from `@earendil-works/pi-tui`, so this
 * module stays renderer-free and testable without a terminal.
 */
export interface PanelItem {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values?: string[];
}

/** A change produced by flipping one panel row. */
export interface PanelPatch {
	enabled?: boolean;
	askActions?: boolean;
	events?: Partial<Record<EventKey, boolean>>;
	channels?: ChannelChoice[];
	locale?: string;
	sessionReasons?: SessionReason[];
}

function boolValues(t: Translator): string[] {
	return [t("common.on"), t("common.off")];
}

function labelFor(value: boolean, t: Translator): string {
	return value ? t("common.on") : t("common.off");
}

function parseToggle(value: string, t: Translator): boolean | undefined {
	if (value === t("common.on")) {
		return true;
	}
	if (value === t("common.off")) {
		return false;
	}
	return undefined;
}

/** Build the `/notice` settings panel rows, in display order. */
export function buildPanelItems(config: NoticeConfig, t: Translator = defaultTranslate): PanelItem[] {
	const onOff = boolValues(t);
	const items: PanelItem[] = [
		{
			id: "enabled",
			label: t("panel.row.enabled"),
			description: t("panel.desc.enabled"),
			currentValue: labelFor(config.enabled, t),
			values: onOff,
		},
	];

	for (const key of EVENT_KEYS) {
		items.push({
			id: `event:${key}`,
			label: t(`panel.row.event.${key}`),
			description: t(`cmd.events.label.${key}`),
			currentValue: labelFor(config.events[key], t),
			values: onOff,
		});
	}

	items.push({
		id: "askActions",
		label: t("panel.row.askActions"),
		description: t("panel.desc.askActions"),
		currentValue: labelFor(config.askActions, t),
		values: onOff,
	});

	for (const channel of ["auto", ...CHANNEL_NAMES] as const) {
		const enabled = config.channels.includes(channel);
		items.push({
			id: `channel:${channel}`,
			label: t(`panel.row.channel.${channel}`),
			description: t(`panel.desc.channel.${channel}`),
			currentValue: labelFor(enabled, t),
			values: onOff,
		});
	}

	items.push({
		id: "locale",
		label: t("panel.row.locale"),
		description: t("panel.desc.locale"),
		currentValue: localeLabel(config.locale === "auto" ? "en" : config.locale),
		values: LOCALES.map((locale) => locale.label),
	});

	for (const reason of SESSION_REASONS) {
		items.push({
			id: `reason:${reason}`,
			label: t(`panel.row.reason.${reason}`),
			description: reason,
			currentValue: labelFor(config.sessionReasons.includes(reason), t),
			values: onOff,
		});
	}

	return items;
}

function toggleChannel(
	channels: ChannelChoice[],
	channel: ChannelChoice,
	enabled: boolean,
): ChannelChoice[] {
	const next = channels.filter((entry) => entry !== channel);
	if (enabled) {
		next.push(channel);
	}
	const ordered = ["auto", ...CHANNEL_NAMES].filter((name): name is ChannelChoice =>
		next.includes(name as ChannelChoice),
	);
	return ordered.length > 0 ? ordered : ["auto"];
}

/**
 * Translate a panel row change into a config patch. Returns `undefined` for
 * values that do not apply (for example a stale locale label).
 */
export function applyPanelItem(
	id: string,
	value: string,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): PanelPatch | undefined {
	if (id === "enabled") {
		const enabled = parseToggle(value, t);
		return enabled === undefined ? undefined : { enabled };
	}

	if (id === "askActions") {
		const enabled = parseToggle(value, t);
		return enabled === undefined ? undefined : { askActions: enabled };
	}

	if (id.startsWith("event:")) {
		const key = id.slice("event:".length) as EventKey;
		if (!EVENT_KEYS.includes(key)) {
			return undefined;
		}
		const enabled = parseToggle(value, t);
		return enabled === undefined ? undefined : { events: { [key]: enabled } };
	}

	if (id.startsWith("channel:")) {
		const channel = id.slice("channel:".length) as ChannelChoice;
		if (!["auto", ...CHANNEL_NAMES].includes(channel)) {
			return undefined;
		}
		const enabled = parseToggle(value, t);
		return enabled === undefined ? undefined : { channels: toggleChannel(config.channels, channel, enabled) };
	}

	if (id === "locale") {
		const code = LOCALES.find((locale) => locale.label === value || locale.code === value)?.code;
		return code ? { locale: code } : undefined;
	}

	if (id.startsWith("reason:")) {
		const reason = id.slice("reason:".length) as SessionReason;
		if (!SESSION_REASONS.includes(reason)) {
			return undefined;
		}
		const enabled = parseToggle(value, t);
		if (enabled === undefined) {
			return undefined;
		}
		const next = config.sessionReasons.filter((entry) => entry !== reason);
		if (enabled) {
			next.push(reason);
		}
		return {
			sessionReasons: SESSION_REASONS.filter((entry) => next.includes(entry)),
		};
	}

	return undefined;
}
