import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join } from "node:path";

import type { Notice, NoticeAction, NoticeConfig } from "../types.ts";
import type { Channel } from "./types.ts";

type NodeNotifier = {
	notify(options: Record<string, unknown>, callback?: (error: Error | null) => void): {
		once?: (event: string, handler: (error: Error) => void) => unknown;
	};
};

let notifierPromise: Promise<NodeNotifier> | undefined;

async function loadNotifier(): Promise<NodeNotifier> {
	if (!notifierPromise) {
		notifierPromise = import("node-notifier")
			.then((module) => {
				const imported = module as unknown as { default?: NodeNotifier } & NodeNotifier;
				const notifier = imported.default ?? imported;
				if (typeof notifier?.notify !== "function") {
					throw new Error("node-notifier did not export notify()");
				}
				return notifier;
			})
			.catch((error: unknown) => {
				notifierPromise = undefined;
				throw new Error(
					`无法加载 node-notifier，请先在 pi-notice 包目录运行 npm install: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			});
	}
	return notifierPromise;
}

function desktopOptions(config: NoticeConfig, notice: Notice): Record<string, unknown> {
	const options: Record<string, unknown> = {
		title: notice.title,
		message: notice.body,
		wait: false,
		timeout: config.desktop.timeoutSeconds,
		urgency: notice.urgency,
	};

	if (process.platform === "win32") {
		options.appID = config.desktop.appId;
		options.sound = config.desktop.sound;
		if (!config.desktop.sound) {
			options.silent = true;
		}
	} else if (process.platform === "darwin") {
		options.sound = config.desktop.sound ? "Glass" : false;
	} else {
		options.sound = config.desktop.sound;
	}

	return options;
}

/** Labels are matched case-insensitively because node-notifier lowercases the activation value. */
function normalizeLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function actionOptions(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): Record<string, unknown> {
	const options = desktopOptions(config, notice);
	options.actions = actions.map((action) => action.label);
	options.wait = true;
	// macOS needs an explicit timeout to keep the terminal-notifier process alive;
	// SnoreToast ignores `timeout` and only honors the short `-t` flag.
	options.timeout = config.desktop.actionsTimeoutSeconds;
	return options;
}

/** Exposed for tests. */
export function buildActionOptions(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): Record<string, unknown> {
	return actionOptions(config, notice, actions);
}

/** Exposed for tests: `notify-send -A NAME=TEXT` prints NAME when the button is pressed. */
export function buildNotifySendActionArgs(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): string[] {
	const args = [
		"--app-name",
		"Pi",
		"--urgency",
		notice.urgency === "high" ? "critical" : notice.urgency === "low" ? "low" : "normal",
		"--wait",
		"-t",
		String(config.desktop.actionsTimeoutSeconds * 1000),
	];
	for (const action of actions) {
		args.push("-A", `${action.id}=${action.label}`);
	}
	args.push("--", notice.title, notice.body);
	return args;
}

const requireFromHere = createRequire(import.meta.url);

/** Path to the SnoreToast binary node-notifier ships. */
function snoretoastPath(): string {
	const entry = requireFromHere.resolve("node-notifier");
	const arch = process.arch === "x64" ? "x64" : "x86";
	return join(dirname(entry), "vendor", "snoreToast", `snoretoast-${arch}.exe`);
}

/** Where Windows stores the shortcut that registers an AppUserModelID. */
export function windowsShortcutPath(appId: string): string {
	const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Roaming");
	return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${appId}.lnk`);
}

/**
 * Windows only routes toast button clicks back to an application whose
 * AppUserModelID has a Start Menu shortcut. SnoreToast can write that shortcut
 * itself (`-install <name> <application> <appID>`), so do it once per appID.
 */
export async function ensureToastShortcut(appId: string): Promise<boolean> {
	if (!appId.trim() || process.platform !== "win32") {
		return false;
	}
	if (existsSync(windowsShortcutPath(appId))) {
		return true;
	}
	const exe = snoretoastPath();
	if (!existsSync(exe)) {
		return false;
	}
	try {
		await new Promise<void>((resolve, reject) => {
			execFile(exe, ["-install", appId, exe, appId], { timeout: 15_000 }, (error) =>
				error ? reject(error) : resolve(),
			);
		});
	} catch {
		return false;
	}
	return existsSync(windowsShortcutPath(appId));
}

/** SnoreToast joins button labels with `;`, so labels must not contain one. */
function sanitizeButtonLabel(label: string): string {
	const cleaned = label.replace(/[;\r\n]/g, " ").replace(/\s+/g, " ").trim();
	return cleaned.slice(0, 40) || "•";
}

/** Exposed for tests. */
export function buildSnoreToastArgs(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
	pipeName: string,
): string[] {
	const args = [
		"-appID",
		config.desktop.appId || "Pi",
		"-t",
		notice.title,
		"-m",
		notice.body,
		"-b",
		actions.map((action) => sanitizeButtonLabel(action.label)).join(";"),
		"-pipeName",
		pipeName,
	];
	if (!config.desktop.sound) {
		args.push("-silent");
	}
	return args;
}

/** SnoreToast writes `action=buttonClicked;button=…;version=0.7.0;` to the pipe. */
export function parseSnoreToastResult(raw: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const part of raw.split(";")) {
		const index = part.indexOf("=");
		if (index > 0) {
			result[part.slice(0, index)] = part.slice(index + 1);
		}
	}
	return result;
}

function showWindowsActions(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): Promise<string | undefined> {
	const byLabel = new Map(actions.map((action) => [normalizeLabel(action.label), action.id]));
	const pipe = `\\\\.\\pipe\\pi-notice-${randomUUID()}`;
	const exe = snoretoastPath();

	return new Promise<string | undefined>((resolve, reject) => {
		let settled = false;
		const server = net.createServer();
		const finish = (error?: unknown, value?: string): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			server.close();
			if (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			} else {
				resolve(value);
			}
		};
		// Stay listening after SnoreToast exits: a click in the Action Center
		// relaunches the COM server, which still writes to this pipe.
		const timer = setTimeout(() => finish(), (config.desktop.actionsTimeoutSeconds + 5) * 1000);
		timer.unref?.();

		server.on("connection", (socket) => {
			let raw = "";
			socket.setEncoding("utf16le");
			socket.on("data", (chunk: string) => {
				raw += chunk;
			});
			socket.on("end", () => {
				const result = parseSnoreToastResult(raw);
				if (result.action === "buttonClicked" && result.button) {
					finish(undefined, byLabel.get(normalizeLabel(result.button)));
					return;
				}
				if (result.action) {
					finish();
				}
			});
			socket.on("error", () => finish());
		});
		server.on("error", (error) => finish(error));

		server.listen(pipe, () => {
			// The open pipe must not keep a short-lived script alive.
			server.unref?.();
			void ensureToastShortcut(config.desktop.appId)
				.catch(() => false)
				.then((registered) => {
					if (settled) {
						return;
					}
					if (!registered) {
						finish(new Error("无法注册 Windows 通知 AppID"));
						return;
					}
					const child = spawn(exe, buildSnoreToastArgs(config, notice, actions, pipe), {
						windowsHide: true,
						stdio: "ignore",
					});
					child.on("error", (error) => finish(error));
				});
		});
	});
}

function spawnNotifySend(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		execFile(
			"notify-send",
			buildNotifySendActionArgs(config, notice, actions),
			{ timeout: (config.desktop.actionsTimeoutSeconds + 30) * 1000 },
			(error, stdout) => {
				if (error) {
					// A dismissed notification exits without printing an action.
					if (stdout.trim()) {
						resolve(stdout.trim());
						return;
					}
					reject(error);
					return;
				}
				const chosen = stdout.trim();
				resolve(chosen || undefined);
			},
		);
	});
}

function activationValue(response: unknown, metadata: unknown): string | undefined {
	if (typeof response === "string" && response.trim()) {
		return response.trim();
	}
	if (typeof response === "object" && response !== null) {
		const record = response as Record<string, unknown>;
		for (const key of ["button", "activationValue", "activationType"]) {
			const value = record[key];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
	}
	if (typeof metadata === "object" && metadata !== null) {
		const record = metadata as Record<string, unknown>;
		for (const key of ["activationValue", "activationType", "button"]) {
			const value = record[key];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
	}
	return undefined;
}

async function notifyWithActions(
	config: NoticeConfig,
	notice: Notice,
	actions: NoticeAction[],
): Promise<string | undefined> {
	if (process.platform === "linux") {
		return spawnNotifySend(config, notice, actions);
	}
	if (process.platform === "win32") {
		return showWindowsActions(config, notice, actions);
	}
	const notifier = await loadNotifier();
	const byLabel = new Map(actions.map((action) => [normalizeLabel(action.label), action.id]));
	const options = actionOptions(config, notice, actions);

	return await new Promise<string | undefined>((resolve, reject) => {
		let settled = false;
		const finish = (error?: unknown, value?: string): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(guard);
			if (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			} else {
				resolve(value);
			}
		};
		const guard = setTimeout(
			() => finish(),
			(config.desktop.actionsTimeoutSeconds + 30) * 1000,
		);
		guard.unref?.();

		try {
			const emitter = notifier.notify(
				options,
				(error: Error | null, response?: unknown, metadata?: unknown) => {
					if (error) {
						finish(error);
						return;
					}
					const raw = activationValue(response, metadata);
					finish(undefined, raw ? byLabel.get(normalizeLabel(raw)) : undefined);
				},
			);
			emitter?.once?.("error", (error: Error) => finish(error));
		} catch (error) {
			finish(error);
		}
	});
}

export function createDesktopChannel(config: NoticeConfig): Channel {
	return {
		name: "desktop",
		// `notify-send -A` on Linux, SnoreToast buttons on Windows, terminal-notifier
		// actions on macOS: all three report the press back to this process.
		actions: {
			maxActions: process.platform === "linux" ? 5 : 3,
			send: (notice: Notice, actions: NoticeAction[]) => notifyWithActions(config, notice, actions),
		},
		async send(notice: Notice): Promise<void> {
			const notifier = await loadNotifier();
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const finish = (error?: unknown): void => {
					if (settled) {
						return;
					}
					settled = true;
					clearTimeout(timer);
					if (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
					} else {
						resolve();
					}
				};
				// node-notifier's Windows callback only runs after SnoreToast exits, which
				// can take as long as the toast timeout. Do not hold the queue that long.
				const timer = setTimeout(() => finish(), 1200);
				timer.unref?.();

				try {
					const emitter = notifier.notify(desktopOptions(config, notice), (error) => finish(error ?? undefined));
					emitter?.once?.("error", (error: Error) => finish(error));
				} catch (error) {
					finish(error);
				}
			});
		},
	};
}
