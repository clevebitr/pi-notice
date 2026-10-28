import { createChannels, resolveChannelNames } from "./channels/index.ts";
import type { Channel } from "./channels/types.ts";
import type { ChannelResult } from "./channels/types.ts";
import { isQuietHours } from "./config.ts";
import type { Notice, NoticeAction, NoticeConfig } from "./types.ts";

export interface Logger {
	debug(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

const defaultLogger: Logger = {
	debug: (...args) => console.error("[pi-notice]", ...args),
	warn: (...args) => console.error("[pi-notice]", ...args),
};

export interface DispatcherOptions {
	config: NoticeConfig;
	env?: NodeJS.ProcessEnv;
	logger?: Logger;
	/** Inject channels in tests. */
	channels?: Channel[];
	enabled?: boolean;
}

/** Why an interactive notification ended the way it did. */
export type InteractiveOutcome =
	| { status: "unsupported" }
	| { status: "failed"; error?: string }
	| { status: "dismissed" }
	| { status: "selected"; actionId: string; channel: string };

export interface SendOptions {
	/** A stable key that suppresses duplicates inside `dedupeWindowMs`. */
	key?: string;
	/** Ignore enabled/quiet-hours/dedupe (used by `/notice test`). */
	force?: boolean;
}

export class NoticeDispatcher {
	private config: NoticeConfig;
	private channels: Channel[];
	private readonly env: NodeJS.ProcessEnv;
	private readonly logger: Logger;
	private readonly injectedChannels?: Channel[];
	private enabled: boolean;
	private recent = new Map<string, number>();
	private warned = new Set<string>();
	private chain: Promise<ChannelResult[]> = Promise.resolve([]);

	constructor(options: DispatcherOptions) {
		this.config = options.config;
		this.env = options.env ?? process.env;
		this.logger = options.logger ?? defaultLogger;
		this.injectedChannels = options.channels;
		this.enabled = options.enabled ?? options.config.enabled;
		this.channels = this.injectedChannels ?? createChannels(this.config, this.env);
	}

	setConfig(config: NoticeConfig): void {
		this.config = config;
		this.channels = this.injectedChannels ?? createChannels(config, this.env);
	}

	getConfig(): NoticeConfig {
		return this.config;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		// `config.enabled` is applied through setEnabled() on reload, so the
		// runtime toggle in /notice can turn notifications back on for this run.
		return this.enabled;
	}

	/** The first channel that can report button presses back to this process. */
	interactiveChannel(): Channel | undefined {
		return this.channels.find((channel) => channel.actions);
	}

	/**
	 * Show a notification with buttons. Deliberately bypasses the delivery chain:
	 * an interactive notification can stay on screen for minutes, and must not
	 * block ordinary notifications queued behind it.
	 */
	async sendInteractive(notice: Notice, actions: NoticeAction[]): Promise<InteractiveOutcome> {
		if (!this.isEnabled()) {
			return { status: "unsupported" };
		}
		if (isQuietHours(this.config)) {
			const urgent = notice.urgency === "high" && this.config.quietHours.allowUrgent;
			if (!urgent) {
				return { status: "unsupported" };
			}
		}
		const channel = this.interactiveChannel();
		if (!channel?.actions) {
			return { status: "unsupported" };
		}
		if (this.config.debug) {
			this.logger.debug(`interactive ${notice.kind}: ${actions.map((action) => action.id).join(", ")}`);
		}
		try {
			const actionId = await channel.actions.send(notice, actions);
			return actionId
				? { status: "selected", actionId, channel: channel.name }
				: { status: "dismissed" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn(`${channel.name} 交互通知失败: ${message}`);
			return { status: "failed", error: message };
		}
	}

	channelNames(): string[] {
		return this.channels.map((channel) => channel.name);
	}

	channelWarnings(): string[] {
		return resolveChannelNames(this.config, this.env).warnings;
	}

	/**
	 * Queue a notification. Event handlers call this without awaiting: each
	 * delivery runs in order, and failures are reported through the logger so a
	 * notification problem can never break an agent turn.
	 */
	send(notice: Notice, options: SendOptions = {}): Promise<ChannelResult[]> {
		if (!options.force) {
			if (!this.isEnabled()) {
				return Promise.resolve([]);
			}
			if (isQuietHours(this.config)) {
				const urgent = notice.urgency === "high" && this.config.quietHours.allowUrgent;
				if (!urgent) {
					this.debug("quiet hours, skipped", notice.kind);
					return Promise.resolve([]);
				}
			}
			if (options.key && this.isDuplicate(options.key)) {
				this.debug("duplicate, skipped", options.key);
				return Promise.resolve([]);
			}
		}

		if (this.config.debug) {
			this.logger.debug(`send ${notice.kind}: ${notice.title} | ${notice.body.replace(/\n/g, " / ")}`);
		}

		this.chain = this.chain.then(
			() => this.deliver(notice),
			() => this.deliver(notice),
		);
		return this.chain;
	}

	private debug(...args: unknown[]): void {
		if (this.config.debug) {
			this.logger.debug(...args);
		}
	}

	private isDuplicate(key: string): boolean {
		const now = Date.now();
		const previous = this.recent.get(key);
		if (previous !== undefined && now - previous < this.config.dedupeWindowMs) {
			return true;
		}
		this.recent.set(key, now);
		if (this.recent.size > 200) {
			const cutoff = now - Math.max(60_000, this.config.dedupeWindowMs * 4);
			for (const [entry, timestamp] of this.recent) {
				if (timestamp < cutoff) {
					this.recent.delete(entry);
				}
			}
		}
		return false;
	}

	private async deliver(notice: Notice): Promise<ChannelResult[]> {
		if (this.channels.length === 0) {
			this.logger.warn("没有可用的通知通道");
			return [];
		}
		const results = await Promise.all(
			this.channels.map(async (channel): Promise<ChannelResult> => {
				try {
					await channel.send(notice);
					return { name: channel.name, ok: true };
				} catch (error) {
					return {
						name: channel.name,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		);
		for (const result of results) {
			if (!result.ok) {
				const key = `${result.name}:${result.error}`;
				if (this.config.debug || !this.warned.has(key)) {
					this.warned.add(key);
					this.logger.warn(`${result.name} 发送失败: ${result.error}`);
				}
			}
		}
		return results;
	}
}
