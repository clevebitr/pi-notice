# locales

Pi-notice ships one flat JSON file per language. English (`en.json`) is the
single source of truth: every other file must contain the same keys.

```text
locales/
├── en.json      # base language — add new keys here first
├── zh-CN.json   # 简体中文
└── zh-TW.json   # 繁體中文
```

## Rules

1. **Flat keys, dot notation.** Keys look like `notice.settled.done`; do not nest objects.
2. **Never rename a shipped key** without updating every locale. Missing keys fall back to English at runtime, so an unfinished translation degrades gracefully instead of breaking.
3. **Keep placeholders.** `{count}`, `{label}`, `{error}`, … must appear in the translation with the same names. CI compares them.
4. **`.one` suffix is an optional English-only plural.** `notice.meta.turns.one` is used when `count === 1`; languages without plurals simply omit it.
5. **Write one sentence per key.** Multi-line values (only `cmd.help`) use `\n`.
6. **Terminology** — keep it consistent with the table below.

## Glossary

| Key concept | English | 简体中文 | 繁體中文 |
| --- | --- | --- | --- |
| notification | notification | 通知 | 通知 |
| settings panel | settings panel | 设置面板 | 設定面板 |
| turn | turn | 一轮对话 | 一輪對話 |
| todo item | todo | 待办 / 任务 | 待辦 / 工作 |
| session | session | 会话 | 工作階段 |
| reconnect | reconnect | 重连 | 重新連線 |
| quiet hours | quiet hours | 静默时段 | 靜音時段 |
| channel | channel | 通道 | 通道 |

## Add a language

1. Copy `locales/en.json` to `locales/<code>.json` (use a BCP-47 code such as
   `ja`, `de`, `pt-BR`).
2. Translate every value; keep keys and placeholders untouched.
3. Add the locale to `LOCALES` in [`src/i18n.ts`](../src/i18n.ts) **and** the
   alias table there (so `LANG=ja_JP.UTF-8` resolves).
4. Run `npm run check:locales` and `npm test`.
5. Open a pull request that touches only the new file plus `src/i18n.ts`.

## Translate without touching Git (Weblate)

The project is set up for [Weblate](https://weblate.org/), which is free for
libre projects. Component configuration:

| Setting | Value |
| --- | --- |
| File format | JSON file (flat key-value) |
| Monolingual base language | English (`en`) |
| File mask | `locales/*.json` |
| Base file | `locales/en.json` |
| Translation file | `locales/<code>.json` |

Weblate opens one pull request per language, so the machine translation plus
human review flow stays out of the main branch. See
[`docs/localization.md`](../docs/localization.md) for the full walkthrough.

## Verifying locally

```bash
npm run check:locales   # key + placeholder parity, coverage table
npm test                # includes tests/i18n.test.ts
```
