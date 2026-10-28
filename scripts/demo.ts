import { loadConfig } from "../src/config.ts";
import { buildTestNotice, projectLabel } from "../src/format.ts";
import { NoticeDispatcher } from "../src/notify.ts";

const { config, sources, warnings } = loadConfig(process.cwd());
const dispatcher = new NoticeDispatcher({ config });
const project = projectLabel(process.cwd(), process.env.PI_SESSION_NAME);
const notice = buildTestNotice(project, dispatcher.channelNames());

console.log(`pi-notice 配置: ${sources.length > 0 ? sources.join(", ") : "默认值"}`);
console.log(`通道: ${dispatcher.channelNames().join(", ") || "无"}`);
for (const warning of warnings) {
	console.warn(`注意: ${warning}`);
}

const results = await dispatcher.send(notice, { force: true });
for (const result of results) {
	console.log(`${result.ok ? "✓" : "✗"} ${result.name}${result.error ? `: ${result.error}` : ""}`);
}
if (results.length === 0) {
	console.error("没有发送任何通知；请检查配置中的 channels。");
	process.exitCode = 1;
}
