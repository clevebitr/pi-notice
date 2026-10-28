import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const localesDir = fileURLToPath(new URL("../locales/", import.meta.url));
const BASE = "en";

type Catalog = Record<string, string>;

function read(code: string): Catalog {
	return JSON.parse(readFileSync(join(localesDir, `${code}.json`), "utf8")) as Catalog;
}

function placeholders(value: string): string[] {
	return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

const base = read(BASE);
const baseKeys = Object.keys(base).filter((key) => !key.endsWith(".one"));
const files = readdirSync(localesDir)
	.filter((name) => name.endsWith(".json"))
	.map((name) => name.replace(/\.json$/, ""))
	.sort();

let failed = false;
const rows: string[] = [];

for (const code of files) {
	const catalog = read(code);
	const missing = baseKeys.filter((key) => !(key in catalog));
	const extra = Object.keys(catalog).filter((key) => !(key in base));
	const placeholderMismatch = Object.keys(catalog).filter((key) => {
		const reference = base[key];
		return reference !== undefined && placeholders(reference).join() !== placeholders(catalog[key]!).join();
	});
	const translated = baseKeys.filter((key) => key in catalog).length;
	const percent = Math.round((translated / baseKeys.length) * 100);

	rows.push(
		`${code.padEnd(6)} ${String(translated).padStart(3)}/${baseKeys.length} (${String(percent).padStart(3)}%)` +
			(missing.length ? `  missing ${missing.length}` : "") +
			(extra.length ? `  extra ${extra.length}` : ""),
	);

	if (missing.length > 0 || extra.length > 0 || placeholderMismatch.length > 0) {
		failed = true;
		console.error(`\n${code} problems:`);
		if (missing.length) console.error(`  missing keys: ${missing.join(", ")}`);
		if (extra.length) console.error(`  unknown keys: ${extra.join(", ")}`);
		if (placeholderMismatch.length) console.error(`  placeholder mismatch: ${placeholderMismatch.join(", ")}`);
	}
}

console.log(`Base language: ${BASE} (${baseKeys.length} keys, keys ending in .one are optional plurals)`);
console.log(rows.join("\n"));

if (failed) {
	console.error("\nLocale check failed. See locales/README.md.");
	process.exit(1);
}
console.log("\nLocale check passed.");
