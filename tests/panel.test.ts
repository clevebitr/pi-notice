import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createTranslator } from "../src/i18n.ts";
import { applyPanelItem, buildPanelItems } from "../src/panel.ts";
import type { NoticeConfig } from "../src/types.ts";

const t = createTranslator("en");

function config(overrides: Partial<NoticeConfig> = {}): NoticeConfig {
	return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

test("panel lists master switch, events, channels, language and reasons", () => {
	const items = buildPanelItems(config(), t);
	const ids = items.map((item) => item.id);
	assert.equal(new Set(ids).size, ids.length, "ids are unique");
	assert.deepEqual(ids.slice(0, 7), [
		"enabled",
		"event:settled",
		"event:ask",
		"event:todo",
		"event:errors",
		"event:retry",
		"event:session",
	]);
	assert.ok(ids.includes("channel:auto"));
	assert.ok(ids.includes("channel:ntfy"));
	assert.ok(ids.includes("locale"));
	assert.ok(ids.includes("reason:resume"));
	assert.equal(items.find((item) => item.id === "enabled")?.currentValue, "On");
	assert.equal(items.find((item) => item.id === "event:todo")?.currentValue, "On");
	assert.equal(items.find((item) => item.id === "locale")?.currentValue, "English");
});

test("panel reflects disabled events, channels and reasons", () => {
	const items = buildPanelItems(
		config({
			enabled: false,
			events: { ...DEFAULT_CONFIG.events, todo: false },
			channels: ["ntfy"],
			sessionReasons: ["new"],
			locale: "zh-CN",
		}),
		t,
	);
	const value = (id: string) => items.find((item) => item.id === id)?.currentValue;
	assert.equal(value("enabled"), "Off");
	assert.equal(value("event:todo"), "Off");
	assert.equal(value("channel:auto"), "Off");
	assert.equal(value("channel:ntfy"), "On");
	assert.equal(value("reason:resume"), "Off");
	assert.equal(value("reason:new"), "On");
	assert.equal(value("locale"), "简体中文");
});

test("toggling rows produces config patches", () => {
	const base = config();
	assert.deepEqual(applyPanelItem("enabled", "Off", base, t), { enabled: false });
	assert.deepEqual(applyPanelItem("event:todo", "Off", base, t), { events: { todo: false } });
	assert.deepEqual(applyPanelItem("event:todo", "On", base, t), { events: { todo: true } });
	assert.deepEqual(applyPanelItem("locale", "繁體中文", base, t), { locale: "zh-TW" });
	assert.deepEqual(applyPanelItem("locale", "zh-CN", base, t), { locale: "zh-CN" });
	assert.deepEqual(applyPanelItem("reason:resume", "Off", base, t), { sessionReasons: [] });
	assert.deepEqual(applyPanelItem("reason:new", "On", base, t), { sessionReasons: ["new", "resume"] });
	assert.equal(applyPanelItem("locale", "Klingon", base, t), undefined);
	assert.equal(applyPanelItem("event:nope", "Off", base, t), undefined);
	assert.equal(applyPanelItem("reason:nope", "Off", base, t), undefined);
	assert.equal(applyPanelItem("unknown", "Off", base, t), undefined);
});

test("channel toggles keep the list ordered and never empty", () => {
	const base = config();
	assert.deepEqual(applyPanelItem("channel:ntfy", "On", base, t), { channels: ["auto", "ntfy"] });
	assert.deepEqual(applyPanelItem("channel:auto", "Off", base, t), { channels: ["auto"] });
	assert.deepEqual(
		applyPanelItem("channel:desktop", "On", config({ channels: ["ntfy"] }), t),
		{ channels: ["desktop", "ntfy"] },
	);
	assert.deepEqual(
		applyPanelItem("channel:auto", "On", config({ channels: ["ntfy"] }), t),
		{ channels: ["auto", "ntfy"] },
	);
});

test("panel labels localize", () => {
	const zh = createTranslator("zh-TW");
	const items = buildPanelItems(config({ locale: "zh-TW" }), zh);
	assert.equal(items[0]?.label, "通知總開關");
	assert.equal(items[1]?.label, "事件 · 一輪對話結束");
	assert.equal(items[0]?.values?.join("/"), "開/關");
	assert.equal(applyPanelItem("enabled", "關", config(), zh)?.enabled, false);
});
