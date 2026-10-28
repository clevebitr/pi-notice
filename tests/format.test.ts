import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
	buildAskNotice,
	buildSettledNotice,
	buildTodoNotice,
	formatDuration,
	parseTodoSnapshot,
	stripMarkdown,
	summarizeReply,
	truncate,
} from "../src/format.ts";
import type { NoticeConfig } from "../src/types.ts";
import { setLocale } from "../src/i18n.ts";

// Notification texts are asserted in Simplified Chinese.
setLocale("zh-CN");

function config(overrides: Partial<NoticeConfig> = {}): NoticeConfig {
	return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

test("stripMarkdown removes code, links and emphasis", () => {
	const input = "# 标题\n\n已完成 **核心** 功能，见 [文档](https://example.com)。\n\n```ts\nconst x = 1;\n```\n\n- 第一项";
	const output = stripMarkdown(input);
	assert.equal(output.includes("```"), false);
	assert.equal(output.includes("核心"), true);
	assert.equal(output.includes("文档"), true);
	assert.equal(output.includes("https://"), false);
	assert.equal(output.includes("[代码]"), true);
});

test("summarizeReply truncates by code points", () => {
	assert.equal(summarizeReply("😀😀😀😀", 3), "😀😀…");
	assert.equal(truncate("abc", 0), "");
	assert.equal(formatDuration(800), "<1s");
	assert.equal(formatDuration(1500), "1.5s");
	assert.equal(formatDuration(12_400), "12s");
	assert.equal(formatDuration(65_000), "1m 5s");
});

test("settled notification has status, duration, reply and todo progress", () => {
	const todo = parseTodoSnapshot({
		action: "update",
		params: { id: 2, status: "in_progress" },
		tasks: [
			{ id: 1, subject: "接口", status: "completed" },
			{ id: 2, subject: "测试", activeForm: "写测试", status: "in_progress" },
			{ id: 3, subject: "文档", status: "pending" },
		],
	});
	assert.ok(todo);
	const notice = buildSettledNotice(
		{
			project: "pi-notice",
			status: "completed",
			durationMs: 12_400,
			turns: 4,
			reply: "已实现 **通知适配器**，补了测试。",
			todo,
		},
		config(),
	);
	assert.equal(notice.title, "Pi · pi-notice · 完成");
	assert.match(notice.body, /12s · 4 轮/);
	assert.match(notice.body, /通知适配器/);
	assert.match(notice.body, /Todo 1\/3 完成 · 进行中: 写测试/);
	assert.equal(notice.urgency, "normal");
});

test("error notification is urgent and includes the error", () => {
	const notice = buildSettledNotice(
		{
			project: "demo",
			status: "error",
			durationMs: 3000,
			turns: 1,
			error: "connection reset by peer",
		},
		config(),
	);
	assert.equal(notice.title, "Pi · demo · 出错");
	assert.match(notice.body, /connection reset/);
	assert.equal(notice.urgency, "high");
});

test("todo parsing ignores deleted tasks and computes allDone", () => {
	const snapshot = parseTodoSnapshot({
		action: "update",
		params: { id: 1, status: "completed" },
		tasks: [
			{ id: 1, subject: "A", status: "completed" },
			{ id: 2, subject: "B", status: "deleted" },
		],
	});
	assert.ok(snapshot);
	assert.equal(snapshot.total, 1);
	assert.equal(snapshot.completed, 1);
	assert.equal(snapshot.allDone, true);
	assert.equal(snapshot.change, "完成: #1 A");
});

test("todo clear produces a clear notice", () => {
	const snapshot = parseTodoSnapshot({ action: "clear", params: {}, tasks: [] });
	assert.ok(snapshot);
	const notice = buildTodoNotice(snapshot, config(), "demo");
	assert.equal(notice.title, "Pi · demo · Todo 已清空");
});

test("ask notice includes header, question and option count", () => {
	const notice = buildAskNotice(
		"demo",
		[
			{ question: "选哪个方案?", header: "方案", options: [{}, {}] },
			{ question: "是否继续?", header: "继续", options: [{}] },
		],
		config(),
	);
	assert.equal(notice.title, "Pi · demo · 需要你的回答");
	assert.match(notice.body, /方案: 选哪个方案\?/);
	assert.match(notice.body, /共 2 个问题 · 3 个选项/);
	assert.equal(notice.urgency, "high");
});

test("summary body respects maxBodyChars", () => {
	const notice = buildSettledNotice(
		{
			project: "demo",
			status: "completed",
			durationMs: 1000,
			turns: 1,
			reply: "x".repeat(500),
		},
		config({ summary: { ...DEFAULT_CONFIG.summary, maxBodyChars: 80 } }),
	);
	assert.ok(notice.body.length <= 80);
});
