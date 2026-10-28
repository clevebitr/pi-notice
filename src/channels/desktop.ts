import type { Notice, NoticeConfig } from "../types.ts";
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

export function createDesktopChannel(config: NoticeConfig): Channel {
	return {
		name: "desktop",
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
