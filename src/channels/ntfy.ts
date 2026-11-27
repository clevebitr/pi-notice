import { translatorFor } from "../i18n.ts";
import type { Notice, NoticeConfig } from "../types.ts";
import type { Channel } from "./types.ts";

/** ntfy's JSON API only accepts an integer priority (1 = min … 5 = max). */
const NTFY_PRIORITY: Record<"low" | "default" | "high" | "max", number> = {
	low: 2,
	default: 3,
	high: 4,
	max: 5,
};

function mapPriority(config: NoticeConfig, notice: Notice): number {
	if (config.ntfy.priority !== "auto") {
		return NTFY_PRIORITY[config.ntfy.priority];
	}
	return notice.urgency === "high" ? NTFY_PRIORITY.high : notice.urgency === "low" ? NTFY_PRIORITY.low : NTFY_PRIORITY.default;
}

function publishUrl(config: NoticeConfig): string {
	const base = config.ntfy.url.trim().replace(/\/+$/, "");
	const topic = encodeURIComponent(config.ntfy.topic);
	return base.includes("{topic}") ? base.replace("{topic}", topic) : base;
}

export function createNtfyChannel(config: NoticeConfig): Channel {
	const t = translatorFor(config.locale);
	return {
		name: "ntfy",
		async send(notice: Notice): Promise<void> {
			if (!config.ntfy.topic.trim()) {
				throw new Error(t("error.ntfy.noTopic"));
			}
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (config.ntfy.token.trim()) {
				headers.Authorization = `Bearer ${config.ntfy.token.trim()}`;
			}
			if (config.ntfy.icon?.trim()) {
				headers["X-Icon"] = config.ntfy.icon.trim();
			}
			const response = await fetch(publishUrl(config), {
				method: "POST",
				headers,
				body: JSON.stringify({
					topic: config.ntfy.topic,
					title: notice.title,
					message: notice.body,
					priority: mapPriority(config, notice),
					tags: [...config.ntfy.tags, notice.kind],
				}),
				signal: AbortSignal.timeout(6_000),
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					detail
						? t("error.ntfy.httpDetail", {
							status: response.status,
							detail: detail.slice(0, 200),
						})
						: t("error.ntfy.http", { status: response.status }),
				);
			}
		},
	};
}
