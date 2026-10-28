# Notification actions

Answer a pending `ask_user_question` straight from the notification, without
going back to the terminal. Shipped for the platforms whose notification system
reports the press back to this process; everywhere else the notification stays
read-only.

## Platform support

| Channel | Buttons | Callback path |
| --- | --- | --- |
| Windows (`SnoreToast`) | 3 | in-process named pipe: `action=buttonClicked;button=<label>;…` |
| macOS (`terminal-notifier`) | 3 | in-process: `-actions` + JSON activation value |
| Linux (`notify-send -A`) | 5 | in-process: the chosen action name on stdout |
| Termux | — | button actions run a shell command, no in-process callback → not supported |
| ntfy | — | `http` actions need a server listening on the phone's network → not supported |
| OSC | — | terminal escape sequences have no buttons → not supported |

### Windows requires a registered AppUserModelID

Windows only delivers toast button clicks to an application whose AUMID has a
Start Menu shortcut (with the SnoreToast toast-activator CLSID). SnoreToast can
write that itself:

```bash
snoretoast-x64.exe -install "Pi" "<path>/snoretoast-x64.exe" "Pi"
```

`src/channels/desktop.ts` does this automatically, once per `desktop.appId`,
when the shortcut at
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\<appId>.lnk` is missing. The
notification banner disappears after ~7 s (SnoreToast 0.7 has a fixed short
duration), but the pipe server stays open for `desktop.actionsTimeoutSeconds`, so
a click from the Action Center within that window still arrives.

## How an answer travels

`@juicesharp/rpiv-ask-user-question` publishes an **inbound** event, so an
external driver can answer a questionnaire that is already waiting:

```ts
pi.events.emit("rpiv:ask-user:answer", {
  toolCallId,                       // from rpiv:ask-user:prompt
  requestId: "notice:…",            // echoed back on the verdict
  answers: [{ questionIndex: 0, optionIndexes: [1] }],
});
```

Validation is strict and all-or-nothing: every question answered, every index in
range, no duplicates — otherwise nothing is applied and the dialog stays open.
Every attempt gets a verdict on `rpiv:ask-user:answer-result`
(`ok` / `not_found` / `invalid_payload` / `invalid_answer` / `unsupported_host`).
A refused answer produces one low-priority follow-up notification.

## Paging rules

1. **One notification per question.** Buttons are only offered when the
   questionnaire has exactly one question, so `questionIndex` is always 0.
2. **Body is complete, buttons are shortcuts.** The body lists options as
   `1. label`; the page it belongs to is shown as `options a-b of n · page i/k`.
3. **Page size = `maxActions - 1` while more options follow**, so the last
   button is always `更多 →` (More). Trailing pages use every available button.
4. **Single-select only.** Multi-select and free text cannot be expressed with
   toast buttons; those questions notify with "answer in the terminal".
5. **One tap, one verdict.** On `ok` stay silent; on rejection send one short
   notice. `not_found` usually means you already answered in the TUI.

## Implementation notes

- `Channel.actions` is optional: channels that cannot report clicks simply do
  not implement it, and `NoticeDispatcher.sendInteractive()` returns
  `unsupported`, which makes the caller fall back to a plain notification.
- Interactive notifications bypass the delivery chain on purpose: a toast can
  stay on screen for minutes and must not block later notifications.
- Windows toasts are spawned directly instead of through `node-notifier` so the
  pipe server can outlive the SnoreToast process (late Action Center clicks).
- Button labels are joined with `;` by SnoreToast, so labels are sanitized and
  mapped back case-insensitively to action ids.

## Possible follow-ups

- A dedicated `ui_prompt_start` confirm/select integration (currently only
  `ask_user_question` questionnaires get buttons).
- If Termux ever exposes an in-process callback, the same `Channel.actions`
  seam applies without touching the ask flow.
