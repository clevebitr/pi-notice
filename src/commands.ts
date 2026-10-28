import { CHANNEL_NAMES, EVENT_KEYS, SESSION_REASONS } from "./config.ts";
import { LOCALES, normalizeLocale, translate as defaultTranslate, type Translator } from "./i18n.ts";
import type { ChannelChoice, ConfigScope, EventKey, SessionReason } from "./types.ts";

/** `session` keeps a change in memory for this run only. */
export type CommandScope = ConfigScope | "session";

const EVENT_ALIASES: Record<EventKey, readonly string[]> = {
	settled: ["settled", "done", "complete", "completed", "end", "finish", "turn", "完成", "结束", "結束"],
	ask: [
		"ask",
		"asks",
		"question",
		"questions",
		"confirm",
		"approve",
		"提问",
		"詢問",
		"询问",
		"确认",
		"確認",
		"回答",
	],
	todo: ["todo", "todos", "task", "tasks", "progress", "待办", "待辦", "进度", "進度", "任务", "任務"],
	errors: ["error", "errors", "err", "fail", "failure", "错误", "錯誤", "报错", "報錯", "失败", "失敗"],
	retry: ["retry", "retries", "recover", "recovered", "重试", "重試", "恢复", "恢復"],
	session: ["session", "sessions", "reconnect", "reconnected", "resume", "重连", "重連", "会话", "會話"],
};

const CHANNEL_ALIASES: Record<string, ChannelChoice> = {
	auto: "auto",
	desktop: "desktop",
	native: "desktop",
	toast: "desktop",
	win: "desktop",
	windows: "desktop",
	mac: "desktop",
	macos: "desktop",
	linux: "desktop",
	桌面: "desktop",
	电脑: "desktop",
	電腦: "desktop",
	termux: "termux",
	android: "termux",
	安卓: "termux",
	手机: "termux",
	手機: "termux",
	ntfy: "ntfy",
	push: "ntfy",
	remote: "ntfy",
	推送: "ntfy",
	osc: "osc",
	terminal: "osc",
	终端: "osc",
	終端機: "osc",
	终端机: "osc",
};

const REASON_ALIASES: Record<string, SessionReason> = {
	startup: "startup",
	start: "startup",
	reload: "reload",
	reconnect: "reload",
	new: "new",
	resume: "resume",
	resumed: "resume",
	fork: "fork",
};

export type ErrorCode =
	| "unknownEvent"
	| "unknownChannel"
	| "unknownReason"
	| "unknownFlag"
	| "unknownCommand"
	| "toggleNeedsEvent"
	| "unknownLocale";

export type NoticeCommand =
	| { type: "status" }
	| { type: "reload" }
	| { type: "test" }
	| { type: "help" }
	| { type: "panel" }
	| { type: "list-events" }
	| { type: "list-channels" }
	| { type: "list-reasons" }
	| { type: "list-locales" }
	| { type: "enabled"; enabled: boolean; scope: CommandScope }
	| { type: "events"; events: EventKey[]; enabled?: boolean; scope: CommandScope }
	| { type: "channels"; channels: ChannelChoice[]; scope: CommandScope }
	| { type: "reasons"; reasons: SessionReason[]; scope: CommandScope }
	| { type: "locale"; locale: string; scope: CommandScope }
	| { type: "error"; code: ErrorCode; vars?: Record<string, string> };

function error(code: ErrorCode, vars?: Record<string, string>): NoticeCommand {
	return { type: "error", code, vars };
}

function splitNames(tokens: string[]): string[] {
	return tokens
		.flatMap((token) => token.split(/[,、]/))
		.map((token) => token.trim())
		.filter(Boolean);
}

function resolveEvents(names: string[]): { events: EventKey[]; unknown: string[] } {
	const events: EventKey[] = [];
	const unknown: string[] = [];
	let all = false;
	for (const raw of names) {
		const name = raw.toLowerCase();
		if (name === "all" || name === "*" || name === "全部") {
			all = true;
			continue;
		}
		const key = EVENT_KEYS.find((candidate) => EVENT_ALIASES[candidate].includes(name));
		if (!key) {
			unknown.push(raw);
			continue;
		}
		if (!events.includes(key)) {
			events.push(key);
		}
	}
	return { events: all ? [...EVENT_KEYS] : events, unknown };
}

function directionCommand(
	enabled: boolean | undefined,
	scope: CommandScope,
	tokens: string[],
): NoticeCommand {
	const names = splitNames(tokens);
	const { events, unknown } = resolveEvents(names);
	if (unknown.length > 0) {
		return error("unknownEvent", { names: unknown.join(", "), available: EVENT_KEYS.join(", ") });
	}
	if (events.length === 0) {
		if (enabled === undefined) {
			return error("toggleNeedsEvent");
		}
		return { type: "enabled", enabled, scope };
	}
	return { type: "events", events, enabled, scope };
}

function channelsCommand(scope: CommandScope, tokens: string[]): NoticeCommand {
	const names = splitNames(tokens);
	if (names.length === 0) {
		return { type: "list-channels" };
	}
	const channels: ChannelChoice[] = [];
	const unknown: string[] = [];
	for (const raw of names) {
		const channel = CHANNEL_ALIASES[raw.toLowerCase()];
		if (!channel) {
			unknown.push(raw);
		} else if (!channels.includes(channel)) {
			channels.push(channel);
		}
	}
	if (unknown.length > 0) {
		return error("unknownChannel", {
			names: unknown.join(", "),
			available: ["auto", ...CHANNEL_NAMES].join(", "),
		});
	}
	return { type: "channels", channels, scope };
}

function reasonsCommand(scope: CommandScope, tokens: string[]): NoticeCommand {
	const names = splitNames(tokens);
	if (names.length === 0) {
		return { type: "list-reasons" };
	}
	const reasons: SessionReason[] = [];
	const unknown: string[] = [];
	for (const raw of names) {
		const reason = REASON_ALIASES[raw.toLowerCase()];
		if (!reason) {
			unknown.push(raw);
		} else if (!reasons.includes(reason)) {
			reasons.push(reason);
		}
	}
	if (unknown.length > 0) {
		return error("unknownReason", {
			names: unknown.join(", "),
			available: SESSION_REASONS.join(", "),
		});
	}
	return { type: "reasons", reasons, scope };
}

function localeCommand(scope: CommandScope, tokens: string[]): NoticeCommand {
	const names = splitNames(tokens);
	if (names.length === 0) {
		return { type: "list-locales" };
	}
	const code = normalizeLocale(names[0]);
	if (!code) {
		return error("unknownLocale", {
			names: names.join(", "),
			available: LOCALES.map((locale) => locale.code).join(", "),
		});
	}
	return { type: "locale", locale: code, scope };
}

/**
 * Parse `/notice` arguments.
 *
 * Flags: `--global`/`-g`, `--local`/`-l` (default), `--session`/`--temp`/`-t`.
 * `all` may be used where an event list is expected.
 */
export function parseCommand(input: string): NoticeCommand {
	const tokens = input.trim().split(/\s+/).filter(Boolean);
	let scope: CommandScope = "local";
	const rest: string[] = [];

	for (const token of tokens) {
		const flag = token.toLowerCase();
		if (flag === "--global" || flag === "-g" || flag === "global") {
			scope = "global";
		} else if (flag === "--local" || flag === "-l" || flag === "local") {
			scope = "local";
		} else if (flag === "--session" || flag === "--temp" || flag === "-t" || flag === "temp") {
			scope = "session";
		} else if (flag.startsWith("-")) {
			return error("unknownFlag", { flag: token });
		} else {
			rest.push(token);
		}
	}

	if (rest.length === 0) {
		return { type: "panel" };
	}

	const head = rest[0]!.toLowerCase();
	const args = rest.slice(1);

	switch (head) {
		case "status":
		case "状态":
		case "狀態":
			return { type: "status" };
		case "panel":
		case "config":
		case "面板":
		case "設定":
		case "设置":
			return { type: "panel" };
		case "help":
		case "?":
		case "帮助":
		case "幫助":
			return { type: "help" };
		case "test":
		case "测试":
		case "測試":
			return { type: "test" };
		case "reload":
		case "重载":
		case "重載":
		case "重新加载":
		case "重新載入":
			return { type: "reload" };
		case "events":
		case "event":
		case "事件":
			return args.length === 0 ? { type: "list-events" } : directionCommand(true, scope, args);
		case "channels":
		case "channel":
		case "通道":
			return channelsCommand(scope, args);
		case "reasons":
		case "reason":
		case "重连原因":
		case "重連原因":
			return reasonsCommand(scope, args);
		case "locale":
		case "lang":
		case "language":
		case "语言":
		case "語言":
			return localeCommand(scope, args);
		case "on":
		case "enable":
		case "开":
		case "開":
		case "开启":
		case "開啟":
			return directionCommand(true, scope, args);
		case "off":
		case "disable":
		case "关":
		case "關":
		case "关闭":
		case "關閉":
			return directionCommand(false, scope, args);
		case "toggle":
		case "切换":
		case "切換":
			return directionCommand(undefined, scope, args);
		default:
			return error("unknownCommand", { name: rest[0]! });
	}
}

export function helpText(t: Translator = defaultTranslate): string {
	return t("cmd.help");
}

export function localeChoices(): Array<{ code: string; label: string }> {
	return LOCALES.map((locale) => ({ code: locale.code, label: locale.label }));
}
