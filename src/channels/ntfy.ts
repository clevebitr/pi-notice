import type { Notice, NoticeConfig } from "../types.ts";
import type { Channel } from "./types.ts";

function mapPriority(config: NoticeConfig, notice: Notice): string {
	if (config.ntfy.priority !== "auto") {
		return config.ntfy.priority;
	}
	return notice.urgency === "high" ? "high" : notice.urgency === "low" ? "low" : "default";
}

function publishUrl(config: NoticeConfig): string {
	const base = config.ntfy.url.trim().replace(/\/+$/, "");
	const topic = encodeURIComponent(config.ntfy.topic);
	return base.includes("{topic}") ? base.replace("{topic}", topic) : base;
}

export function createNtfyChannel(config: NoticeConfig): Channel {
	return {
		name: "ntfy",
		async send(notice: Notice): Promise<void> {
			if (!config.ntfy.topic.trim()) {
				throw new Error("ntfy.topic 未配置（或设置 PI_NOTICE_NTFY_TOPIC）");
			}
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (config.ntfy.token.trim()) {
				headers.Authorization = `Bearer ${config.ntfy.token.trim()}`;
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
				throw new Error(`ntfy 返回 HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
			}
		},
	};
}
