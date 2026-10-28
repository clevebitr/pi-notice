import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_LOCALE,
	LOCALES,
	clearCatalogCache,
	createTranslator,
	getLocale,
	loadCatalog,
	localeLabel,
	normalizeLocale,
	resolveLocale,
	setLocale,
	translate,
} from "../src/i18n.ts";

const localesDir = fileURLToPath(new URL("../locales/", import.meta.url));

test("locale tags normalize to shipped locales", () => {
	assert.equal(normalizeLocale("zh_CN.UTF-8"), "zh-CN");
	assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
	assert.equal(normalizeLocale("zh"), "zh-CN");
	assert.equal(normalizeLocale("zh-Hant-TW"), "zh-TW");
	assert.equal(normalizeLocale("zh_HK"), "zh-TW");
	assert.equal(normalizeLocale("en_US"), "en");
	assert.equal(normalizeLocale("fr-FR"), undefined);
	assert.equal(normalizeLocale("config"), undefined);
	assert.equal(normalizeLocale(""), undefined);
});

test("resolveLocale prefers config, then env, then English", () => {
	assert.equal(resolveLocale("zh-TW", { LANG: "en_US.UTF-8" }), "zh-TW");
	assert.equal(resolveLocale("auto", { LANG: "zh_CN.UTF-8" }), "zh-CN");
	assert.equal(resolveLocale(undefined, { PI_NOTICE_LOCALE: "zh-TW", LANG: "en_US" }), "zh-TW");
	assert.equal(resolveLocale(undefined, { LC_ALL: "zh_CN.UTF-8", LANG: "en_US" }), "zh-CN");
	assert.equal(resolveLocale(undefined, { LANG: "zh_TW.UTF-8" }), "zh-TW");
	assert.equal(resolveLocale(undefined, { LANG: "C" }), DEFAULT_LOCALE);
	assert.equal(resolveLocale(undefined, {}), DEFAULT_LOCALE);
	// An unknown explicit value must not silently fall back to the environment.
	assert.equal(resolveLocale("fr", { LANG: "zh_CN.UTF-8" }), "en");
});

test("translator interpolates and falls back to English", () => {
	const zh = createTranslator("zh-CN");
	assert.equal(zh("notice.status.completed"), "完成");
	// English has a `.one` plural; Chinese must not inherit it.
	assert.equal(zh("notice.meta.turns", { count: 1 }), "1 轮");
	assert.equal(zh("notice.meta.turns", { count: 3 }), "3 轮");
	assert.equal(zh("does.not.exist"), "does.not.exist");

	const en = createTranslator("en");
	assert.equal(en("notice.meta.turns", { count: 1 }), "1 turn");
	assert.equal(en("notice.meta.turns", { count: 2 }), "2 turns");
	assert.equal(createTranslator("zh-TW")("notice.meta.turns", { count: 1 }), "1 輪");
	// Placeholders without a supplied value stay visible instead of becoming "undefined".
	assert.equal(en("notice.retry.title"), "Retrying ({attempt})");
});

test("catalogs keep key and placeholder parity with English", () => {
	const english = JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")) as Record<string, string>;
	const placeholders = (value: string): string[] =>
		[...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();

	const files = readdirSync(localesDir).filter((name) => name.endsWith(".json"));
	assert.deepEqual(files.sort(), LOCALES.map((locale) => `${locale.code}.json`).sort());

	for (const locale of LOCALES) {
		const catalog = JSON.parse(
			readFileSync(join(localesDir, `${locale.code}.json`), "utf8"),
		) as Record<string, string>;
		const expected = Object.keys(english).filter((key) => !key.endsWith(".one"));
		const missing = expected.filter((key) => !(key in catalog));
		const extra = Object.keys(catalog).filter((key) => !(key in english));
		assert.deepEqual(missing, [], `${locale.code} is missing keys`);
		assert.deepEqual(extra, [], `${locale.code} has keys English does not`);
		for (const key of Object.keys(catalog)) {
			assert.deepEqual(
				placeholders(catalog[key]!),
				placeholders(english[key]!),
				`${locale.code}:${key} placeholders differ`,
			);
		}
	}
});

test("loadCatalog caches per locale and label lookup works", () => {
	clearCatalogCache();
	const first = loadCatalog("zh-TW");
	const second = loadCatalog("zh-TW");
	assert.equal(first, second);
	assert.equal(first["notice.status.completed"], "完成");
	assert.equal(localeLabel("zh-TW"), "繁體中文");
	assert.equal(localeLabel("xx"), "xx");
});

test("setLocale switches the process-wide translator", () => {
	try {
		assert.equal(setLocale("zh-TW"), "zh-TW");
		assert.equal(getLocale(), "zh-TW");
		assert.equal(translate("notice.status.aborted"), "已中止");
		assert.equal(setLocale("auto", { LANG: "zh_CN.UTF-8" }), "zh-CN");
		assert.equal(translate("notice.status.aborted"), "已中止");
		assert.equal(setLocale("en"), "en");
		assert.equal(translate("notice.status.aborted"), "aborted");
	} finally {
		setLocale("en");
	}
});
