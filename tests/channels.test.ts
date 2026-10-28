import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { resolveChannelNames } from "../src/channels/index.ts";
import { buildTermuxArgs } from "../src/channels/termux.ts";
import { createNtfyChannel } from "../src/channels/ntfy.ts";
import type { Notice, NoticeConfig } from "../src/types.ts";

function config(overrides: Partial<NoticeConfig> = {}): NoticeConfig {
	return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

const ask: Notice = {
	title: "Pi · demo · 需要你的回答",
	body: "选哪个?",
	urgency: "high",
	kind: "ask",
	tag: "ask",
};

test("termux args use core flags and high priority", () => {
	const args = buildTermuxArgs(config(), ask);
	assert.deepEqual(args.slice(0, 4), ["--title", ask.title, "--content", ask.body]);
	assert.equal(args[args.indexOf("--priority") + 1], "high");
	assert.equal(args[args.indexOf("--id") + 1], "pi-notice");
	assert.equal(args[args.indexOf("--group") + 1], "pi-notice");
	assert.ok(args.includes("--sound"));
	assert.equal(args[args.indexOf("--vibrate") + 1], "200");
});

test("termux priority can be pinned and optional flags removed", () => {
	const args = buildTermuxArgs(
		config({
			termux: {
				...DEFAULT_CONFIG.termux,
				priority: "max",
				sound: false,
				vibrate: false,
				group: "",
			},
		}),
		ask,
	);
	assert.equal(args[args.indexOf("--priority") + 1], "max");
	assert.equal(args.includes("--sound"), false);
	assert.equal(args.includes("--vibrate"), false);
	assert.equal(args.includes("--group"), false);
});

test("auto selects termux on Android and desktop elsewhere", () => {
	assert.deepEqual(resolveChannelNames(config(), {}).names, ["desktop"]);
	assert.deepEqual(resolveChannelNames(config(), { TERMUX_VERSION: "0.118" }).names, ["termux"]);
	assert.deepEqual(
		resolveChannelNames(config({ channels: ["auto", "desktop", "ntfy"] }), {}).names,
		["desktop", "ntfy"],
	);
});

test("unconfigured ntfy is reported as a warning", () => {
	const resolved = resolveChannelNames(config({ channels: ["desktop", "ntfy"] }), {});
	assert.ok(resolved.warnings.some((warning) => warning.includes("ntfy.topic")));
});

test("ntfy publishes JSON with title, body, priority and bearer token", async () => {
	let captured:
		| { url?: string; body?: Record<string, unknown>; authorization?: string; contentType?: string }
		| undefined;
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			captured = {
				url: request.url,
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
				authorization: request.headers.authorization,
				contentType: request.headers["content-type"],
			};
			response.writeHead(200);
			response.end("ok");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address() as AddressInfo;
		const channel = createNtfyChannel(
			config({
				ntfy: {
					...DEFAULT_CONFIG.ntfy,
					url: `http://127.0.0.1:${address.port}`,
					topic: "pi-test",
					token: "secret",
					tags: ["terminal"],
				},
			}),
		);
		await channel.send(ask);
		assert.ok(captured);
		assert.equal(captured?.url, "/");
		assert.equal(captured?.body?.topic, "pi-test");
		assert.equal(captured?.body?.title, ask.title);
		assert.equal(captured?.body?.message, ask.body);
		assert.equal(captured?.body?.priority, "high");
		assert.deepEqual(captured?.body?.tags, ["terminal", "ask"]);
		assert.equal(captured?.authorization, "Bearer secret");
		assert.equal(captured?.contentType, "application/json");
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
