import type { Notice, NoticeConfig } from "../types.ts";
import type { Channel } from "./types.ts";

function sanitize(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Terminal escape-sequence notifications. This is opt-in because it writes to
 * the terminal that Pi's TUI owns, and it is skipped for non-TTY output so it
 * can never corrupt JSON/RPC streams.
 */
export function createOscChannel(config: NoticeConfig): Channel {
	return {
		name: "osc",
		async send(notice: Notice): Promise<void> {
			if (!config.osc.enabled) {
				throw new Error("osc.enabled 为 false");
			}
			if (!process.stdout.isTTY) {
				throw new Error("stdout 不是 TTY，跳过 OSC 通知");
			}
			const title = sanitize(notice.title);
			const body = sanitize(notice.body);
			if (process.env.KITTY_WINDOW_ID) {
				process.stdout.write(`\u001b]99;i=pi-notice:d=0;${title}\u001b\\`);
				process.stdout.write(`\u001b]99;i=pi-notice:p=body;${body}\u001b\\`);
			} else {
				process.stdout.write(`\u001b]777;notify;${title};${body}\u0007`);
			}
		},
	};
}
