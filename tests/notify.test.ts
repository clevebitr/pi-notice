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

function interactiveChannel(outcome: "selected" | "dismissed" | "throws"): Channel & {
	sent: Notice[];
	seen: string[][];
} {
	const sent: Notice[] = [];
	const seen: string[][] = [];
	return {
		name: "desktop",
		sent,
		seen,
		async send(value) {
			sent.push(value);
		},
		actions: {
			maxActions: 3,
			async send(value, actions) {
				sent.push(value);
				seen.push(actions.map((action) => action.id));
				if (outcome === "throws") {
					throw new Error("no display");
				}
				return outcome === "selected" ? "ask-opt:1" : undefined;
			},
		},
	};
}

const actions = [
	{ id: "ask-opt:0", label: "1. A" },
	{ id: "ask-opt:1", label: "2. B" },
];

test("interactive sends are unsupported without an action-capable channel", async () => {
	const dispatcher = new NoticeDispatcher({
		config: config(),
		channels: [fakeChannel()],
		logger: { debug: () => {}, warn: () => {} },
	});
	assert.equal(dispatcher.interactiveChannel(), undefined);
	assert.deepEqual(await dispatcher.sendInteractive(notice("ask", "high"), actions), {
		status: "unsupported",
	});
});

test("interactive sends report selected, dismissed and failed outcomes", async () => {
	const selected = new NoticeDispatcher({
		config: config(),
		channels: [interactiveChannel("selected")],
		logger: { debug: () => {}, warn: () => {} },
	});
	const chosen = await selected.sendInteractive(notice("ask", "high"), actions);
	assert.deepEqual(chosen, { status: "selected", actionId: "ask-opt:1", channel: "desktop" });

	const dismissed = new NoticeDispatcher({
		config: config(),
		channels: [interactiveChannel("dismissed")],
		logger: { debug: () => {}, warn: () => {} },
	});
	assert.deepEqual(await dismissed.sendInteractive(notice("ask", "high"), actions), {
		status: "dismissed",
	});

	const failed = new NoticeDispatcher({
		config: config(),
		channels: [interactiveChannel("throws")],
		logger: { debug: () => {}, warn: () => {} },
	});
	const outcome = await failed.sendInteractive(notice("ask", "high"), actions);
	assert.equal(outcome.status, "failed");
});

test("interactive sends respect the master switch and quiet hours", async () => {
	const channel = interactiveChannel("selected");
	const dispatcher = new NoticeDispatcher({
		config: config({ enabled: false }),
		channels: [channel],
		logger: { debug: () => {}, warn: () => {} },
	});
	assert.deepEqual(await dispatcher.sendInteractive(notice("ask", "high"), actions), {
		status: "unsupported",
	});
	assert.equal(channel.seen.length, 0);

	const quiet = new NoticeDispatcher({
		config: config({
			quietHours: { ...DEFAULT_CONFIG.quietHours, enabled: true, start: "00:00", end: "23:59", allowUrgent: false },
		}),
		channels: [interactiveChannel("selected")],
		logger: { debug: () => {}, warn: () => {} },
	});
	assert.deepEqual(await quiet.sendInteractive(notice("ask", "high"), actions), {
		status: "unsupported",
	});
});
