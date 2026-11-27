# pi-notice

**English** | [简体中文](./README.zh-CN.md)

A Pi notification extension. It sends a compact system notification when a turn
finishes, Pi awaits an answer or confirmation, todo progress changes, the model
reports an error or retries, or a session reconnects.

## Platforms

| Platform | Notification | Requirement |
| --- | --- | --- |
| Windows | Native toast | None |
| macOS | Notification Center | None |
| Linux | `notify-send` | `libnotify` |
| Android | Termux notification | Termux:API and `termux-api` |
| iOS / remote | ntfy push (optional) | ntfy application and topic |

`channels: ["auto"]` selects the native channel: `termux` on Android Termux,
`desktop` on all other platforms.

## Installation

```bash
cd /path/to/pi-notice
npm install
pi install /path/to/pi-notice
```

Run without installation:

```bash
pi -e /path/to/pi-notice/extensions/pi-notice.ts
```

## Usage

The `/notice` command opens the settings panel in the TUI. Navigation follows
the standard settings-list controls: arrow keys move, typing searches, Enter or
Space toggles, and Esc closes the panel. Each change is written immediately and
takes effect without restarting Pi.

Subcommands provide equivalent control:

```text
/notice                     open the settings panel (prints status outside the TUI)
/notice status              print a status summary
/notice events              list every event switch
/notice on | off            enable or disable all notifications
/notice on settled todo     enable only the specified events
/notice off ask,retry       disable the specified events
/notice toggle todo         toggle the specified events
/notice channels            show the active channels
/notice channels auto,ntfy  set the channels
/notice reasons resume,new  select which session events count as reconnection
/notice locale zh-TW        switch language (en, zh-CN, zh-TW)
/notice test                send a test notification
/notice reload              re-read the configuration files
/notice help                full usage
```

Event names accept English and Chinese aliases: `settled`, `ask`, `todo`,
`errors`, `retry`, `session`, and `all`. The panel writes to
`<project>/.pi/pi-notice.json`; use `/notice ... --global` to write the
user-level configuration.

### Write targets

| Flag | Destination |
| --- | --- |
| default or `--local` | `<project>/.pi/pi-notice.json` |
| `--global` | `~/.pi/agent/pi-notice.json`, or `PI_NOTICE_CONFIG` when set |
| `--session` or `--temp` | memory only; current run only |

Writes are deep merges. Only the modified keys are changed; all other
configuration is preserved. Changes apply immediately.

When events are disabled or notifications are off, the TUI footer displays
`🔔 notifications -todo` or `🔕 notifications off`. The footer remains empty at
default settings.

## Configuration

Files are read and merged in the following order:

1. `~/.pi/agent/pi-notice.json`
2. `<project>/.pi/pi-notice.json`
3. Environment variables (`PI_NOTICE_*`, highest priority); `/notice status`
   lists the variables currently in effect

Language resolution follows the same order: `locale` (skipped when `"auto"`) →
`PI_NOTICE_LOCALE` → `LC_ALL` or `LC_MESSAGES` → `LANG` → English.
`zh_CN.UTF-8`, `zh-Hans`, and `zh` map to Simplified Chinese; `zh_TW`,
`zh-HK`, and `zh-Hant` map to Traditional Chinese.

```json
{ "locale": "zh-CN" }
```

Minimal configuration:

```json
{
  "channels": ["auto"],
  "events": {
    "settled": true,
    "ask": true,
    "todo": true,
    "errors": true,
    "retry": true,
    "session": true
  }
}
```

Event switches:

| Key | Notification trigger | Subcommand |
| --- | --- | --- |
| `settled` | a turn finishes | `/notice off settled` |
| `ask` | awaiting an answer or confirmation | `/notice off ask` |
| `todo` | todo progress changes | `/notice off todo` |
| `errors` | the model reports an error | `/notice off errors` |
| `retry` | automatic retry and recovery | `/notice off retry` |
| `session` | a session reconnects | `/notice off session` |

`askActions` (default `true`) controls whether ask options become notification
buttons and is not an event switch.

Master switch: `{"enabled": false}` or `/notice off`.

## Answering from a notification (Windows, macOS, Linux)

When the model asks a single-select question through `ask_user_question`, the
notification includes option buttons. Selecting a button is equivalent to
answering in the terminal.

| Platform | Buttons | Result delivery |
| --- | --- | --- |
| Windows | 3 | SnoreToast buttons; clicks return to the Pi process over a named pipe |
| macOS | 3 | terminal-notifier `actions` |
| Linux | 5 | `notify-send -A` (requires libnotify 0.7.9 or later) |
| Termux, ntfy, OSC | Not supported | plain notification with numbered options |

- One notification represents one question. When options exceed the button
  limit, they are paginated; the final button is "More →" and the body shows
  "page 1/2".
- The body always lists the numbered options, so the choices remain readable on
  platforms without buttons.
- Multi-select questions and multi-question prompts do not receive buttons; the
  notification instructs the user to answer in the terminal.
- A button press emits the ask extension's `rpiv:ask-user:answer` event. A
  rejected answer produces one follow-up "answer not applied" notification.
- Buttons can be disabled with `{"askActions": false}`,
  `PI_NOTICE_ASK_ACTIONS=0`, or the panel row "Ask · answer from notification".
- **Windows creates a Start Menu shortcut on first use** at
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\<desktop.appId>.lnk`
  (default `Pi.lnk`). Windows routes notification-button clicks only to
  applications with a registered AppID. Delete the shortcut and disable
  `askActions` to opt out.
- SnoreToast 0.7 banners disappear after approximately seven seconds. Clicks on
  the banner are verified. Delayed clicks from Action Center use the same pipe
  but are not verified end to end; clicking while the banner is visible is
  recommended.

## Notification icon

The default icon is an amber bell with a transparent background, based on
Lucide's `bell-ring` (ISC license). It does not use the Pi logo and is therefore
redistributable with the package. Assets are located in [`assets/`](./assets).

- **Desktop**: uses `assets/pi-notice.png` by default. On Windows,
  `assets/pi-notice.ico` is also used as the Start Menu shortcut icon, which is
  the toast's application identity. Override with
  `{"desktop": {"icon": "C:/path/icon.png"}}`. Windows requires an `.ico` file
  to change the application identity; a `.png` falls back to the bundled ICO.
  macOS sets the icon through terminal-notifier's `-appIcon`; terminal-notifier
  limitations may still display a small Terminal icon. If Windows continues to
  display the previous icon, restart Explorer to refresh the icon cache.
- **Termux**: uses an Android drawable name, `notifications` by default.
  Override with `{"termux": {"icon": "notifications_active"}}`; an empty string
  omits `--icon`.
- **ntfy**: `{"ntfy": {"icon": "https://example.com/icon.png"}}` is sent as the
  `X-Icon` header. Only PNG and JPEG URLs are supported.
- **OSC**: the terminal protocol has no icon slot; not supported.

The icon is based on Lucide. Retain
[`assets/LICENSE-lucide.txt`](./assets/LICENSE-lucide.txt) when redistributing.
Use of the official Pi logo requires prior written permission from Earendil; see
the [brand guidelines](https://github.com/earendil-works/elanor/blob/main/packages/logos/guidelines/template.md).

## Localization

Interface text, notification bodies, `/notice` output, configuration warnings,
channel errors, and runtime logs are stored in the JSON files under
[`locales/`](./locales). English, Simplified Chinese, and Traditional Chinese
are currently available. Missing keys fall back to English and do not interrupt
notification delivery.

- To add a language, follow [`locales/README.md`](./locales/README.md).
- Browser-based translation is supported through
  [Weblate](https://weblate.org/); see
  [`docs/localization.md`](./docs/localization.md). The landing page source is
  [`docs/index.html`](./docs/index.html) and is published to Pages by GitHub
  Actions.
- Run `npm run check:locales` to print the coverage table and verify key and
  placeholder parity.

Channels:

| Value | Description |
| --- | --- |
| `auto` | select the native channel for the current machine |
| `desktop` | Windows, macOS, Linux |
| `termux` | Android Termux |
| `ntfy` | remote push, usable on iOS |

Full configuration: [`pi-notice.example.json`](./pi-notice.example.json).

## Android

Install the Termux:API application, then run the following in Termux:

```bash
pkg install termux-api
termux-notification --title "Pi" --content "test"
```

## iOS and remote push

Install the ntfy application on iOS, subscribe to a topic, then configure:

```json
{
  "channels": ["auto", "ntfy"],
  "ntfy": {
    "topic": "your-topic"
  }
}
```

Run `/notice test` to verify delivery.

## Notes

- The notification body contains the project name, status, duration, last reply
  excerpt, and todo progress. All fields are truncated automatically.
- Code blocks and tables in a reply are not copied verbatim. Code becomes
  `[code]`; tables become `[table R×C]`. This prevents layout syntax from
  consuming the excerpt budget. The body still obeys `summary.maxReplyChars`
  and `maxBodyChars`.
- Quiet hours, minimum notification duration, and de-duplication are supported.
  See `pi-notice.example.json` for the available keys.
