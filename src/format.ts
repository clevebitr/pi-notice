import { translate as defaultTranslate, type Translator } from "./i18n.ts";
import type { Notice, NoticeConfig } from "./types.ts";

export interface TodoTask {
	id?: number;
	subject?: string;
	activeForm?: string;
	status?: string;
}

export interface TodoSnapshot {
	action: string;
	tasks: TodoTask[];
	completed: number;
	total: number;
	inProgress: TodoTask[];
	current?: TodoTask;
	allDone: boolean;
	change?: string;
}

export interface SettledInfo {
	project: string;
	status: "completed" | "aborted" | "error";
	durationMs: number;
	turns: number;
	reply?: string;
	error?: string;
	todo?: TodoSnapshot;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Remove ANSI CSI/OSC sequences so terminal output never reaches a notification. */
export function stripAnsi(text: string): string {
	return text
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
		.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b[@-Z\\-_]/g, "");
}

/** Collapse Markdown into a short single-line summary. */
export function stripMarkdown(
	text: string,
	codeLabel: string = defaultTranslate("summary.code"),
): string {
	let out = stripAnsi(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	out = out.replace(/```[\s\S]*?```/g, ` ${codeLabel} `);
	out = out.replace(/~~~[\s\S]*?~~~/g, ` ${codeLabel} `);
	out = out.replace(/!\[[^\]]*]\([^)]*\)/g, "");
	out = out.replace(/\[([^\]]+)]\([^)]*\)/g, "$1");
	out = out.replace(/<[^>]+>/g, "");
	out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
	out = out.replace(/^\s{0,3}>\s?/gm, "");
	out = out.replace(/^\s*[-*+]\s+/gm, "");
	out = out.replace(/^\s*\d+[.)]\s+/gm, "");
	out = out.replace(/`([^`]+)`/g, "$1");
	out = out.replace(/(\*\*|__|~~|\*|_)/g, "");
	out = out.replace(/[ \t]+\n/g, "\n");
	out = out.replace(/\s+/g, " ").trim();
	return out;
}

/** Cut by code points so emoji are never split in half. */
export function truncate(text: string, max: number): string {
	const chars = Array.from(text);
	if (chars.length <= max) {
		return text;
	}
	if (max <= 0) {
		return "";
	}
	return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

export function summarizeReply(
	text: string,
	maxChars: number,
	t: Translator = defaultTranslate,
): string | undefined {
	const summary = stripMarkdown(text, t("summary.code"));
	if (!summary) {
		return undefined;
	}
	return truncate(summary, maxChars);
}

export function formatDuration(ms: number): string {
	const seconds = Math.max(0, ms) / 1000;
	if (seconds < 1) {
		return "<1s";
	}
	if (seconds < 60) {
		return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.round(seconds % 60);
	if (minutes < 60) {
		return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function projectLabel(cwd: string, sessionName?: string): string {
	if (sessionName?.trim()) {
		return truncate(sessionName.trim(), 40);
	}
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const base = normalized.split("/").pop();
	if (!base || base === "." || /^[A-Za-z]:$/.test(base)) {
		return "Pi";
	}
	return truncate(base, 40);
}

function titleWithProject(project: string, suffix: string, includeProject: boolean): string {
	const cleanProject = project.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	const cleanSuffix = suffix.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	const title = includeProject && cleanProject ? `Pi · ${cleanProject} · ${cleanSuffix}` : `Pi · ${cleanSuffix}`;
	return truncate(title, 80);
}

function trimBody(lines: Array<string | undefined>, maxChars: number): string {
	const body = lines
		.filter((line): line is string => Boolean(line && line.trim()))
		.join("\n")
		.trim();
	return truncate(body, maxChars);
}

function todoLine(todo: TodoSnapshot | undefined, t: Translator): string | undefined {
	if (!todo || todo.total === 0) {
		return undefined;
	}
	const current = todo.current;
	const currentLabel = current ? current.activeForm || current.subject : undefined;
	const progress = t("notice.todo.progress", { completed: todo.completed, total: todo.total });
	return currentLabel ? `${progress} · ${t("notice.todo.inProgress", { label: currentLabel })}` : progress;
}

function statusLabel(status: SettledInfo["status"], t: Translator): string {
	return t(`notice.status.${status}`);
}

export function buildSettledNotice(
	info: SettledInfo,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	const lines: string[] = [];

	if (config.summary.includeDuration) {
		const meta = [
			formatDuration(info.durationMs),
			info.turns > 0 ? t("notice.meta.turns", { count: info.turns }) : undefined,
		]
			.filter(Boolean)
			.join(" · ");
		if (meta) {
			lines.push(meta);
		}
	}

	if (info.status === "error") {
		lines.push(
			t("notice.settled.error", { error: truncate(info.error || t("notice.error.generic"), 120) }),
		);
	} else if (info.status === "aborted") {
		lines.push(t("notice.settled.aborted"));
	} else {
		const reply =
			config.summary.includeReply && info.reply
				? summarizeReply(info.reply, config.summary.maxReplyChars, t)
				: undefined;
		lines.push(reply ? `↳ ${reply}` : t("notice.settled.done"));
	}

	if (config.summary.includeTodo) {
		const line = todoLine(info.todo, t);
		if (line) {
			lines.push(line);
		}
	}

	const body = trimBody(lines, config.summary.maxBodyChars);
	const title = titleWithProject(
		info.project,
		statusLabel(info.status, t),
		config.summary.includeProject,
	);
	return {
		title,
		body: body || t("common.waiting"),
		urgency: info.status === "error" ? "high" : info.status === "aborted" ? "low" : "normal",
		kind: info.status === "error" ? "error" : info.status === "aborted" ? "aborted" : "settled",
		tag: "settled",
	};
}

/** Parse the `todo` extension result (`details.tasks`) into a compact snapshot. */
export function parseTodoSnapshot(details: unknown, args?: unknown, t: Translator = defaultTranslate): TodoSnapshot | undefined {
	if (!isObject(details)) {
		return undefined;
	}
	const rawTasks = Array.isArray(details.tasks) ? details.tasks : undefined;
	if (!rawTasks) {
		return undefined;
	}
	const tasks: TodoTask[] = rawTasks.filter(isObject).map((task) => ({
		id: numberValue(task.id),
		subject: stringValue(task.subject),
		activeForm: stringValue(task.activeForm),
		status: stringValue(task.status),
	}));
	const visible = tasks.filter((task) => task.status !== "deleted");
	const completed = visible.filter((task) => task.status === "completed").length;
	const inProgress = visible.filter((task) => task.status === "in_progress");
	const params = isObject(details.params) ? details.params : isObject(args) ? args : {};
	const action =
		stringValue(details.action) ?? (isObject(args) ? stringValue(args.action) : undefined) ?? "update";

	return {
		action,
		tasks: visible,
		completed,
		total: visible.length,
		inProgress,
		current: inProgress[0],
		allDone: visible.length > 0 && completed === visible.length,
		change: describeTodoChange(action, params, visible, t),
	};
}

function describeTodoChange(
	action: string,
	params: JsonObject,
	tasks: TodoTask[],
	t: Translator,
): string | undefined {
	const id = numberValue(params.id);
	const task = id === undefined ? undefined : tasks.find((candidate) => candidate.id === id);
	switch (action) {
		case "create": {
			const batch = Array.isArray(params.tasks) ? params.tasks.length : 0;
			if (batch > 1) {
				return t("notice.todo.change.createdMany", { count: batch });
			}
			const subject = stringValue(params.subject) ?? tasks[tasks.length - 1]?.subject;
			return subject
				? t("notice.todo.change.created", { label: truncate(subject, 60) })
				: t("notice.todo.change.createdPlain");
		}
		case "update": {
			const status = stringValue(params.status);
			const label = task?.subject ? `#${id} ${task.subject}` : id !== undefined ? `#${id}` : undefined;
			if (status === "completed") {
				return label
					? t("notice.todo.change.completed", { label: truncate(label, 60) })
					: t("notice.todo.change.completedPlain");
			}
			if (status === "in_progress") {
				return label
					? t("notice.todo.change.started", { label: truncate(label, 60) })
					: t("notice.todo.change.startedPlain");
			}
			return label
				? t("notice.todo.change.updated", { label: truncate(label, 60) })
				: t("notice.todo.change.updatedPlain");
		}
		case "delete": {
			const label = task?.subject ? `#${id} ${task.subject}` : id !== undefined ? `#${id}` : undefined;
			return label
				? t("notice.todo.change.deleted", { label: truncate(label, 60) })
				: t("notice.todo.change.deletedPlain");
		}
		case "clear":
			return t("notice.todo.change.cleared");
		default:
			return undefined;
	}
}

export function buildTodoNotice(
	snapshot: TodoSnapshot,
	config: NoticeConfig,
	project: string,
	t: Translator = defaultTranslate,
): Notice {
	if (snapshot.total === 0) {
		return {
			title: titleWithProject(project, t("notice.todo.clearedTitle"), config.summary.includeProject),
			body: trimBody([snapshot.change ?? t("notice.todo.clearedBody")], config.summary.maxBodyChars),
			urgency: "low",
			kind: "todo",
			tag: "todo",
		};
	}
	const current = snapshot.current;
	const currentLabel = current ? current.activeForm || current.subject : undefined;
	const lines = [
		`${t("notice.todo.progress", { completed: snapshot.completed, total: snapshot.total })}${
			snapshot.allDone ? " 🎉" : ""
		}`,
		currentLabel ? t("notice.todo.inProgress", { label: truncate(currentLabel, 80) }) : undefined,
		snapshot.change,
	];
	const title = snapshot.allDone
		? titleWithProject(project, t("notice.todo.allDone"), config.summary.includeProject)
		: titleWithProject(
				project,
				t("notice.todo.title", { completed: snapshot.completed, total: snapshot.total }),
				config.summary.includeProject,
			);
	return {
		title,
		body: trimBody(lines, config.summary.maxBodyChars) || t("notice.todo.updated"),
		urgency: "low",
		kind: "todo",
		tag: "todo",
	};
}

export interface AskQuestionLike {
	question?: string;
	header?: string;
	options?: unknown[];
}

export function buildAskNotice(
	project: string,
	questions: AskQuestionLike[],
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	const first = questions[0];
	const question = stringValue(first?.question);
	const header = stringValue(first?.header);
	const optionCount = questions.reduce(
		(total, item) => total + (Array.isArray(item.options) ? item.options.length : 0),
		0,
	);
	const questionsLabel = t("notice.ask.questions", { count: questions.length });
	const optionsLabel = t("notice.ask.options", { count: optionCount });
	const meta =
		questions.length > 1
			? optionCount > 0
				? t("notice.ask.multi", { questions: questionsLabel, options: optionsLabel })
				: questionsLabel
			: optionCount > 0
				? optionsLabel
				: undefined;
	const lines = [
		header && question ? `${header}: ${question}` : question ?? t("notice.ask.waiting"),
		meta,
	];
	return {
		title: titleWithProject(project, t("notice.ask.title"), config.summary.includeProject),
		body: trimBody(lines, config.summary.maxBodyChars) || t("notice.ask.waiting"),
		urgency: "high",
		kind: "ask",
		tag: "ask",
	};
}

export function buildUiPromptNotice(
	project: string,
	kind: string,
	title: string | undefined,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	const key = `notice.ui.${kind}`;
	const translated = t(key);
	const label = translated === key ? t("notice.ui.default") : translated;
	return {
		title: titleWithProject(project, label, config.summary.includeProject),
		body: trimBody([title || t("notice.ui.body")], config.summary.maxBodyChars),
		urgency: "high",
		kind: "ask",
		tag: `ui-${kind}`,
	};
}

export function buildErrorNotice(
	project: string,
	error: string,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	return {
		title: titleWithProject(project, t("notice.status.error"), config.summary.includeProject),
		body: trimBody(
			[truncate(error || t("notice.error.generic"), config.summary.maxBodyChars)],
			config.summary.maxBodyChars,
		),
		urgency: "high",
		kind: "error",
		tag: "error",
	};
}

export function buildRetryNotice(
	project: string,
	attempt: number,
	error: string | undefined,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	return {
		title: titleWithProject(
			project,
			t("notice.retry.title", { attempt }),
			config.summary.includeProject,
		),
		body: trimBody(
			[t("notice.retry.body"), error ? truncate(error, 120) : undefined],
			config.summary.maxBodyChars,
		),
		urgency: "high",
		kind: "retry",
		tag: "retry",
	};
}

export function buildRecoveredNotice(
	project: string,
	attempt: number,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	return {
		title: titleWithProject(project, t("notice.recovered.title"), config.summary.includeProject),
		body: trimBody([t("notice.recovered.body", { attempt })], config.summary.maxBodyChars),
		urgency: "normal",
		kind: "recovered",
		tag: "recovered",
	};
}

export function buildSessionNotice(
	project: string,
	reason: string,
	config: NoticeConfig,
	t: Translator = defaultTranslate,
): Notice {
	const key = `notice.session.reason.${reason}`;
	const translated = t(key);
	const reasonLabel = translated === key ? reason : translated;
	return {
		title: titleWithProject(project, t("notice.session.title"), config.summary.includeProject),
		body: trimBody([t("notice.session.body", { reason: reasonLabel })], config.summary.maxBodyChars),
		urgency: "low",
		kind: "session",
		tag: "session",
	};
}

export function buildTestNotice(
	project: string,
	channels: string[],
	t: Translator = defaultTranslate,
): Notice {
	return {
		title: `Pi · ${t("notice.test.title")}`,
		body: trimBody(
			[
				t("notice.test.project", { project }),
				t("notice.test.channels", { channels: channels.join(", ") || t("notice.test.none") }),
				t("notice.test.time", { time: new Date().toLocaleString() }),
			],
			220,
		),
		urgency: "normal",
		kind: "test",
		tag: "test",
	};
}
