import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NoticeConfig } from "./types.ts";

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function resolveUserPath(path: string): string {
	const expanded = expandHome(path.trim());
	return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/** PNG shipped with the package (Linux/macOS notifications). */
export function bundledDesktopIcon(): string {
	return fileURLToPath(new URL("../assets/pi-notice.png", import.meta.url));
}

/** Multi-size ICO shipped with the package (Windows shortcut identity). */
export function bundledWindowsShortcutIcon(): string {
	return fileURLToPath(new URL("../assets/pi-notice.ico", import.meta.url));
}

/**
 * Icon passed to node-notifier/notify-send. A configured path wins; otherwise
 * the bundled transparent bell is used.
 */
export function desktopIconPath(config: NoticeConfig): string {
	const custom = config.desktop.icon?.trim();
	return custom ? resolveUserPath(custom) : bundledDesktopIcon();
}

/**
 * Windows only reads `.ico`/`.exe`/`.dll` from a shortcut's IconLocation, so a
 * custom `.png` cannot replace the AppUserModelID icon. Fall back to the
 * bundled ICO in that case.
 */
export function windowsShortcutIconPath(config: NoticeConfig): string {
	const custom = config.desktop.icon?.trim();
	if (custom && /\.ico$/i.test(custom)) {
		return resolveUserPath(custom);
	}
	return bundledWindowsShortcutIcon();
}
