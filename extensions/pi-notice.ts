import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../src/config.ts";
import {
	buildAskNotice,
	buildErrorNotice,
	buildRecoveredNotice,
	buildRetryNotice,
	buildSessionNotice,
	buildSettledNotice,
	buildTestNotice,
	buildTodoNotice,
	buildUiPromptNotice,
	parseTodoSnapshot,
	projectLabel,
	type AskQuestionLike,
	type TodoSnapshot,
} from "../src/format.ts";
import { NoticeDispatcher } from "../src/notify.ts";
import type { Notice, NoticeConfig, SessionReason } from "../src/types.ts";

interface RuntimeState {
	config?: NoticeConfig;
	sources: string[];
	warnings: string[];
	cwd: string;
	dispatcher?: NoticeDispatcher;
	runActive: boolean;
	runStartedAt?: number;
	turns: number;
	lastReply?: string;
	lastError?: string;
	pendingRetry: boolean;
	retryCount: number;
	todo?: TodoSnapshot;
	pendingTodo?: TodoSnapshot;
	todoTimer?: NodeJS.Timeout;
	askSuppressUntil: number;
}

type AssistantMessageLike = {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
	content?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assistantText(message: AssistantMessageLike): string {
	if (!Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.filter((block): block is { type: string; text: string } => isObject(block) && block.type === "text")
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.filter(Boolean)
		.join("\n");
}

function lastAssistant(messages: unknown): AssistantMessageLike | undefined {
	if (!Array.isArray(messages)) {
		return undefined;
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (isObject(message) && message.role === "assistant") {
			return message as AssistantMessageLike;
		}
	}
	return undefined;
}

function asAskQuestions(value: unknown): AskQuestionLike[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(isObject).map((question) => ({
		question: typeof question.question === "string" ? question.question : undefined,
		header: typeof question.header === "string" ? question.header : undefined,
		options: Array.isArray(question.options) ? question.options : [],
	}));
}

function errorKey(error: string | undefined): string {
	return (error || "unknown").slice(0, 60);
}

function cancelTimer(timer: NodeJS.Timeout | undefined): undefined {
	if (timer) {
		clearTimeout(timer);
	}
	return undefined;
}

export interface NoticeDeps {
	/** Inject a dispatcher in tests; production creates one from config. */
	dispatcher?: NoticeDispatcher;
}

export default function piNotice(pi: ExtensionAPI, deps: NoticeDeps = {}): void {
	const state: RuntimeState = {
		sources: [],
		warnings: [],
		cwd: process.cwd(),
		runActive: false,
		turns: 0,
		pendingRetry: false,
		retryCount: 0,
		askSuppressUntil: 0,
	};

	const reload = (cwd: string): void => {
		const loaded = loadConfig(cwd);
		state.config = loaded.config;
		state.sources = loaded.sources;
		state.warnings = loaded.warnings;
		state.cwd = cwd;
		if (deps.dispatcher) {
			state.dispatcher = deps.dispatcher;
			state.dispatcher.setConfig(loaded.config);
		} else if (!state.dispatcher) {
			state.dispatcher = new NoticeDispatcher({ config: loaded.config });
		} else {
			state.dispatcher.setConfig(loaded.config);
		}
		state.dispatcher.setEnabled(loaded.config.enabled);
		for (const warning of loaded.warnings) {
			console.error(`[pi-notice] ${warning}`);
		}
	};

	const ensure = (cwd: string): NoticeDispatcher => {
		if (!state.dispatcher || state.cwd !== cwd) {
			reload(cwd);
		}
		return state.dispatcher!;
	};

	const project = (): string => projectLabel(state.cwd, pi.getSessionName());
	const config = (): NoticeConfig | undefined => state.config;

	const send = (notice: Notice, key?: string): void => {
		void state.dispatcher?.send(notice, { key });
	};

	const flushTodo = (): void => {
		state.todoTimer = cancelTimer(state.todoTimer);
		const snapshot = state.pendingTodo;
		state.pendingTodo = undefined;
		const current = config();
		if (!snapshot || !current?.events.todo) {
			return;
		}
		send(buildTodoNotice(snapshot, current, project()), `todo:${Date.now()}`);
	};

	const scheduleTodo = (snapshot: TodoSnapshot): void => {
		state.pendingTodo = snapshot;
		if (snapshot.allDone || snapshot.total === 0) {
			flushTodo();
			return;
		}
		if (!state.todoTimer) {
			state.todoTimer = setTimeout(flushTodo, 1500);
			state.todoTimer.unref?.();
		}
	};

	pi.on("session_start", (event, ctx) => {
		reload(ctx.cwd);
		state.todoTimer = cancelTimer(state.todoTimer);
		state.pendingTodo = undefined;
		state.runActive = false;
		state.runStartedAt = undefined;
		state.turns = 0;
		state.lastReply = undefined;
		state.lastError = undefined;
		state.pendingRetry = false;
		state.retryCount = 0;
		state.askSuppressUntil = 0;
		state.todo = undefined;

		const current = config();
		if (
			current?.events.session &&
			current.sessionReasons.includes(event.reason as SessionReason)
		) {
			send(
				buildSessionNotice(project(), event.reason, current),
				`session:${event.reason}:${Date.now()}`,
			);
		}
	});

	pi.on("session_shutdown", () => {
		state.todoTimer = cancelTimer(state.todoTimer);
		state.pendingTodo = undefined;
	});

	pi.on("agent_start", () => {
		if (state.runActive) {
			return;
		}
		state.runActive = true;
		state.runStartedAt = Date.now();
		state.turns = 0;
		state.lastReply = undefined;
		state.lastError = undefined;
		state.pendingRetry = false;
		state.retryCount = 0;
	});

	pi.on("turn_start", () => {
		state.turns += 1;
	});

	pi.on("message_end", (event) => {
		const message = event.message as AssistantMessageLike;
		if (message?.role !== "assistant") {
			return;
		}
		const text = assistantText(message);
		if (text.trim()) {
			state.lastReply = text;
		}

		if (message.stopReason === "error") {
			state.lastError = message.errorMessage || "模型请求失败";
			return;
		}
		if (message.stopReason === "aborted") {
			state.pendingRetry = false;
			return;
		}

		state.lastError = undefined;
		if (state.pendingRetry) {
			const attempt = state.retryCount;
			state.pendingRetry = false;
			state.retryCount = 0;
			const current = config();
			if (attempt > 0 && current?.events.retry) {
				send(buildRecoveredNotice(project(), attempt, current), `recovered:${attempt}`);
			}
		}
	});

	pi.on("agent_end", (event) => {
		const last = lastAssistant(event.messages);
		const willRetry = Boolean((event as { willRetry?: boolean }).willRetry);
		const error =
			last?.stopReason === "error"
				? last.errorMessage || state.lastError || "模型请求失败"
				: state.lastError;
		if (!error) {
			return;
		}
		state.lastError = error;

		if (willRetry) {
			state.pendingRetry = true;
			state.retryCount += 1;
			const current = config();
			if (current?.events.retry) {
				send(
					buildRetryNotice(project(), state.retryCount, error, current),
					`retry:${state.retryCount}:${errorKey(error)}`,
				);
			}
			return;
		}

		state.pendingRetry = false;
		const current = config();
		// The settled notification carries the error unless turn-end notifications
		// are disabled; in that case send a dedicated error notification.
		if (current && !current.events.settled && current.events.errors) {
			send(buildErrorNotice(project(), error, current), `error:${errorKey(error)}`);
		}
	});

	pi.on("agent_settled", (event) => {
		const current = config();
		if (!current) {
			return;
		}
		const durationMs = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
		const status: "completed" | "aborted" | "error" = event.aborted
			? "aborted"
			: state.lastError
				? "error"
				: "completed";

		state.todoTimer = cancelTimer(state.todoTimer);
		if (!current.events.settled && current.events.todo && state.pendingTodo) {
			flushTodo();
		}
		state.pendingTodo = undefined;

		const longEnough = status === "error" || durationMs >= current.minDurationMs;
		if (current.events.settled && longEnough) {
			send(
				buildSettledNotice(
					{
						project: project(),
						status,
						durationMs,
						turns: state.turns,
						reply: state.lastReply,
						error: state.lastError,
						todo: state.todo,
					},
					current,
				),
				`settled:${state.runStartedAt ?? Date.now()}`,
			);
		}

		state.runActive = false;
		state.runStartedAt = undefined;
		state.lastError = undefined;
		state.pendingRetry = false;
		state.retryCount = 0;
	});

	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== "todo" || event.isError) {
			return;
		}
		const result = event.result as { details?: unknown } | undefined;
		const snapshot = parseTodoSnapshot(result?.details);
		if (!snapshot) {
			return;
		}
		state.todo = snapshot;
		const current = config();
		if (!current?.events.todo) {
			return;
		}
		if (!["create", "update", "delete", "clear"].includes(snapshot.action)) {
			return;
		}
		scheduleTodo(snapshot);
	});

	// @juicesharp/rpiv-ask-user-question publishes these events specifically for
	// notification integrations. `blocked` closes the suppression window so a
	// later generic UI prompt is not swallowed.
	pi.events.on("rpiv:ask-user:prompt", (data) => {
		const current = config();
		if (!current?.events.ask) {
			return;
		}
		const payload = isObject(data) ? data : {};
		const questions = asAskQuestions(payload.questions);
		state.askSuppressUntil = Date.now() + 5 * 60_000;
		send(
			buildAskNotice(project(), questions, current),
			`ask:${typeof payload.toolCallId === "string" ? payload.toolCallId : questions[0]?.question ?? "unknown"}`,
		);
	});

	pi.events.on("rpiv:ask-user:blocked", (data) => {
		const payload = isObject(data) ? data : {};
		if (payload.active === false) {
			state.askSuppressUntil = 0;
		} else {
			state.askSuppressUntil = Date.now() + 5 * 60_000;
		}
	});


	// Cover ask-style tools from other extensions even when they do not publish
	// rpiv events. The rpiv prompt event uses the same toolCallId key, so the
	// duplicate is dropped by the dispatcher's dedupe window.
	pi.on("tool_execution_start", (event) => {
		const current = config();
		if (!current?.events.ask) {
			return;
		}
		const name = event.toolName.toLowerCase();
		const isAskTool =
			name === "ask_user_question" || /(^|[_-])ask([_-]|$)/.test(name) || name.includes("question");
		if (!isAskTool) {
			return;
		}
		const args = isObject(event.args) ? event.args : {};
		const questions = asAskQuestions(args.questions);
		if (questions.length === 0 && typeof args.question === "string") {
			questions.push({
				question: args.question,
				header: typeof args.header === "string" ? args.header : undefined,
				options: Array.isArray(args.options) ? args.options : [],
			});
		}
		if (questions.length === 0) {
			return;
		}
		state.askSuppressUntil = Date.now() + 5 * 60_000;
		send(buildAskNotice(project(), questions, current), `ask:${event.toolCallId}`);
	});

	pi.on("ui_prompt_start", (event) => {
		const current = config();
		if (!current?.events.ask || event.kind === "custom" || Date.now() < state.askSuppressUntil) {
			return;
		}
		send(
			buildUiPromptNotice(project(), event.kind, event.title, current),
			`ui:${event.kind}:${event.title ?? ""}`,
		);
	});

	pi.registerCommand("notice", {
		description: "查看或控制 pi-notice（on/off/toggle/test/status/reload）",
		handler: async (args, ctx) => {
			const dispatcher = ensure(ctx.cwd);
			const current = config()!;
			const action = (args.trim().split(/\s+/)[0] || "status").toLowerCase();

			switch (action) {
				case "on":
					dispatcher.setEnabled(true);
					ctx.ui.notify("pi-notice: 已开启", "info");
					return;
				case "off":
					dispatcher.setEnabled(false);
					ctx.ui.notify("pi-notice: 已关闭（本次运行）", "info");
					return;
				case "toggle":
					dispatcher.setEnabled(!dispatcher.isEnabled());
					ctx.ui.notify(`pi-notice: 已${dispatcher.isEnabled() ? "开启" : "关闭"}`, "info");
					return;
				case "reload":
					reload(ctx.cwd);
					ctx.ui.notify("pi-notice: 配置已重新加载", "info");
					return;
				case "test": {
					const result = await dispatcher.send(
						buildTestNotice(project(), dispatcher.channelNames()),
						{ force: true },
					);
					const ok = result.filter((item) => item.ok).map((item) => item.name);
					const failed = result.filter((item) => !item.ok);
					const lines = [
						ok.length > 0 ? `成功: ${ok.join(", ")}` : "没有通道发送成功",
						...failed.map((item) => `${item.name}: ${item.error ?? "失败"}`),
					];
					ctx.ui.notify(`pi-notice 测试\n${lines.join("\n")}`, failed.length ? "warning" : "info");
					return;
				}
				case "status":
				default: {
					const events = Object.entries(current.events)
						.filter(([, enabled]) => enabled)
						.map(([name]) => name)
						.join(", ");
					const tools = pi.getAllTools().map((tool) => tool.name);
					const lines = [
						`pi-notice: ${dispatcher.isEnabled() ? "开启" : "关闭"}`,
						`通道: ${dispatcher.channelNames().join(", ") || "无"}`,
						`事件: ${events || "无"}`,
						`静默时段: ${
							current.quietHours.enabled
								? `${current.quietHours.start}-${current.quietHours.end}`
								: "关闭"
						}`,
						`todo 工具: ${tools.includes("todo") ? "已安装" : "未检测到"}`,
						`ask 事件: rpiv:ask-user:prompt`,
						`配置: ${state.sources.length > 0 ? state.sources.join(", ") : "默认配置"}`,
					];
					const warnings = [...state.warnings, ...dispatcher.channelWarnings()];
					if (warnings.length > 0) {
						lines.push(...warnings.map((warning) => `注意: ${warning}`));
					}
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}
			}
		},
	});
}
