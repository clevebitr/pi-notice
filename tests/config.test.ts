import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG, isQuietHours, loadConfig, mergeConfig } from "../src/config.ts";

function withTempConfig(content: unknown | undefined, fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "pi-notice-config-"));
	const path = join(dir, "pi-notice.json");
	if (content !== undefined) {
		writeFileSync(path, JSON.stringify(content), "utf8");
	}
	const previous = process.env.PI_NOTICE_CONFIG;
	process.env.PI_NOTICE_CONFIG = path;
	try {
		fn(dir);
	} finally {
		if (previous === undefined) {
			delete process.env.PI_NOTICE_CONFIG;
		} else {
			process.env.PI_NOTICE_CONFIG = previous;
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

test("defaults are usable", () => {
	const { config, warnings } = loadConfig(process.cwd(), {});
	assert.equal(config.enabled, true);
	assert.deepEqual(config.channels, ["auto"]);
	assert.equal(config.events.settled, true);
	assert.equal(warnings.length, 0);
});

test("deep merge keeps nested defaults and replaces arrays", () => {
	const merged = mergeConfig(
		{ a: { b: 1, c: 2 }, list: [1, 2] },
		{ a: { c: 3 }, list: [9] },
	) as { a: { b: number; c: number }; list: number[] };
	assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [9] });
});

test("project config overrides the custom/global file", () => {
	withTempConfig({ summary: { maxReplyChars: 99 }, desktop: { sound: true } }, (dir) => {
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "pi-notice.json"),
			JSON.stringify({ desktop: { sound: false }, summary: { maxBodyChars: 300 } }),
			"utf8",
		);
		const { config, sources } = loadConfig(dir, process.env);
		assert.equal(config.summary.maxReplyChars, 99);
		assert.equal(config.summary.maxBodyChars, 300);
		assert.equal(config.desktop.sound, false);
		assert.equal(sources.length, 2);
	});
});

test("custom file overrides defaults", () => {
	withTempConfig({ desktop: { sound: false }, events: { todo: false } }, (dir) => {
		const { config, sources } = loadConfig(dir, process.env);
		assert.equal(config.desktop.sound, false);
		assert.equal(config.events.todo, false);
		assert.equal(config.events.settled, true);
		assert.equal(config.desktop.appId, DEFAULT_CONFIG.desktop.appId);
		assert.ok(sources.some((path) => path.endsWith("pi-notice.json")));
	});
});

test("env overrides channels, events and ntfy", () => {
	withTempConfig({}, (dir) => {
		const { config } = loadConfig(dir, {
			PI_NOTICE_CHANNELS: "desktop,ntfy",
			PI_NOTICE_EVENTS: "settled,ask",
			PI_NOTICE_NTFY_TOPIC: "pi-test",
			PI_NOTICE_QUIET_HOURS: "22:30-07:15",
		});
		assert.deepEqual(config.channels, ["desktop", "ntfy"]);
		assert.equal(config.events.settled, true);
		assert.equal(config.events.ask, true);
		assert.equal(config.events.todo, false);
		assert.equal(config.ntfy.topic, "pi-test");
		assert.equal(config.quietHours.enabled, true);
		assert.equal(config.quietHours.start, "22:30");
		assert.equal(config.quietHours.end, "07:15");
	});
});

test("event env supports +/- deltas", () => {
	withTempConfig({}, (dir) => {
		const { config } = loadConfig(dir, { PI_NOTICE_EVENTS: "+session,-todo" });
		assert.equal(config.events.session, true);
		assert.equal(config.events.todo, false);
		assert.equal(config.events.settled, true);
	});
});

test("malformed config is a warning, not a crash", () => {
	withTempConfig(undefined, (dir) => {
		const path = join(dir, "pi-notice.json");
		writeFileSync(path, "{not json", "utf8");
		const { config, warnings } = loadConfig(dir, process.env);
		assert.equal(config.enabled, true);
		assert.equal(warnings.length, 1);
	});
});

test("quiet hours handle same-day and overnight windows", () => {
	const config = structuredClone(DEFAULT_CONFIG);
	config.quietHours = { enabled: true, start: "09:00", end: "17:00", allowUrgent: true };
	assert.equal(isQuietHours(config, new Date(2024, 0, 1, 10, 0)), true);
	assert.equal(isQuietHours(config, new Date(2024, 0, 1, 18, 0)), false);

	config.quietHours = { enabled: true, start: "23:00", end: "08:00", allowUrgent: true };
	assert.equal(isQuietHours(config, new Date(2024, 0, 1, 23, 30)), true);
	assert.equal(isQuietHours(config, new Date(2024, 0, 1, 7, 59)), true);
	assert.equal(isQuietHours(config, new Date(2024, 0, 1, 12, 0)), false);
});
