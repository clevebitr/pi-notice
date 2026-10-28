# Notification actions (design, not shipped yet)

Goal: answer a pending `ask_user_question` straight from the notification,
without going back to the terminal.

## What makes it possible

`@juicesharp/rpiv-ask-user-question` publishes an **inbound** event, so an
external driver can answer a questionnaire that is already waiting:

```ts
// answer
pi.events.emit("rpiv:ask-user:answer", {
  toolCallId,                       // from rpiv:ask-user:prompt
  requestId: "notice:42",           // echoed back on the verdict
  answers: [{ questionIndex: 0, optionIndexes: [1] }],
});

// verdict
pi.events.on("rpiv:ask-user:answer-result", (result) => {
  // ok | not_found | invalid_payload | invalid_answer | unsupported_host
});
```

Validation is strict and all-or-nothing: every question answered, every index in
range, no duplicates — otherwise nothing is applied and the dialog stays open.
`unsupported_host` means the questionnaire runs through an RPC host's own
dialogs, which cannot be answered from outside.

## Platform capability

| Channel | Actions | Callback path |
| --- | --- | --- |
| Windows (SnoreToast, via node-notifier) | 3 buttons | in-process: `button` label in the result |
| macOS (terminal-notifier) | 1–2 | in-process |
| Linux (`notify-send -A key=label`) | unbounded | in-process: chosen key on stdout, needs a long-running child **and bypassing node-notifier** |
| Termux (`--button1..3` + `--buttonN-action`) | 3 | out-of-process shell action → needs a bridge (file watch or localhost HTTP) |
| ntfy (`actions` with `http` type) | 3 | outbound HTTP → needs a localhost listener reachable from the phone |
| OSC | 0 | none — fall back to "open the terminal" |

Because three of six channels cannot call back in-process, the channel interface
grows an optional capability object (`maxActions`, `supportsActions`,
`sendWithActions`) and a token registry that pairs a notification with the
questionnaire it belongs to.

## Paging rules (decided)

1. **One notification per question.** A questionnaire with four questions becomes
   four notifications, each tagged `ask:<toolCallId>:<questionIndex>`, so a stale
   answer cannot resolve the wrong question.
2. **Body is complete, buttons are shortcuts.** The body always lists every
   option as `1. label` (labels truncated per `summary.maxBodyChars`, entries
   never dropped). Buttons only map the current page.
3. **Page size = `maxActions - 1` when more options follow**, so the last button
   is always `更多 →` (More). 3 buttons → 2 options per page; 4 → 3 per page;
   Linux lists everything and never pages.
4. **Never silently truncate.** Page counter (`2/3`) goes into the body, and the
   last page's `更多 →` is replaced by `返回` (Back) only if it fits, otherwise
   omitted.
5. **Single-select only.** Multi-select and "Type something" cannot be expressed
   with toast buttons; those questions notify with "answer in the terminal" and
   no buttons.
6. **Every tap gets a verdict.** On `ok`, stay silent. On `not_found` /
   `invalid_answer` (for example, the user already answered in the TUI), send one
   short follow-up notification instead of failing silently.
7. **Token hygiene.** The token is random per notification, valid only while
   `rpiv:ask-user:blocked { active: true }` is open, and never appears in logs.

## Open questions for the next round

- Whether to implement the Linux path ourselves (`notify-send -A`) or keep
  node-notifier and lose Linux buttons.
- Whether the Termux bridge uses a watched spool file or a localhost HTTP
  listener (the latter also unlocks ntfy).
- Defaults: should notification actions be on for `ask` only, or opt-in?
