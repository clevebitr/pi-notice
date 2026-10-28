import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import piNotice from "../extensions/pi-notice.ts";
import { loadConfig } from "../src/config.ts";
import { NoticeDispatcher } from "../src/notify.ts";
import type { Channel } from "../src/channels/types.ts";
import type { Notice, NoticeConfig } from "../src/types.ts";

type Handler = (event?: any, ctx?: any) => unknown;

function createPi(): {
	api: ExtensionAPI;
	emit: (name: string, event?: unknown, ctx?: unknown) => Promise<void>;
	emitBus: (name: string, data: unknown) => void;
	commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> }>;
} {
	const handlers = new Map<string, Handler[]>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const api = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		},
		events: {
			on(name: string, handler: (data: unknown) => void) {
				bus.set(name, [...(bus.get(name) ?? []), handler]);
				return () => {};
			},
			emit(name: string, data: unknown) {
				for (const handler of bus.get(name) ?? []) {
					handler(data);
				}
			},
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
			commands.set(name, options);
		},
		getSessionName: () => "test-session",
		getAllTools: () => [{ name: "todo" }, { name: "ask_user_question" }],
	} as unknown as ExtensionAPI;

	return {
		api,
		async emit(name, event, ctx) {
			for (const handler of handlers.get(name) ?? []) {
				await handler(event, ctx);
			}
		},
		emitBus(name, data) {
			for (const handler of bus.get(name) ?? []) {
				handler(data);
			}
		},
		commands,
	};
}

function fakeChannel(): Channel & { sent: Notice[] } {
	const sent: Notice[] = [];
	return { name: "desktop", sent, async send(value) { sent.push(value); } };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

async function withRuntime(
	configData: Partial<NoticeConfig>,
	fn: (context: {
		dir: string;
		channel: ReturnType<typeof fakeChannel>;
		pi: ReturnType<typeof createPi>;
		ctx: { cwd: string; ui: { notify: (...args: any[]) => void }; hasUI: boolean };
		config: NoticeConfig;
	}) => Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "pi-notice-ext-"));
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi", "pi-notice.json"), JSON.stringify(configData), "utf8");
	const config = loadConfig(dir).config;
	const channel = fakeChannel();
	const dispatcher = new NoticeDispatcher({
		config,
		channels: [channel],
		logger: { debug: () => {}, warn: () => {} },
	});
	const pi = createPi();
	piNotice(pi.api, { dispatcher });
	const uiNotices: string[] = [];
	const ctx = {
		cwd: dir,
		ui: { notify: (message: string) => uiNotices.push(message) },
		hasUI: true,
	};
	try {
		await fn({ dir, channel, pi, ctx, config });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const startup = { reason: "startup" };

test("session resume sends a reconnect notification", async () => {
	await withRuntime({ sessionReasons: ["resume"] }, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", { reason: "resume" }, ctx);
		await tick();
		assert.equal(channel.sent[0]?.kind, "session");
		assert.match(channel.sent[0]?.body ?? "", /重新连接/);
	});
});

test("agent settled sends a summary notification", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("agent_start");
		await pi.emit("turn_start", { turnIndex: 0 });
		await pi.emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "已完成工作" }] },
		});
		await pi.emit("agent_settled", { aborted: false });
		await tick();
		const settled = channel.sent.find((item) => item.kind === "settled");
		assert.ok(settled);
		assert.match(settled?.body ?? "", /已完成工作/);
	});
});

test("ask extension prompt event sends an urgent question notification", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		pi.emitBus("rpiv:ask-user:prompt", {
			toolCallId: "ask-1",
			questions: [{ header: "方案", question: "选哪个?", options: [{}, {}] }],
		});
		await tick();
		const ask = channel.sent.find((item) => item.kind === "ask");
		assert.ok(ask);
		assert.match(ask?.body ?? "", /选哪个/);
		assert.equal(ask?.urgency, "high");
	});
});

test("ask-style tool start is notified once even with the rpiv event", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("tool_execution_start", {
			toolName: "ask_user_question",
			toolCallId: "ask-tool-1",
			args: {
				questions: [{ header: "方案", question: "用哪个?", options: [{}, {}] }],
			},
		});
		pi.emitBus("rpiv:ask-user:prompt", {
			toolCallId: "ask-tool-1",
			questions: [{ header: "方案", question: "用哪个?", options: [{}, {}] }],
		});
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "ask").length, 1);
	});
});

test("generic UI prompts are notified but custom prompts are skipped", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("ui_prompt_start", { kind: "custom", title: "忽略" }, ctx);
		await pi.emit("ui_prompt_start", { kind: "confirm", title: "允许执行?" }, ctx);
		await tick();
		assert.equal(channel.sent.length, 1);
		assert.match(channel.sent[0]?.body ?? "", /允许执行/);
	});
});

test("todo result updates are coalesced and all-done is immediate", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("tool_execution_end", {
			toolName: "todo",
			isError: false,
			result: {
				details: {
					action: "update",
					params: { id: 1, status: "completed" },
					tasks: [{ id: 1, subject: "实现适配器", status: "completed" }],
				},
			},
		});
		await tick();
		const todo = channel.sent.find((item) => item.kind === "todo");
		assert.ok(todo);
		assert.match(todo?.title ?? "", /全部完成/);
	});
});

test("retry, recovery and final settle each notify once", async () => {
	await withRuntime({}, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("agent_start");
		await pi.emit("turn_start", { turnIndex: 0 });
		const failed = {
			role: "assistant",
			stopReason: "error",
			errorMessage: "socket hang up",
			content: [],
		};
		await pi.emit("message_end", { message: failed });
		await pi.emit("agent_end", { messages: [failed], willRetry: true });
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "retry").length, 1);

		await pi.emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "恢复了" }] },
		});
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "recovered").length, 1);

		await pi.emit("agent_settled", { aborted: false });
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "settled").length, 1);
	});
});

test("minDuration suppresses short completions but not errors", async () => {
	await withRuntime({ minDurationMs: 60_000 }, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", startup, ctx);
		await pi.emit("agent_start");
		await pi.emit("turn_start", { turnIndex: 0 });
		await pi.emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "quick" }] },
		});
		await pi.emit("agent_settled", { aborted: false });
		await tick();
		assert.equal(channel.sent.length, 0);

		await pi.emit("agent_start");
		const failed = {
			role: "assistant",
			stopReason: "error",
			errorMessage: "boom",
			content: [],
		};
		await pi.emit("message_end", { message: failed });
		await pi.emit("agent_end", { messages: [failed], willRetry: false });
		await pi.emit("agent_settled", { aborted: false });
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "error").length, 1);
	});
});

test("disabled config suppresses every notification", async () => {
	await withRuntime({ enabled: false }, async ({ channel, pi, ctx }) => {
		await pi.emit("session_start", { reason: "resume" }, ctx);
		await pi.emit("agent_start");
		await pi.emit("turn_start", { turnIndex: 0 });
		await pi.emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "hi" }] },
		});
		await pi.emit("agent_settled", { aborted: false });
		await tick();
		assert.equal(channel.sent.length, 0);
	});
});

test("/notice status and test commands run without a real channel", async () => {
	await withRuntime({}, async ({ channel, pi, dir }) => {
		const command = pi.commands.get("notice");
		assert.ok(command);
		const messages: string[] = [];
		const ctx = {
			cwd: dir,
			ui: { notify: (message: string) => messages.push(message) },
			hasUI: true,
		};
		await command?.handler("status", ctx);
		assert.ok(messages.some((message) => message.includes("pi-notice:")));
		await command?.handler("test", ctx);
		await tick();
		assert.equal(channel.sent.filter((item) => item.kind === "test").length, 1);
	});
});
