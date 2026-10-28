import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Notice, NoticeConfig } from "../types.ts";
import type { Channel } from "./types.ts";

const execFileAsync = promisify(execFile);

export function isTermux(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.TERMUX_VERSION) || Boolean(env.PREFIX?.includes("com.termux"));
}

function mapPriority(config: NoticeConfig, notice: Notice): string {
	if (config.termux.priority !== "auto") {
		return config.termux.priority;
	}
	return notice.urgency === "high" ? "high" : notice.urgency === "low" ? "low" : "default";
}

/** Exposed for tests: every value is passed as an argv entry, never through a shell. */
export function buildTermuxArgs(config: NoticeConfig, notice: Notice): string[] {
	const args = [
		"--title",
		notice.title,
		"--content",
		notice.body,
		"--id",
		config.termux.notificationId,
		"--priority",
		mapPriority(config, notice),
	];
	if (config.termux.group) {
		args.push("--group", config.termux.group);
	}
	if (config.termux.sound) {
		args.push("--sound");
	}
	if (config.termux.vibrate && config.termux.vibrateMs > 0) {
		args.push("--vibrate", String(Math.round(config.termux.vibrateMs)));
	}
	if (config.termux.action) {
		args.push("--action", config.termux.action);
	}
	return args;
}

function buildMinimalTermuxArgs(config: NoticeConfig, notice: Notice): string[] {
	return [
		"--title",
		notice.title,
		"--content",
		notice.body,
		"--id",
		config.termux.notificationId,
		"--priority",
		mapPriority(config, notice),
	];
}

async function runTermux(command: string, args: string[]): Promise<void> {
	await execFileAsync(command, args, {
		timeout: 8_000,
		maxBuffer: 256 * 1024,
		windowsHide: true,
	});
}

const availability = new Map<string, Promise<boolean>>();

async function isAvailable(command: string): Promise<boolean> {
	let pending = availability.get(command);
	if (!pending) {
		pending = runTermux(command, ["--help"])
			.then(() => true)
			.catch((error: NodeJS.ErrnoException) => error?.code !== "ENOENT");
		availability.set(command, pending);
	}
	return pending;
}

export function createTermuxChannel(config: NoticeConfig): Channel {
	return {
		name: "termux",
		async send(notice: Notice): Promise<void> {
			if (!(await isAvailable(config.termux.command))) {
				throw new Error(
					`未找到 ${config.termux.command}。请先安装 Termux:API 应用并执行 pkg install termux-api`,
				);
			}
			try {
				await runTermux(config.termux.command, buildTermuxArgs(config, notice));
			} catch (error) {
				// Older termux-api builds may not accept --sound/--vibrate/--group.
				// Retry with only the core flags before surfacing the failure.
				try {
					await runTermux(config.termux.command, buildMinimalTermuxArgs(config, notice));
				} catch {
					throw error;
				}
			}
		},
	};
}
