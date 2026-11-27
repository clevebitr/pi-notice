import { loadConfig } from "../src/config.ts";
import { buildTestNotice, projectLabel } from "../src/format.ts";
import { setLocale, translate as t } from "../src/i18n.ts";
import { NoticeDispatcher } from "../src/notify.ts";

const { config, sources, warnings } = loadConfig(process.cwd());
// Keep the process-wide locale in sync with the config, like the extension does.
setLocale(config.locale);
const dispatcher = new NoticeDispatcher({ config });
const project = projectLabel(process.cwd(), process.env.PI_SESSION_NAME);
const notice = buildTestNotice(project, dispatcher.channelNames(), t);

console.log(
	t("demo.config", {
		sources: sources.length > 0 ? sources.join(", ") : t("cmd.status.defaultConfig"),
	}),
);
console.log(t("demo.channels", { channels: dispatcher.channelNames().join(", ") || t("common.none") }));
for (const warning of warnings) {
	console.warn(t("demo.warning", { message: warning }));
}

const results = await dispatcher.send(notice, { force: true });
for (const result of results) {
	console.log(`${result.ok ? "✓" : "✗"} ${result.name}${result.error ? `: ${result.error}` : ""}`);
}
if (results.length === 0) {
	console.error(t("demo.noNotice"));
	process.exitCode = 1;
}
