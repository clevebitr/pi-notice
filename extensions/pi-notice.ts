import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";

import { helpText, parseCommand, type CommandScope } from "../src/commands.ts";
import { EVENT_KEYS, configFilePath, loadConfig, writeConfigPatch } from "../src/config.ts";
import {
	buildAnswerFailedNotice,
	buildAskNotice,
	buildAskPageNotice,
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
	truncate,
	type AskQuestionLike,
	type TodoSnapshot,
} from "../src/format.ts";
import { LOCALES, getLocale, localeLabel, setLocale, translate as t } from "../src/i18n.ts";
import { NoticeDispatcher } from "../src/notify.ts";
import { applyPanelItem, buildPanelItems } from "../src/panel.ts";
import type { EventKey, Notice, NoticeAction, NoticeConfig, SessionReason } from "../src/types.ts";

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
	/** Questionnaires already notified, so the rpiv event and the tool event do not double-fire. */
	askedToolCalls: Set<string>;
	/** requestIds waiting for a `rpiv:ask-user:answer-result` verdict. */
	answerRequests: Set<string>;
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
		multiSelect: question.multiSelect === true,
		options: Array.isArray(question.options)
			? question.options.filter(isObject).map((option) => ({
					label: typeof option.label === "string" ? option.label : undefined,
				}))
			: [],
	}));
}

function errorKey(error: string | undefined): string {
	return (error || "unknown").slice(0, 60);
}

/** Environment variables that win over the JSON files, surfaced in status. */
const ENV_OVERRIDES = [
	"PI_NOTICE_CONFIG",
	"PI_NOTICE_DISABLED",
	"PI_NOTICE_CHANNELS",
	"PI_NOTICE_EVENTS",
	"PI_NOTICE_SESSION_REASONS",
	"PI_NOTICE_QUIET_HOURS",
	"PI_NOTICE_MIN_DURATION_MS",
] as const;

function cancelTimer(timer: NodeJS.Timeout | undefined): undefined {
	if (timer) {
		clearTimeout(timer);
	}
	return undefined;
}

export interface NoticeDeps {
	/** Inject a dispatcher in tests; production creates one from config. */
	dispatcher?: NoticeDispatcher;
	/** Environment used for config discovery and persistence (tests). */
	env?: NodeJS.ProcessEnv;
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
		askedToolCalls: new Set(),
		answerRequests: new Set(),
	};

	const reload = (cwd: string): void => {
		const loaded = loadConfig(cwd, deps.env ?? process.env);
		state.config = loaded.config;
		state.sources = loaded.sources;
		state.warnings = loaded.warnings;
		state.cwd = cwd;
		setLocale(loaded.config.locale, env());
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

	const env = (): NodeJS.ProcessEnv => deps.env ?? process.env;

	/** Notifications are advisory: a UI or rendering failure must never break a turn. */
	const notifyUi = (
		ctx: Pick<ExtensionContext, "ui" | "hasUI">,
		message: string,
		type: "info" | "warning" | "error" = "info",
	): void => {
		if (!ctx.hasUI || typeof ctx.ui?.notify !== "function") {
			return;
		}
		try {
			ctx.ui.notify(message, type);
		} catch {
			// ignore
		}
	};

	/**
	 * Footer hint in the TUI: only shown when something is notifying differently
	 * from the default (global off, or a subset of events disabled).
	 */
	const syncStatus = (ctx?: Pick<ExtensionContext, "ui" | "hasUI" | "mode">): void => {
		if (!ctx || ctx.mode !== "tui" || typeof ctx.ui?.setStatus !== "function") {
			return;
		}
		try {
			const current = config();
			if (!current) {
				return;
			}
			if (!(state.dispatcher?.isEnabled() ?? current.enabled)) {
				ctx.ui.setStatus("pi-notice", `🔕 ${t("status.footer.off")}`);
				return;
			}
			const disabled = EVENT_KEYS.filter((key) => !current.events[key]);
			ctx.ui.setStatus(
				"pi-notice",
				disabled.length > 0
					? `🔔 ${t("status.footer.partial", { events: disabled.join(",") })}`
					: undefined,
			);
		} catch {
			// ignore
		}
	};

	/** `session` scope never touches disk. */
	const writeScope = (cwd: string, scope: CommandScope): string | undefined =>
		scope === "session" ? undefined : configFilePath(cwd, scope, env());

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
		state.askedToolCalls.clear();
		state.answerRequests.clear();
		state.todo = undefined;

		const current = config();
		syncStatus(ctx);
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

	pi.on("session_shutdown", (_event, ctx) => {
		state.todoTimer = cancelTimer(state.todoTimer);
		state.pendingTodo = undefined;
		if (ctx?.mode === "tui" && typeof ctx.ui?.setStatus === "function") {
			try {
				ctx.ui.setStatus("pi-notice", undefined);
			} catch {
				// ignore
			}
		}
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
	const askOptionLabels = (question: AskQuestionLike): string[] =>
		(question.options ?? [])
			.map((option) => (typeof option?.label === "string" ? option.label.trim() : ""))
			.filter(Boolean);

	/**
	 * One notification per question. A question with more options than the
	 * channel can show gets a paged button set; the last button moves to the next
	 * page. Only single, single-select questionnaires can be answered this way.
	 */
	const showAskPage = async (
		toolCallId: string,
		question: AskQuestionLike,
		start: number,
		plainKey: string,
	): Promise<void> => {
		const current = config();
		const dispatcher = state.dispatcher;
		if (!current || !dispatcher) {
			return;
		}
		const channel = dispatcher.interactiveChannel();
		const labels = askOptionLabels(question);
		if (!channel?.actions || labels.length === 0) {
			send(buildAskNotice(project(), [question], current), plainKey);
			return;
		}

		const max = Math.max(1, channel.actions.maxActions);
		// Walk the page boundaries so the last page may use every button available.
		const starts: number[] = [];
		for (let offset = 0; offset < labels.length; ) {
			starts.push(offset);
			offset += Math.max(1, labels.length - offset <= max ? labels.length - offset : max - 1);
		}
		const pageStart = starts.includes(start) ? start : 0;
		const pageIndex = starts.indexOf(pageStart);
		const pageEnd = Math.min(
			labels.length,
			pageStart + Math.max(1, labels.length - pageStart <= max ? labels.length - pageStart : max - 1),
		);

		const notice = buildAskPageNotice(
			project(),
			question,
			current,
			t,
			{ page: pageIndex + 1, pages: starts.length, from: pageStart + 1, to: pageEnd, total: labels.length },
		);
		const actions: NoticeAction[] = labels.slice(pageStart, pageEnd).map((label, offset) => ({
			id: `ask-opt:${pageStart + offset}`,
			label: `${pageStart + offset + 1}. ${truncate(label, 18)}`,
		}));
		if (pageEnd < labels.length) {
			actions.push({ id: `ask-more:${pageEnd}`, label: t("notice.ask.more") });
		}

		const outcome = await dispatcher.sendInteractive(notice, actions);
		if (outcome.status === "unsupported" || outcome.status === "failed") {
			send(buildAskNotice(project(), [question], current), plainKey);
			return;
		}
		if (outcome.status !== "selected") {
			return;
		}

		const [kind, raw] = outcome.actionId.split(":");
		const value = Number(raw);
		if (kind === "ask-more" && Number.isFinite(value)) {
			void showAskPage(toolCallId, question, value, plainKey);
			return;
		}
		if (kind !== "ask-opt" || !Number.isFinite(value)) {
			return;
		}

		const requestId = `notice:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
		state.answerRequests.add(requestId);
		if (state.answerRequests.size > 50) {
			state.answerRequests.clear();
		}
		pi.events.emit("rpiv:ask-user:answer", {
			toolCallId,
			requestId,
			answers: [{ questionIndex: 0, optionIndexes: [value] }],
		});
	};

	const notifyAsk = (toolCallId: string | undefined, questions: AskQuestionLike[]): void => {
		const current = config();
		if (!current?.events.ask || questions.length === 0) {
			return;
		}
		if (toolCallId) {
			if (state.askedToolCalls.has(toolCallId)) {
				return;
			}
			if (state.askedToolCalls.size > 50) {
				state.askedToolCalls.clear();
			}
			state.askedToolCalls.add(toolCallId);
		}
		state.askSuppressUntil = Date.now() + 5 * 60_000;

		const plainKey = `ask:${toolCallId ?? questions[0]?.question ?? "unknown"}`;
		const question = questions[0];
		const canAnswer =
			Boolean(toolCallId) &&
			questions.length === 1 &&
			question !== undefined &&
			!question.multiSelect &&
			current.askActions &&
			askOptionLabels(question).length > 0 &&
			Boolean(state.dispatcher?.interactiveChannel()?.actions);

		if (!canAnswer) {
			send(buildAskNotice(project(), questions, current), plainKey);
			return;
		}
		void showAskPage(toolCallId!, question!, 0, plainKey);
	};

	pi.events.on("rpiv:ask-user:prompt", (data) => {
		const payload = isObject(data) ? data : {};
		notifyAsk(
			typeof payload.toolCallId === "string" ? payload.toolCallId : undefined,
			asAskQuestions(payload.questions),
		);
	});

	pi.events.on("rpiv:ask-user:blocked", (data) => {
		const payload = isObject(data) ? data : {};
		if (typeof payload.toolCallId === "string") {
			state.askedToolCalls.delete(payload.toolCallId);
		}
		if (payload.active === false) {
			state.askSuppressUntil = 0;
		} else {
			state.askSuppressUntil = Date.now() + 5 * 60_000;
		}
	});

	// A button answer is validated by the ask extension; report refusals once.
	pi.events.on("rpiv:ask-user:answer-result", (data) => {
		const payload = isObject(data) ? data : {};
		const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
		if (!requestId || !state.answerRequests.delete(requestId)) {
			return;
		}
		if (payload.ok === true) {
			return;
		}
		const current = config();
		if (!current?.events.ask) {
			return;
		}
		const code = typeof payload.code === "string" ? payload.code : "invalid_answer";
		send(buildAnswerFailedNotice(project(), code, current, t), `ask-failed:${requestId}`);
	});

	// Cover ask-style tools from other extensions even when they do not publish
	// rpiv events. `notifyAsk` dedupes on the tool-call id, so the rpiv prompt and
	// this handler produce one notification per questionnaire.
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
				options: Array.isArray(args.options) ? asAskQuestions([args])[0]?.options ?? [] : [],
			});
		}
		if (questions.length === 0) {
			return;
		}
		notifyAsk(event.toolCallId, questions);
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

	const openPanel = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || typeof ctx.ui?.custom !== "function") {
			notifyUi(ctx, t("cmd.tuiOnly"), "warning");
			return;
		}
		ensure(ctx.cwd);
		const items = buildPanelItems(config()!, t);
		const target = configFilePath(ctx.cwd, "local", env());
		await ctx.ui.custom((tui, theme, _keybindings, done) => {
			const list = new SettingsList(
				items as SettingItem[],
				Math.min(items.length + 2, 15),
				getSettingsListTheme(),
				(id, newValue) => {
					const patch = applyPanelItem(id, newValue, config()!, t);
					if (!patch) {
						return;
					}
					writeConfigPatch(target, patch as Record<string, unknown>);
					reload(ctx.cwd);
					syncStatus(ctx);
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			const container = new Container();
			container.addChild(
				new (class {
					render(): string[] {
						return [theme.fg("accent", theme.bold(t("panel.title"))), ""];
					}
					invalidate(): void {}
				})(),
			);
			container.addChild(list);

			return {
				render(width: number): string[] {
					return container.render(width);
				},
				invalidate(): void {
					container.invalidate();
				},
				handleInput(data: string): void {
					list.handleInput?.(data);
					tui.requestRender();
				},
			};
		});
	};

	pi.registerCommand("notice", {
		description: t("cmd.desc"),
		handler: async (args, ctx) => {
			const dispatcher = ensure(ctx.cwd);
			const command = parseCommand(args);
			const current = config()!;
			const scopeLabel = (scope: CommandScope): string =>
				scope === "session" ? t("cmd.scope.session") : configFilePath(ctx.cwd, scope, env());

			const eventUpdates = (
				keys: EventKey[],
				enabled: boolean | undefined,
			): Partial<Record<EventKey, boolean>> => {
				const updates: Partial<Record<EventKey, boolean>> = {};
				for (const key of keys) {
					updates[key] = enabled ?? !current.events[key];
				}
				return updates;
			};

			const describe = (updates: Partial<Record<EventKey, boolean>>): string =>
				Object.entries(updates)
					.map(([key, value]) => `${key}=${value ? t("common.on") : t("common.off")}`)
					.join(", ");

			switch (command.type) {
				case "help":
					notifyUi(ctx, helpText(t));
					return;
				case "error":
					notifyUi(ctx, `pi-notice: ${t(`cmd.error.${command.code}`, command.vars)}`, "warning");
					return;
				case "panel":
					await openPanel(ctx);
					return;
				case "reload":
					reload(ctx.cwd);
					syncStatus(ctx);
					notifyUi(ctx, t("cmd.reloaded"));
					return;
				case "test": {
					const result = await dispatcher.send(
						buildTestNotice(project(), dispatcher.channelNames(), t),
						{ force: true },
					);
					const ok = result.filter((item) => item.ok).map((item) => item.name);
					const failed = result.filter((item) => !item.ok);
					const lines = [
						ok.length > 0 ? t("cmd.test.ok", { names: ok.join(", ") }) : t("cmd.test.none"),
						...failed.map(
							(item) => `${item.name}: ${item.error ?? t("cmd.test.none")}`,
						),
					];
					notifyUi(
						ctx,
						`${t("cmd.test.title")}\n${lines.join("\n")}`,
						failed.length ? "warning" : "info",
					);
					return;
				}
				case "enabled": {
					const target = writeScope(ctx.cwd, command.scope);
					if (target) {
						writeConfigPatch(target, { enabled: command.enabled });
						reload(ctx.cwd);
					} else {
						dispatcher.setEnabled(command.enabled);
					}
					syncStatus(ctx);
					notifyUi(
						ctx,
						t(command.enabled ? "cmd.enabled.on" : "cmd.enabled.off", {
							scope: scopeLabel(command.scope),
						}),
					);
					return;
				}
				case "events": {
					const updates = eventUpdates(command.events, command.enabled);
					const target = writeScope(ctx.cwd, command.scope);
					if (target) {
						writeConfigPatch(target, { events: updates });
						reload(ctx.cwd);
					} else {
						Object.assign(current.events, updates);
						dispatcher.setConfig(current);
					}
					syncStatus(ctx);
					notifyUi(
						ctx,
						t("cmd.events.applied", {
							changes: describe(updates),
							scope: scopeLabel(command.scope),
						}),
					);
					return;
				}
				case "channels": {
					const target = writeScope(ctx.cwd, command.scope);
					if (target) {
						writeConfigPatch(target, { channels: command.channels });
						reload(ctx.cwd);
					} else {
						current.channels = command.channels;
						dispatcher.setConfig(current);
					}
					const warnings = dispatcher.channelWarnings();
					notifyUi(
						ctx,
						[
							t("cmd.channels.applied", {
								names: dispatcher.channelNames().join(", ") || t("common.none"),
								scope: scopeLabel(command.scope),
							}),
							...warnings.map((warning) => t("cmd.note", { message: warning })),
						].join("\n"),
						warnings.length > 0 ? "warning" : "info",
					);
					return;
				}
				case "reasons": {
					const target = writeScope(ctx.cwd, command.scope);
					if (target) {
						writeConfigPatch(target, { sessionReasons: command.reasons });
						reload(ctx.cwd);
					} else {
						current.sessionReasons = command.reasons;
						dispatcher.setConfig(current);
					}
					notifyUi(
						ctx,
						t("cmd.reasons.applied", {
							reasons: config()!.sessionReasons.join(", ") || t("common.none"),
							scope: scopeLabel(command.scope),
						}),
					);
					return;
				}
				case "locale": {
					const target = writeScope(ctx.cwd, command.scope);
					if (target) {
						writeConfigPatch(target, { locale: command.locale });
						reload(ctx.cwd);
					} else {
						current.locale = command.locale;
						setLocale(command.locale, env());
						dispatcher.setConfig(current);
					}
					syncStatus(ctx);
					notifyUi(
						ctx,
						t("cmd.locale.applied", {
							locale: localeLabel(command.locale),
							scope: scopeLabel(command.scope),
						}),
					);
					return;
				}
				case "list-events": {
					const lines = [
						t("cmd.events.title"),
						...EVENT_KEYS.map(
							(key) =>
								`${current.events[key] ? "✓" : "✗"} ${key.padEnd(8)}${t(`cmd.events.label.${key}`)}`,
						),
						t("cmd.events.reasons", {
							reasons: current.sessionReasons.join(", ") || t("common.none"),
						}),
						t("cmd.events.hint"),
					];
					notifyUi(ctx, lines.join("\n"));
					return;
				}
				case "list-channels": {
					const warnings = dispatcher.channelWarnings();
					notifyUi(
						ctx,
						[
							t("cmd.channels.title", {
								names: dispatcher.channelNames().join(", ") || t("common.none"),
							}),
							t("cmd.channels.config", { values: current.channels.join(", ") }),
							...warnings.map((warning) => t("cmd.note", { message: warning })),
						].join("\n"),
						warnings.length > 0 ? "warning" : "info",
					);
					return;
				}
				case "list-reasons":
					notifyUi(
						ctx,
						[
							t("cmd.reasons.title", {
								reasons: current.sessionReasons.join(", ") || t("common.none"),
							}),
							t("cmd.reasons.hint"),
						].join("\n"),
					);
					return;
				case "list-locales":
					notifyUi(
						ctx,
						[
							`${t("panel.row.locale")}: ${localeLabel(getLocale())}`,
							LOCALES.map((locale) => `${locale.label} (${locale.code})`).join(", "),
							"/notice locale zh-CN",
						].join("\n"),
					);
					return;
				case "status":
				default: {
					const enabledEvents = EVENT_KEYS.filter((key) => current.events[key]);
					const tools = pi.getAllTools().map((tool) => tool.name);
					const lines = [
						t("cmd.status.title", {
							state: dispatcher.isEnabled() ? t("common.on") : t("common.off"),
						}),
						t("cmd.status.channels", {
							names: dispatcher.channelNames().join(", ") || t("common.none"),
							configured: current.channels.join(", "),
						}),
						t("cmd.status.events", {
							events: enabledEvents.join(", ") || t("common.none"),
							hint:
								enabledEvents.length < EVENT_KEYS.length ? t("cmd.status.eventsHint") : "",
						}),
						t("cmd.status.reasons", {
							reasons: current.sessionReasons.join(", ") || t("common.none"),
						}),
						t("cmd.status.quiet", {
							range: current.quietHours.enabled
								? `${current.quietHours.start}-${current.quietHours.end}`
								: t("cmd.status.quietOff"),
						}),
						t("cmd.status.todo", {
							state: tools.includes("todo")
								? t("cmd.status.todoInstalled")
								: t("cmd.status.todoMissing"),
						}),
						t("cmd.status.config", {
							sources:
								state.sources.length > 0
									? state.sources.join(", ")
									: t("cmd.status.defaultConfig"),
						}),
						`${t("panel.row.locale")}: ${localeLabel(getLocale())}`,
					];
					const warnings = [...state.warnings, ...dispatcher.channelWarnings()];
					const overrides = ENV_OVERRIDES.filter((name) => env()[name]?.trim());
					if (overrides.length > 0) {
						lines.push(t("cmd.status.envOverrides", { names: overrides.join(", ") }));
					}
					if (warnings.length > 0) {
						lines.push(...warnings.map((warning) => t("cmd.note", { message: warning })));
					}
					notifyUi(ctx, lines.join("\n"), warnings.length > 0 ? "warning" : "info");
					return;
				}
			}
		},
	});
}
