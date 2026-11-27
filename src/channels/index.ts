import { translatorFor } from "../i18n.ts";
import type { ChannelName, NoticeConfig } from "../types.ts";
import { createDesktopChannel } from "./desktop.ts";
import { createNtfyChannel } from "./ntfy.ts";
import { createOscChannel } from "./osc.ts";
import { createTermuxChannel, isTermux } from "./termux.ts";
import type { Channel } from "./types.ts";

export { isTermux } from "./termux.ts";
export type { Channel, ChannelResult } from "./types.ts";

export function autoChannel(env: NodeJS.ProcessEnv = process.env): ChannelName {
	return isTermux(env) ? "termux" : "desktop";
}

export interface ResolvedChannels {
	names: ChannelName[];
	warnings: string[];
}

/**
 * Expand `auto` and remove duplicates. `auto` means "the native channel for
 * this machine": Termux:API on Android, node-notifier elsewhere.
 */
export function resolveChannelNames(
	config: NoticeConfig,
	env: NodeJS.ProcessEnv = process.env,
): ResolvedChannels {
	const names: ChannelName[] = [];
	const warnings: string[] = [];
	const t = translatorFor(config.locale, env);
	for (const choice of config.channels) {
		const name = choice === "auto" ? autoChannel(env) : choice;
		if (!names.includes(name)) {
			names.push(name);
		}
	}
	if (names.includes("ntfy") && !config.ntfy.topic.trim()) {
		warnings.push(t("warn.ntfyTopic"));
	}
	if (names.includes("osc") && !config.osc.enabled) {
		warnings.push(t("warn.oscDisabled"));
	}
	return { names, warnings };
}

export function createChannels(
	config: NoticeConfig,
	env: NodeJS.ProcessEnv = process.env,
): Channel[] {
	const { names } = resolveChannelNames(config, env);
	return names.map((name): Channel => {
		switch (name) {
			case "desktop":
				return createDesktopChannel(config);
			case "termux":
				return createTermuxChannel(config);
			case "ntfy":
				return createNtfyChannel(config);
			case "osc":
				return createOscChannel(config);
		}
	});
}
