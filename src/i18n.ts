import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Languages shipped in `locales/`. The order is the order shown in pickers. */
export const LOCALES = [
	{ code: "en", label: "English" },
	{ code: "zh-CN", label: "简体中文" },
	{ code: "zh-TW", label: "繁體中文" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: LocaleCode = "en";

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

type Catalog = Record<string, string>;

const LOCALE_ALIASES: Record<string, LocaleCode> = {
	en: "en",
	"en-us": "en",
	"en-gb": "en",
	"en-au": "en",
	"en-ca": "en",
	zh: "zh-CN",
	"zh-cn": "zh-CN",
	"zh-hans": "zh-CN",
	"zh-sg": "zh-CN",
	"zh-my": "zh-CN",
	"zh-tw": "zh-TW",
	"zh-hk": "zh-TW",
	"zh-mo": "zh-TW",
	"zh-hant": "zh-TW",
};

export function isLocaleCode(value: string): value is LocaleCode {
	return LOCALES.some((locale) => locale.code === value);
}

export function localeLabel(code: string): string {
	return LOCALES.find((locale) => locale.code === code)?.label ?? code;
}

/**
 * Map a BCP-47-ish tag (`zh_Hant_TW.UTF-8`, `en_US`, `zh-CN`) to a shipped
 * locale. Returns `undefined` when nothing matches.
 */
export function normalizeLocale(input: string | undefined): LocaleCode | undefined {
	if (!input) {
		return undefined;
	}
	const cleaned = input
		.trim()
		.replace(/\.(UTF-8|utf8)$/i, "")
		.replace(/_/g, "-")
		.toLowerCase();
	if (!cleaned) {
		return undefined;
	}
	const exact = LOCALE_ALIASES[cleaned];
	if (exact) {
		return exact;
	}
	const [language, ...rest] = cleaned.split("-");
	const parts = [language, ...rest];
	for (let length = parts.length; length > 0; length -= 1) {
		const candidate = LOCALE_ALIASES[parts.slice(0, length).join("-")];
		if (candidate) {
			return candidate;
		}
	}
	return language ? LOCALE_ALIASES[language] : undefined;
}

/**
 * Resolve the effective locale, first hit wins:
 * explicit config value (`auto` skips) → `PI_NOTICE_LOCALE` → `LC_ALL` →
 * `LC_MESSAGES` → `LANG` → English.
 */
export function resolveLocale(
	preferred?: string,
	env: NodeJS.ProcessEnv = process.env,
): LocaleCode {
	if (preferred && preferred.trim() && preferred.trim().toLowerCase() !== "auto") {
		return normalizeLocale(preferred) ?? DEFAULT_LOCALE;
	}
	for (const value of [env.PI_NOTICE_LOCALE, env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
		const match = normalizeLocale(value);
		if (match) {
			return match;
		}
	}
	return DEFAULT_LOCALE;
}

const catalogCache = new Map<string, Catalog>();
const ownCatalogCache = new Map<string, Catalog>();

function localesDir(): string {
	return fileURLToPath(new URL("../locales/", import.meta.url));
}

function readCatalog(code: string, dir = localesDir()): Catalog {
	const path = join(dir, `${code}.json`);
	if (!existsSync(path)) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		const catalog: Catalog = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") {
				catalog[key] = value;
			}
		}
		return catalog;
	} catch {
		// A broken translation must never break notifications.
		return {};
	}
}

/** Keys actually defined by one locale file (no English fallback). */
export function loadOwnCatalog(code: string, dir?: string): Catalog {
	const cacheKey = dir ? `${dir}:${code}` : code;
	const cached = ownCatalogCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const own = readCatalog(normalizeLocale(code) ?? DEFAULT_LOCALE, dir);
	ownCatalogCache.set(cacheKey, own);
	return own;
}

/** Loaded catalogs with per-key fallback to English. */
export function loadCatalog(code: string, dir?: string): Catalog {
	const cacheKey = dir ? `${dir}:${code}` : code;
	const cached = catalogCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const english = code === DEFAULT_LOCALE ? readCatalog(DEFAULT_LOCALE, dir) : loadCatalog(DEFAULT_LOCALE, dir);
	const catalog = code === DEFAULT_LOCALE ? english : { ...english, ...readCatalog(code, dir) };
	catalogCache.set(cacheKey, catalog);
	return catalog;
}

/** Test helper: drop cached catalogs so edited files are re-read. */
export function clearCatalogCache(): void {
	catalogCache.clear();
	ownCatalogCache.clear();
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
	if (!vars) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in vars ? String(vars[name]) : match,
	);
}

/** Build a translator for one locale. Missing keys fall back to English, then to the key. */
export function createTranslator(locale: string = DEFAULT_LOCALE): Translator {
	const code = normalizeLocale(locale) ?? DEFAULT_LOCALE;
	const catalog = loadCatalog(code);
	// Plural keys must come from the locale itself: English defines `.one`, and
	// inheriting it would render "1 turn" inside a Chinese sentence.
	const own = loadOwnCatalog(code);
	return (key, vars) => {
		const counted = typeof vars?.count === "number";
		const lookup = counted && vars?.count === 1 && `${key}.one` in own ? `${key}.one` : key;
		const template = catalog[lookup] ?? catalog[key];
		return template === undefined ? key : interpolate(template, vars);
	};
}

let currentLocale: LocaleCode = DEFAULT_LOCALE;
let currentTranslator: Translator = createTranslator(DEFAULT_LOCALE);

/** Switch the process-wide locale used by `translate()` and every default argument. */
export function setLocale(locale?: string, env?: NodeJS.ProcessEnv): LocaleCode {
	currentLocale = resolveLocale(locale, env ?? process.env);
	currentTranslator = createTranslator(currentLocale);
	return currentLocale;
}

export function getLocale(): LocaleCode {
	return currentLocale;
}

/** Translate with the process-wide locale. */
export function translate(key: string, vars?: Record<string, string | number>): string {
	return currentTranslator(key, vars);
}
