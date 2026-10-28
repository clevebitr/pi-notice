import type { ChannelName, Notice } from "../types.ts";

export interface Channel {
	name: ChannelName;
	send(notice: Notice): Promise<void>;
}

export interface ChannelResult {
	name: ChannelName;
	ok: boolean;
	error?: string;
}
