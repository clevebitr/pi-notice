export type ChannelName = "desktop" | "termux" | "ntfy" | "osc";

export type ChannelChoice = ChannelName | "auto";

/** Where a configuration change is written: project file or user-level file. */
export type ConfigScope = "local" | "global";

export type EventKey = "settled" | "ask" | "todo" | "errors" | "retry" | "session";

export type SessionReason = "startup" | "reload" | "new" | "resume" | "fork";

export type NoticeUrgency = "low" | "normal" | "high";

export type NoticeKind =
	| "settled"
	| "aborted"
	| "ask"
	| "todo"
	| "error"
	| "retry"
	| "recovered"
	| "session"
	| "test";

export interface Notice {
	title: string;
	body: string;
	/** High urgency bypasses quiet hours when `quietHours.allowUrgent` is true. */
	urgency: NoticeUrgency;
	kind: NoticeKind;
	/** Stable-ish identifier used for de-duplication and platform grouping. */
	tag?: string;
}

export interface QuietHoursConfig {
	enabled: boolean;
	/** Local time in HH:MM (24h). Ranges may wrap midnight, e.g. 23:00 -> 08:00. */
	start: string;
	end: string;
	/** Ask/error notifications still fire during quiet hours. */
	allowUrgent: boolean;
}

export interface SummaryConfig {
	/** Hard cap for the notification body. */
	maxBodyChars: number;
	/** Cap for the quoted assistant reply. */
	maxReplyChars: number;
	includeProject: boolean;
	includeDuration: boolean;
	includeReply: boolean;
	includeTodo: boolean;
}

export interface DesktopConfig {
	sound: boolean;
	/** Windows toast app id (SnoreToast `-appID`). */
	appId: string;
	/** Seconds the toast stays visible on Windows. */
	timeoutSeconds: number;
}

export interface TermuxConfig {
	command: string;
	notificationId: string;
	/** `auto` maps high urgency to high and normal to default. */
	priority: "auto" | "low" | "default" | "high" | "max";
	sound: boolean;
	vibrate: boolean;
	vibrateMs: number;
	group: string;
	/** Optional shell command executed when the Android notification is tapped. */
	action?: string;
}

export interface NtfyConfig {
	/** Base server URL, e.g. https://ntfy.sh. `{topic}` is replaced when present. */
	url: string;
	topic: string;
	token: string;
	priority: "auto" | "low" | "default" | "high" | "max";
	tags: string[];
}

export interface OscConfig {
	/** Opt-in terminal escape-sequence notifications (Ghostty/iTerm2/WezTerm/Kitty). */
	enabled: boolean;
}

export interface NoticeConfig {
	enabled: boolean;
	/** `auto` follows `PI_NOTICE_LOCALE` / `LC_ALL` / `LANG`; otherwise a shipped locale code. */
	locale: string;
	channels: ChannelChoice[];
	events: Record<EventKey, boolean>;
	sessionReasons: SessionReason[];
	/** Do not notify for runs shorter than this (errors still notify). */
	minDurationMs: number;
	quietHours: QuietHoursConfig;
	summary: SummaryConfig;
	desktop: DesktopConfig;
	termux: TermuxConfig;
	ntfy: NtfyConfig;
	osc: OscConfig;
	dedupeWindowMs: number;
	debug: boolean;
}

export interface LoadedConfig {
	config: NoticeConfig;
	/** Files that were read, in merge order. */
	sources: string[];
	warnings: string[];
}
