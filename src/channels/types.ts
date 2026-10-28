import type { ChannelName, Notice, NoticeAction } from "../types.ts";

/**
 * Buttons on a notification. Only channels whose platform reports a click back
 * to this process implement this; everything else stays fire-and-forget.
 */
export interface ChannelActions {
	/** How many buttons the platform can show at once. */
	maxActions: number;
	/** Resolves with the chosen action id, or `undefined` when nothing was chosen. */
	send(notice: Notice, actions: NoticeAction[]): Promise<string | undefined>;
}

export interface Channel {
	name: ChannelName;
	send(notice: Notice): Promise<void>;
	/** Present only when the platform can report button presses in-process. */
	actions?: ChannelActions;
}

export interface ChannelResult {
	name: ChannelName;
	ok: boolean;
	error?: string;
}
