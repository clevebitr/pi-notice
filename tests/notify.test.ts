import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { NoticeDispatcher } from "../src/notify.ts";
import type { Channel } from "../src/channels/types.ts";
import type { Notice, NoticeConfig } from "../src/types.ts";

function config(overrides: Partial<NoticeConfig> = {}): NoticeConfig {
	return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

function notice(kind: Notice["kind"] = "test", urgency: Notice["urgency"] = "normal"): Notice {
	return { title: "Pi · test", body: "hello", urgency, kind, tag: kind };
}

function fakeChannel(fail = false): Channel & { sent: Notice[] } {
	const sent: Notice[] = [];
	return {
		name: "desktop",
		sent,
		async send(value) {
			if (fail) {
				throw new Error("boom");
			}
			sent.push(value);
		},
	};
}

function timeAt(offsetMinutes: number): string {
	const date = new Date(Date.now() + offsetMinutes * 60_000);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

test("delivers to injected channels and reports results", async () => {
	const channel = fakeChannel();
	const dispatcher = new NoticeDispatcher({ config: config(), channels: [channel] });
	const results = await dispatcher.send(notice());
	assert.deepEqual(results, [{ name: "desktop", ok: true }]);
	assert.equal(channel.sent.length, 1);
});

test("deduplicates the same key inside the window", async () => {
	const channel = fakeChannel();
	const dispatcher = new NoticeDispatcher({
		config: config({ dedupeWindowMs: 10_000 }),
		channels: [channel],
	});
	await dispatcher.send(notice("todo"), { key: "todo:1" });
	await dispatcher.send(notice("todo"), { key: "todo:1" });
	assert.equal(channel.sent.length, 1);
});

test("force bypasses quiet hours and dedupe", async () => {
	const channel = fakeChannel();
	const dispatcher = new NoticeDispatcher({
		config: config({
			quietHours: { enabled: true, start: timeAt(-2), end: timeAt(2), allowUrgent: true },
		}),
		channels: [channel],
	});
	await dispatcher.send(notice("settled", "normal"), { key: "settled:1" });
	assert.equal(channel.sent.length, 0);
	await dispatcher.send(notice("settled", "normal"), { key: "settled:1", force: true });
	assert.equal(channel.sent.length, 1);
});

test("quiet hours allow urgent notifications when configured", async () => {
	const channel = fakeChannel();
	const dispatcher = new NoticeDispatcher({
		config: config({
			quietHours: { enabled: true, start: timeAt(-2), end: timeAt(2), allowUrgent: true },
		}),
		channels: [channel],
	});
	await dispatcher.send(notice("ask", "high"), { key: "ask:1" });
	assert.equal(channel.sent.length, 1);

	const strict = fakeChannel();
	const strictDispatcher = new NoticeDispatcher({
		config: config({
			quietHours: { enabled: true, start: timeAt(-2), end: timeAt(2), allowUrgent: false },
		}),
		channels: [strict],
	});
	await strictDispatcher.send(notice("ask", "high"), { key: "ask:2" });
	assert.equal(strict.sent.length, 0);
});

test("failed channels are logged, not thrown", async () => {
	const warnings: string[] = [];
	const dispatcher = new NoticeDispatcher({
		config: config(),
		channels: [fakeChannel(true)],
		logger: { debug: () => {}, warn: (...args) => warnings.push(args.join(" ")) },
	});
	const results = await dispatcher.send(notice());
	assert.equal(results[0]?.ok, false);
	assert.equal(results[0]?.error, "boom");
	assert.ok(warnings.some((line) => line.includes("desktop 发送失败")));
});
