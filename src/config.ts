import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type {
	ChannelChoice,
	ChannelName,
	EventKey,
	LoadedConfig,
	NoticeConfig,
	SessionReason,
} from "./types.ts";

const CHANNEL_NAMES: readonly ChannelName[] = ["desktop", "termux", "ntfy", "osc"];
const EVENT_KEYS: readonly EventKey[] = ["settled", "ask", "todo", "errors", "retry", "session"];
const SESSION_REASONS: readonly SessionReason[] = ["startup", "reload", "new", "resume", "fork"];

export const DEFAULT_CONFIG: NoticeConfig = {
	enabled: true,
	channels: ["auto"],
	events: {
		settled: true,
		ask: true,
		todo: true,
		errors: true,
		retry: true,
		session: true,
	},
	sessionReasons: ["resume"],
	minDurationMs: 0,
	quietHours: {
		enabled: false,
		start: "23:00",
		end: "08:00",
		allowUrgent: true,
	},
	summary: {
		maxBodyChars: 220,
		maxReplyChars: 140,
		includeProject: true,
		includeDuration: true,
		includeReply: true,
		includeTodo: true,
	},
	desktop: {
		sound: true,
		appId: "Pi",
		timeoutSeconds: 8,
	},
	termux: {
		command: "termux-notification",
		notificationId: "pi-notice",
		priority: "auto",
		sound: true,
		vibrate: true,
		vibrateMs: 200,
		group: "pi-notice",
	},
	ntfy: {
		url: "https://ntfy.sh",
		topic: "",
		token: "",
		priority: "auto",
		tags: ["robot"],
	},
	osc: {
		enabled: false,
	},
	dedupeWindowMs: 1500,
	debug: false,
};

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

/** Merge JSON values: objects merge recursively, arrays and scalars replace. */
export function mergeConfig(base: unknown, override: unknown): unknown {
	if (!isPlainObject(override)) {
		return override;
	}
	const out: JsonObject = isPlainObject(base) ? { ...base } : {};
	for (const [key, value] of Object.entries(override)) {
		if (value === undefined) {
			continue;
		}
		out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : clone(value);
	}
	return out;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeTime(value: unknown, fallback: string): string {
	return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function normalizeConfig(input: unknown): NoticeConfig {
	const config = mergeConfig(clone(DEFAULT_CONFIG), input) as NoticeConfig;

	config.enabled = asBoolean(config.enabled, true);
	config.channels = Array.isArray(config.channels)
		? config.channels.filter(
				(value): value is ChannelChoice =>
					value === "auto" || (CHANNEL_NAMES as readonly string[]).includes(String(value)),
			)
		: ["auto"];
	if (config.channels.length === 0) {
		config.channels = ["auto"];
	}

	const events: JsonObject = isPlainObject(config.events) ? config.events : {};
	config.events = {
		settled: asBoolean(events.settled, true),
		ask: asBoolean(events.ask, true),
		todo: asBoolean(events.todo, true),
		errors: asBoolean(events.errors, true),
		retry: asBoolean(events.retry, true),
		session: asBoolean(events.session, true),
	};

	config.sessionReasons = Array.isArray(config.sessionReasons)
		? config.sessionReasons.filter((value): value is SessionReason =>
				(SESSION_REASONS as readonly string[]).includes(String(value)),
			)
		: ["resume"];

	config.minDurationMs = clampNumber(config.minDurationMs, 0, 0, 24 * 60 * 60 * 1000);
	config.dedupeWindowMs = clampNumber(config.dedupeWindowMs, 1500, 0, 60_000);

	const quiet: JsonObject = isPlainObject(config.quietHours) ? config.quietHours : {};
	config.quietHours = {
		enabled: asBoolean(quiet.enabled, false),
		start: normalizeTime(quiet.start, "23:00"),
		end: normalizeTime(quiet.end, "08:00"),
		allowUrgent: asBoolean(quiet.allowUrgent, true),
	};

	const summary: JsonObject = isPlainObject(config.summary) ? config.summary : {};
	config.summary = {
		maxBodyChars: clampNumber(summary.maxBodyChars, 220, 40, 1000),
		maxReplyChars: clampNumber(summary.maxReplyChars, 140, 0, 600),
		includeProject: asBoolean(summary.includeProject, true),
		includeDuration: asBoolean(summary.includeDuration, true),
		includeReply: asBoolean(summary.includeReply, true),
		includeTodo: asBoolean(summary.includeTodo, true),
	};

	const desktop: JsonObject = isPlainObject(config.desktop) ? config.desktop : {};
	config.desktop = {
		sound: asBoolean(desktop.sound, true),
		appId: asString(desktop.appId, "Pi"),
		timeoutSeconds: clampNumber(desktop.timeoutSeconds, 8, 1, 60),
	};

	const termux: JsonObject = isPlainObject(config.termux) ? config.termux : {};
	config.termux = {
		command: asString(termux.command, "termux-notification"),
		notificationId: asString(termux.notificationId, "pi-notice"),
		priority: asEnum(termux.priority, ["auto", "low", "default", "high", "max"] as const, "auto"),
		sound: asBoolean(termux.sound, true),
		vibrate: asBoolean(termux.vibrate, true),
		vibrateMs: clampNumber(termux.vibrateMs, 200, 0, 5000),
		group: asString(termux.group, "pi-notice"),
		action: typeof termux.action === "string" && termux.action.trim() ? termux.action : undefined,
	};

	const ntfy: JsonObject = isPlainObject(config.ntfy) ? config.ntfy : {};
	config.ntfy = {
		url: asString(ntfy.url, "https://ntfy.sh"),
		topic: asString(ntfy.topic, ""),
		token: asString(ntfy.token, ""),
		priority: asEnum(ntfy.priority, ["auto", "low", "default", "high", "max"] as const, "auto"),
		tags: Array.isArray(ntfy.tags)
			? (ntfy.tags as unknown[]).filter((value): value is string => typeof value === "string")
			: ["robot"],
	};

	const osc: JsonObject = isPlainObject(config.osc) ? config.osc : {};
	config.osc = { enabled: asBoolean(osc.enabled, false) };

	config.debug = asBoolean(config.debug, false);
	return config;
}

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

export function configPaths(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
	const custom = env.PI_NOTICE_CONFIG?.trim();
	const paths: string[] = [];
	if (custom) {
		const expanded = expandHome(custom);
		paths.push(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
	} else {
		paths.push(join(homedir(), ".pi", "agent", "pi-notice.json"));
	}
	paths.push(join(cwd, ".pi", "pi-notice.json"));
	return [...new Set(paths)];
}

function readConfigFile(path: string, warnings: string[]): JsonObject | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const text = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(text);
		if (!isPlainObject(parsed)) {
			warnings.push(`${path}: expected a JSON object`);
			return undefined;
		}
		return parsed;
	} catch (error) {
		warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

function parseEventEnv(value: string, events: Record<EventKey, boolean>): void {
	const tokens = value
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) {
		return;
	}
	if (tokens.some((token) => token.startsWith("+") || token.startsWith("-"))) {
		for (const token of tokens) {
			const sign = token[0];
			const key = token.slice(1).trim() as EventKey;
			if (EVENT_KEYS.includes(key)) {
				events[key] = sign !== "-";
			}
		}
		return;
	}
	if (tokens.includes("all")) {
		for (const key of EVENT_KEYS) {
			events[key] = true;
		}
		return;
	}
	for (const key of EVENT_KEYS) {
		events[key] = tokens.includes(key);
	}
}

function applyEnv(config: NoticeConfig, env: NodeJS.ProcessEnv): NoticeConfig {
	if (["1", "true", "yes", "on"].includes((env.PI_NOTICE_DISABLED ?? "").toLowerCase())) {
		config.enabled = false;
	}
	if (env.PI_NOTICE_CHANNELS?.trim()) {
		config.channels = env.PI_NOTICE_CHANNELS.split(",")
			.map((value) => value.trim())
			.filter((value): value is ChannelChoice => value === "auto" || (CHANNEL_NAMES as readonly string[]).includes(value));
		if (config.channels.length === 0) {
			config.channels = ["auto"];
		}
	}
	if (env.PI_NOTICE_EVENTS?.trim()) {
		parseEventEnv(env.PI_NOTICE_EVENTS, config.events);
	}
	if (env.PI_NOTICE_SESSION_REASONS?.trim()) {
		config.sessionReasons = env.PI_NOTICE_SESSION_REASONS.split(",")
			.map((value) => value.trim())
			.filter((value): value is SessionReason => (SESSION_REASONS as readonly string[]).includes(value));
	}
	if (env.PI_NOTICE_MIN_DURATION_MS?.trim()) {
		const value = Number(env.PI_NOTICE_MIN_DURATION_MS);
		if (Number.isFinite(value)) {
			config.minDurationMs = Math.max(0, value);
		}
	}
	if (env.PI_NOTICE_QUIET_HOURS?.trim()) {
		const value = env.PI_NOTICE_QUIET_HOURS.trim();
		if (value.toLowerCase() === "off") {
			config.quietHours.enabled = false;
		} else {
			const match = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/.exec(value);
			if (match) {
				config.quietHours.enabled = true;
				config.quietHours.start = match[1]!;
				config.quietHours.end = match[3]!;
			}
		}
	}
	if (env.PI_NOTICE_NTFY_URL?.trim()) {
		config.ntfy.url = env.PI_NOTICE_NTFY_URL.trim();
	}
	if (env.PI_NOTICE_NTFY_TOPIC?.trim()) {
		config.ntfy.topic = env.PI_NOTICE_NTFY_TOPIC.trim();
	}
	if (env.PI_NOTICE_NTFY_TOKEN?.trim()) {
		config.ntfy.token = env.PI_NOTICE_NTFY_TOKEN.trim();
	}
	if (env.PI_NOTICE_TERMUX_ACTION?.trim()) {
		config.termux.action = env.PI_NOTICE_TERMUX_ACTION.trim();
	}
	if (["1", "true", "yes", "on"].includes((env.PI_NOTICE_DEBUG ?? "").toLowerCase())) {
		config.debug = true;
	}
	return config;
}

/**
 * Load defaults, then user config, then project config, then environment overrides.
 * A malformed file is reported as a warning instead of breaking session startup.
 */
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
	const sources: string[] = [];
	const warnings: string[] = [];
	let merged: JsonObject = clone(DEFAULT_CONFIG) as unknown as JsonObject;

	for (const path of configPaths(cwd, env)) {
		const file = readConfigFile(path, warnings);
		if (file) {
			merged = mergeConfig(merged, file) as JsonObject;
			sources.push(path);
		}
	}

	const config = applyEnv(normalizeConfig(merged), env);
	return { config, sources, warnings };
}

/** True when the local wall clock falls inside the configured quiet-hours window. */
export function isQuietHours(config: NoticeConfig, now: Date = new Date()): boolean {
	if (!config.quietHours.enabled) {
		return false;
	}
	const toMinutes = (value: string): number => {
		const [hours = "0", minutes = "0"] = value.split(":");
		return Number(hours) * 60 + Number(minutes);
	};
	const start = toMinutes(config.quietHours.start);
	const end = toMinutes(config.quietHours.end);
	const current = now.getHours() * 60 + now.getMinutes();
	if (start === end) {
		return false;
	}
	return start < end ? current >= start && current < end : current >= start || current < end;
}
