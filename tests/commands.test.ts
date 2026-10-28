import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCommand } from "../src/commands.ts";
import { configFilePath, writeConfigPatch } from "../src/config.ts";

const ALL_EVENTS = ["settled", "ask", "todo", "errors", "retry", "session"].sort();

test("empty input opens the panel", () => {
	assert.deepEqual(parseCommand(""), { type: "panel" });
	assert.deepEqual(parseCommand("   "), { type: "panel" });
	assert.deepEqual(parseCommand("panel"), { type: "panel" });
});

test("bare on/off toggles the whole extension locally by default", () => {
	assert.deepEqual(parseCommand("off"), { type: "enabled", enabled: false, scope: "local" });
	assert.deepEqual(parseCommand("on"), { type: "enabled", enabled: true, scope: "local" });
	assert.deepEqual(parseCommand("--global off"), { type: "enabled", enabled: false, scope: "global" });
});

test("event lists accept commas, spaces, aliases and all", () => {
	assert.deepEqual(parseCommand("off todo,ask"), {
		type: "events",
		enabled: false,
		events: ["todo", "ask"],
		scope: "local",
	});
	assert.deepEqual(parseCommand("on 结束 提问"), {
		type: "events",
		enabled: true,
		events: ["settled", "ask"],
		scope: "local",
	});
	assert.equal(parseCommand("off --nope").type, "error");
	const every = parseCommand("off all");
	assert.equal(every.type, "events");
	assert.deepEqual(every.type === "events" ? [...every.events].sort() : [], ALL_EVENTS);
});

test("toggle without enabled flag and session scope", () => {
	assert.deepEqual(parseCommand("toggle todo --session"), {
		type: "events",
		events: ["todo"],
		enabled: undefined,
		scope: "session",
	});
	assert.equal(parseCommand("toggle").type, "error");
});

test("channels and reasons parse with aliases", () => {
	assert.deepEqual(parseCommand("channels auto,安卓"), {
		type: "channels",
		channels: ["auto", "termux"],
		scope: "local",
	});
	assert.deepEqual(parseCommand("channels desktop ntfy"), {
		type: "channels",
		channels: ["desktop", "ntfy"],
		scope: "local",
	});
	assert.deepEqual(parseCommand("channels"), { type: "list-channels" });
	assert.deepEqual(parseCommand("reasons resume,fork"), {
		type: "reasons",
		reasons: ["resume", "fork"],
		scope: "local",
	});
	assert.deepEqual(parseCommand("reasons"), { type: "list-reasons" });
});

test("unknown subcommands, events and flags return an error", () => {
	const unknownCommand = parseCommand("bogus");
	assert.equal(unknownCommand.type, "error");
	const unknownEvent = parseCommand("off nope");
	assert.equal(unknownEvent.type, "error");
	assert.equal(unknownEvent.type === "error" ? unknownEvent.code : "", "unknownEvent");
	assert.deepEqual(unknownEvent.type === "error" ? unknownEvent.vars : undefined, {
		names: "nope",
		available: "settled, ask, todo, errors, retry, session",
	});
	const unknownFlag = parseCommand("off --nope");
	assert.equal(unknownFlag.type === "error" ? unknownFlag.code : "", "unknownFlag");
});

test("status/test/reload/help are recognized", () => {
	assert.equal(parseCommand("status").type, "status");
	assert.equal(parseCommand("test").type, "test");
	assert.equal(parseCommand("reload").type, "reload");
	assert.equal(parseCommand("help").type, "help");
	assert.equal(parseCommand("events").type, "list-events");
});

test("configFilePath honors scope and PI_NOTICE_CONFIG", () => {
	const cwd = "/tmp/project";
	assert.equal(configFilePath(cwd, "local"), join(cwd, ".pi", "pi-notice.json"));
	const global = configFilePath(cwd, "global", { PI_NOTICE_CONFIG: "/tmp/custom.json" });
	assert.equal(global, "/tmp/custom.json");
	assert.match(configFilePath(cwd, "global", {}), /pi-notice\.json$/);
});

test("writeConfigPatch merges, preserves unknown keys and creates directories", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-notice-write-"));
	const path = join(dir, "nested", "pi-notice.json");
	try {
		writeConfigPatch(path, { events: { todo: false } });
		writeConfigPatch(path, { events: { ask: false }, enabled: false });
		const written = JSON.parse(readFileSync(path, "utf8"));
		assert.deepEqual(written, { events: { todo: false, ask: false }, enabled: false });

		writeFileSync(path, JSON.stringify({ custom: 1, events: { todo: true } }), "utf8");
		writeConfigPatch(path, { events: { todo: false } });
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
			custom: 1,
			events: { todo: false },
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
