# pi-notice

Pi 的通知扩展。在一轮对话结束、等待你回答/确认、todo 进度变化、模型报错或重试、会话重连时，发送一条摘要式系统通知。

## 支持平台

| 平台 | 通知方式 | 依赖 |
| --- | --- | --- |
| Windows | 原生 Toast | 无 |
| macOS | 通知中心 | 无 |
| Linux | `notify-send` | `libnotify` |
| Android | Termux 通知 | Termux:API + `termux-api` |
| iOS / 远程 | ntfy 推送（可选） | ntfy App + topic |

`channels: ["auto"]` 会自动选择本机通道：Android Termux 使用 `termux`，其他平台使用 `desktop`。

## 安装

```bash
cd /path/to/pi-notice
npm install
pi install /path/to/pi-notice
```

临时试用：

```bash
pi -e /path/to/pi-notice/extensions/pi-notice.ts
```

## 使用

在 TUI 里输入 `/notice` 会打开设置面板（和 `/config`、`/tools` 同款：方向键移动、输入搜索、
回车/空格切换、Esc 关闭），每一行改动立即写入配置并生效：

```text
pi-notice 通知设置
  通知总开关                    开
  事件 · 一轮对话结束            开
  事件 · 等待回答/确认           开
  ...
  通道 · 自动                   开
  语言                          简体中文
  重连 · 恢复                   开
```

不想用面板就用子命令：

```text
/notice                     打开设置面板（非 TUI 模式退化为状态输出）
/notice status              打印状态摘要
/notice events              逐项查看事件开关
/notice on | off            开启 / 关闭全部通知
/notice on settled todo     只开启指定事件
/notice off ask,retry       关闭指定事件
/notice toggle todo         切换指定事件
/notice channels            查看当前通知通道
/notice channels auto,ntfy  设置通知通道
/notice reasons resume,new  设置哪些会话事件算“重连”
/notice locale zh-TW        切换语言（en / zh-CN / zh-TW）
/notice test                发送测试通知
/notice reload              重新读取配置文件
/notice help                完整用法
```

事件名支持英文别名和中文：`settled`(结束/完成)、`ask`(提问/确认)、`todo`(待办/进度)、
`errors`(错误)、`retry`(重试/恢复)、`session`(重连/会话)，以及 `all`。

面板打开时只写入 `<项目>/.pi/pi-notice.json`；需要写到用户级配置时用
`/notice ... --global`。

### 修改会写到哪里

| 参数 | 写入位置 |
| --- | --- |
| 默认（或 `--local`） | `<项目>/.pi/pi-notice.json` |
| `--global` | `~/.pi/agent/pi-notice.json`（设置 `PI_NOTICE_CONFIG` 时写到该文件） |
| `--session` / `--temp` | 不落盘，只影响本次运行 |

写入是深合并的，只改你动过的键，其它配置原样保留。改完立即生效，无需重启。

当有事件被关闭或整体关闭时，TUI 底部状态栏会提示 `🔔 通知 -todo` / `🔕 通知已关闭`；
全部默认开启时不占用状态栏。

## 配置

按顺序读取并合并：

1. `~/.pi/agent/pi-notice.json`
2. `<项目>/.pi/pi-notice.json`
3. 环境变量（`PI_NOTICE_*`，优先级最高；`/notice status` 会提示哪些变量正在生效）

语言按同样思路解析，先命中先用：`locale`（`"auto"` 时跳过）→ `PI_NOTICE_LOCALE` →
`LC_ALL` / `LC_MESSAGES` → `LANG` → 英文。`zh_CN.UTF-8`、`zh-Hans`、`zh` 都归到简体中文，
`zh_TW` / `zh-HK` / `zh-Hant` 归到繁体中文。

```json
{ "locale": "zh-CN" }
```

最小配置：

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

事件开关：

| 字段 | 通知时机 | 子命令 |
| --- | --- | --- |
| `settled` | 一轮对话结束 | `/notice off settled` |
| `ask` | 等待用户回答或确认 | `/notice off ask` |
| `todo` | todo 状态变化 | `/notice off todo` |
| `errors` | 模型报错 | `/notice off errors` |
| `retry` | 自动重试与恢复 | `/notice off retry` |
| `session` | 会话重连 | `/notice off session` |

整体开关：`{"enabled": false}` 或 `/notice off`。

## 多语言

界面文案、通知正文和 `/notice` 输出都来自 [`locales/`](./locales) 下的 JSON，目前有
English、简体中文、繁體中文三份，缺 key 时回退英文而不会报错。

- 想加语言：见 [`locales/README.md`](./locales/README.md)（术语表 + 五步流程）。
- 想在浏览器里翻译：项目按 [Weblate](https://weblate.org/) 配置，说明见
  [`docs/localization.md`](./docs/localization.md)，本地化落地页源码在
  [`docs/index.html`](./docs/index.html)（GitHub Actions 自动发布到 Pages）。
- 本地校验：`npm run check:locales` 会打印覆盖率表并检查 key / 占位符一致性。

通道：

| 值 | 说明 |
| --- | --- |
| `auto` | 自动选择本机通道 |
| `desktop` | Windows / macOS / Linux |
| `termux` | Android Termux |
| `ntfy` | 远程推送，可用于 iOS |

完整配置见 [`pi-notice.example.json`](./pi-notice.example.json)。

## Android

安装 Termux:API 应用，然后在 Termux 中执行：

```bash
pkg install termux-api
termux-notification --title "Pi" --content "测试"
```

## iOS / 远程推送

在 iOS 安装 ntfy App 并订阅 topic，然后配置：

```json
{
  "channels": ["auto", "ntfy"],
  "ntfy": {
    "topic": "your-topic"
  }
}
```

运行 `/notice test` 验证。

## 提示

- 通知正文只包含项目名、状态、耗时、最后回复摘录和 todo 进度，并会自动截断。
- 支持静默时段、最短通知时长和去重，详见示例配置。
