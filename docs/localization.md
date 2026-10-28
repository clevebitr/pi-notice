# Localization

Pi-notice speaks English, 简体中文, and 繁體中文 out of the box. Every
user-facing string — notifications, `/notice` output, the TUI settings panel —
comes from `locales/<code>.json`.

This page is also published as a static site from `docs/`; edit
[`localization.md`](./localization.md) and [`index.html`](./index.html) together.

## How the language is chosen

First hit wins:

1. `locale` in `pi-notice.json` (`"auto"` skips this step)
2. `PI_NOTICE_LOCALE`
3. `LC_ALL` / `LC_MESSAGES`
4. `LANG`
5. English

```jsonc
// ~/.pi/agent/pi-notice.json or <project>/.pi/pi-notice.json
{ "locale": "zh-TW" }
```

```bash
PI_NOTICE_LOCALE=zh-CN pi
/notice locale zh-TW        # persist to <project>/.pi/pi-notice.json
/notice locale zh-TW --global
/notice locale zh-TW --session   # this run only
/notice                          # TUI panel → Language row
```

Language tags are normalized, so `zh_CN.UTF-8`, `zh-Hans`, and `zh` all resolve
to Simplified Chinese, while `zh_TW`, `zh-HK`, and `zh-Hant` resolve to
Traditional Chinese. Unknown languages fall back to English.

## Progress

| Code | Language | Strings | Status |
| --- | --- | --- | --- |
| `en` | English | 140 | base |
| `zh-CN` | 简体中文 | 140 | complete |
| `zh-TW` | 繁體中文 | 140 | complete |

Run `npm run check:locales` at any time to print this table from the files.

## Translate through Weblate (recommended)

[Weblate](https://weblate.org/) is free for libre projects and returns work as
pull requests, which keeps review on GitHub.

1. Create a project at <https://hosted.weblate.org/> and add the component:
   - **Source code repository**: `https://github.com/clevebitr/pi-notice`
   - **Repository branch**: `main`
   - **File format**: *JSON file (flat key-value)*
   - **Monolingual base language file**: `locales/en.json`
   - **File mask**: `locales/*.json`
   - **Translation file**: `locales/{{language_code}}.json`
2. Enable the languages you want to accept.
3. Turn on *Push on commit* or review Weblate's pull requests manually.
4. Machine translation is fine as a first pass, but mark it for human review:
   notification wording is short, and a literal translation reads badly in a
   toast.

Once the project exists, put its URL here and in the README badges.

## Translate with a pull request

See [`locales/README.md`](../locales/README.md) for the key rules, glossary, and
the five-step checklist. The short version:

```bash
cp locales/en.json locales/ja.json
# translate values, keep keys and {placeholders}
npm run check:locales
npm test
```

Adding a language also needs:

- a `LOCALES` entry in [`src/i18n.ts`](../src/i18n.ts) (code + native label);
- an alias in the same file so `LANG=ja_JP.UTF-8` resolves;
- a row in the progress table above.

## What is not translated

- Config keys, channel names, and CLI flags (`events.todo`, `channels`, `--global`).
- Notification bodies that quote the model: replies, error messages, todo task
  titles. Those arrive in whatever language you talk to the model in.
- `PI_NOTICE_*` environment variable names.

## Why `.one` keys exist

English needs `1 turn` / `2 turns`; Chinese does not. `notice.meta.turns.one` is
used only when `count === 1` and only if the locale defines it. Translations may
omit every `.one` key — the base key is then used for all counts.
