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
export function stripMarkdown(text: string): string {
	let out = stripAnsi(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	out = out.replace(/```[\s\S]*?```/g, " [代码] ");
	out = out.replace(/~~~[\s\S]*?~~~/g, " [代码] ");
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

export function summarizeReply(text: string, maxChars: number): string | undefined {
	const summary = stripMarkdown(text);
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

function todoLine(todo: TodoSnapshot | undefined): string | undefined {
	if (!todo || todo.total === 0) {
		return undefined;
	}
	const current = todo.current;
	const currentLabel = current ? current.activeForm || current.subject : undefined;
	const progress = `Todo ${todo.completed}/${todo.total} 完成`;
	return currentLabel ? `${progress} · 进行中: ${currentLabel}` : progress;
}

const STATUS_LABEL: Record<SettledInfo["status"], string> = {
	completed: "完成",
	aborted: "已中止",
	error: "出错",
};

export function buildSettledNotice(info: SettledInfo, config: NoticeConfig): Notice {
	const lines: string[] = [];

	if (config.summary.includeDuration) {
		const meta = [formatDuration(info.durationMs), info.turns > 0 ? `${info.turns} 轮` : undefined]
			.filter(Boolean)
			.join(" · ");
		if (meta) {
			lines.push(meta);
		}
	}

	if (info.status === "error") {
		lines.push(`错误: ${truncate(info.error || "模型请求失败", 120)}`);
	} else if (info.status === "aborted") {
		lines.push("已中止，等待你的下一步指令。");
	} else {
		const reply =
			config.summary.includeReply && info.reply
				? summarizeReply(info.reply, config.summary.maxReplyChars)
				: undefined;
		lines.push(reply ? `↳ ${reply}` : "已完成，等待你的下一步指令。");
	}

	if (config.summary.includeTodo) {
		const line = todoLine(info.todo);
		if (line) {
			lines.push(line);
		}
	}

	const body = trimBody(lines, config.summary.maxBodyChars);
	const title = titleWithProject(info.project, STATUS_LABEL[info.status], config.summary.includeProject);
	return {
		title,
		body: body || "等待你的下一步指令。",
		urgency: info.status === "error" ? "high" : info.status === "aborted" ? "low" : "normal",
		kind: info.status === "error" ? "error" : info.status === "aborted" ? "aborted" : "settled",
		tag: "settled",
	};
}

/** Parse the `todo` extension result (`details.tasks`) into a compact snapshot. */
export function parseTodoSnapshot(details: unknown, args?: unknown): TodoSnapshot | undefined {
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
		change: describeTodoChange(action, params, visible),
	};
}

function describeTodoChange(action: string, params: JsonObject, tasks: TodoTask[]): string | undefined {
	const id = numberValue(params.id);
	const task = id === undefined ? undefined : tasks.find((candidate) => candidate.id === id);
	switch (action) {
		case "create": {
			const batch = Array.isArray(params.tasks) ? params.tasks.length : 0;
			if (batch > 1) {
				return `新增 ${batch} 个任务`;
			}
			const subject = stringValue(params.subject) ?? tasks[tasks.length - 1]?.subject;
			return subject ? `新增: ${truncate(subject, 60)}` : "新增任务";
		}
		case "update": {
			const status = stringValue(params.status);
			const label = task?.subject ? `#${id} ${task.subject}` : id !== undefined ? `#${id}` : undefined;
			if (status === "completed") {
				return label ? `完成: ${truncate(label, 60)}` : "完成任务";
			}
			if (status === "in_progress") {
				return label ? `开始: ${truncate(label, 60)}` : "开始任务";
			}
			return label ? `更新: ${truncate(label, 60)}` : "更新任务";
		}
		case "delete": {
			const label = task?.subject ? `#${id} ${task.subject}` : id !== undefined ? `#${id}` : undefined;
			return label ? `删除: ${truncate(label, 60)}` : "删除任务";
		}
		case "clear":
			return "清空任务";
		default:
			return undefined;
	}
}

export function buildTodoNotice(
	snapshot: TodoSnapshot,
	config: NoticeConfig,
	project: string,
): Notice {
	if (snapshot.total === 0) {
		return {
			title: titleWithProject(project, "Todo 已清空", config.summary.includeProject),
			body: trimBody([snapshot.change ?? "任务列表已清空。"], config.summary.maxBodyChars),
			urgency: "low",
			kind: "todo",
			tag: "todo",
		};
	}
	const current = snapshot.current;
	const currentLabel = current ? current.activeForm || current.subject : undefined;
	const lines = [
		`完成 ${snapshot.completed}/${snapshot.total}${snapshot.allDone ? " 🎉" : ""}`,
		currentLabel ? `进行中: ${truncate(currentLabel, 80)}` : undefined,
		snapshot.change,
	];
	const title = snapshot.allDone
		? titleWithProject(project, "Todo 全部完成", config.summary.includeProject)
		: titleWithProject(project, `Todo ${snapshot.completed}/${snapshot.total}`, config.summary.includeProject);
	return {
		title,
		body: trimBody(lines, config.summary.maxBodyChars) || "Todo 已更新",
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
): Notice {
	const first = questions[0];
	const question = stringValue(first?.question);
	const header = stringValue(first?.header);
	const optionCount = questions.reduce(
		(total, item) => total + (Array.isArray(item.options) ? item.options.length : 0),
		0,
	);
	const meta =
		questions.length > 1
			? `共 ${questions.length} 个问题${optionCount > 0 ? ` · ${optionCount} 个选项` : ""}`
			: optionCount > 0
				? `${optionCount} 个选项`
				: undefined;
	const lines = [
		header && question ? `${header}: ${question}` : question ?? "Pi 正在等待你的回答。",
		meta,
	];
	return {
		title: titleWithProject(project, "需要你的回答", config.summary.includeProject),
		body: trimBody(lines, config.summary.maxBodyChars) || "Pi 正在等待你的回答。",
		urgency: "high",
		kind: "ask",
		tag: "ask",
	};
}

const UI_PROMPT_LABEL: Record<string, string> = {
	confirm: "等待确认",
	select: "等待选择",
	input: "等待输入",
	editor: "等待编辑",
	custom: "等待操作",
};

export function buildUiPromptNotice(
	project: string,
	kind: string,
	title: string | undefined,
	config: NoticeConfig,
): Notice {
	const label = UI_PROMPT_LABEL[kind] ?? "等待操作";
	return {
		title: titleWithProject(project, label, config.summary.includeProject),
		body: trimBody([title || "Pi 正在等待你在终端中操作。"], config.summary.maxBodyChars),
		urgency: "high",
		kind: "ask",
		tag: `ui-${kind}`,
	};
}

export function buildErrorNotice(
	project: string,
	error: string,
	config: NoticeConfig,
): Notice {
	return {
		title: titleWithProject(project, "出错", config.summary.includeProject),
		body: trimBody([truncate(error || "模型请求失败", config.summary.maxBodyChars)], config.summary.maxBodyChars),
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
): Notice {
	return {
		title: titleWithProject(project, `重试中 (${attempt})`, config.summary.includeProject),
		body: trimBody(
			["连接中断，正在自动重连…", error ? truncate(error, 120) : undefined],
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
): Notice {
	return {
		title: titleWithProject(project, "已恢复连接", config.summary.includeProject),
		body: trimBody([`第 ${attempt} 次重试成功，继续执行。`], config.summary.maxBodyChars),
		urgency: "normal",
		kind: "recovered",
		tag: "recovered",
	};
}

export function buildSessionNotice(
	project: string,
	reason: string,
	config: NoticeConfig,
): Notice {
	return {
		title: titleWithProject(project, "会话已恢复", config.summary.includeProject),
		body: trimBody([`已重新连接（${reason}），等待你的指令。`], config.summary.maxBodyChars),
		urgency: "low",
		kind: "session",
		tag: "session",
	};
}

export function buildTestNotice(project: string, channels: string[]): Notice {
	return {
		title: "Pi · 通知测试",
		body: trimBody(
			[
				`项目: ${project}`,
				`通道: ${channels.join(", ") || "未配置"}`,
				`时间: ${new Date().toLocaleString()}`,
			],
			220,
		),
		urgency: "normal",
		kind: "test",
		tag: "test",
	};
}
