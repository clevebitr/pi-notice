# pi-notice

[![CI](https://github.com/clevebitr/pi-notice/actions/workflows/ci.yml/badge.svg)](https://github.com/clevebitr/pi-notice/actions/workflows/ci.yml)

给 [Pi](https://pi.dev) 加上系统通知：一轮对话结束、等待你回答/确认、todo 进度变化、模型报错、自动重试与恢复、会话重连时，把状态推送到桌面或手机。

通知内容按“摘要式”生成：项目名 + 状态 + 耗时/轮数 + 最后回复摘录 + todo 进度 + 错误摘要，并自动裁剪，避免系统通知被截断。

## 支持的平台

| 平台 | 通道 | 依赖 |
| --- | --- | --- |
| Windows | 原生 Toast（node-notifier / SnoreToast） | 无 |
| macOS | 通知中心（node-notifier / terminal-notifier） | 无 |
| Linux | `notify-send` | `libnotify-bin` / `libnotify` |
| Android | Termux 通知（`termux-notification`） | Termux:API 应用 + `pkg install termux-api` |
| iOS | 本地进程无法直接弹通知；可用可选的 ntfy 远程推送 | ntfy iOS App + topic |
| 其他/远程 | ntfy（HTTP 推送） | 可选，需配置 topic |

`channels: ["auto"]` 会自动选择本机通道：Termux 选 `termux`，其他平台选 `desktop`。要同时推到手机，显式加上 `"ntfy"`。

## 安装

### 从本地目录安装

```bash
cd /path/to/pi-notice
npm install
pi install /path/to/pi-notice
```

只想临时试用：

```bash
pi -e /path/to/pi-notice/extensions/pi-notice.ts
```

### 从 npm 安装（发布后）

```bash
pi install npm:pi-notice
```

安装后启动 Pi，运行 `/notice status` 查看通道和配置。

## 通知时机

| 事件 | 说明 |
| --- | --- |
| 一轮对话结束 | 在 `agent_settled` 触发，也就是 Pi 完成所有自动续跑、重试、压缩后真正空闲时；不会在工具循环中途反复打扰。 |
| 等待用户回答/确认 | 监听 `@juicesharp/rpiv-ask-user-question` 的 `rpiv:ask-user:prompt` 事件；同时识别名字含 ask/question 的工具启动参数，并覆盖 `ui_prompt_start` 的 confirm/select/input/editor 对话框。自定义 `ctx.ui.custom()` 默认不通知，避免组件类扩展刷屏。 |
| todo 状态变化 | 监听 `todo` 工具结果里的 `details.tasks`，通知完成数、当前进行中的任务和本次变更；`list`/`get` 不通知。多次快速更新会合并，全部完成时立即发送。 |
| 错误 / 重试 / 恢复 | 模型请求失败时通知；Pi 自动重试时发送“重试中 (第 N 次)”，恢复后发送“已恢复连接”。最终错误会包含在本轮结束通知里。 |
| 会话重连 | `session_start` 的 `resume`（以及你配置的其他原因）触发“会话已恢复”。 |

所有通知都有去重窗口和串行队列；发送失败只写 stderr，不会影响 Pi 的对话流程。

## 配置

配置按以下顺序合并，后面的覆盖前面的：

1. 内置默认值
2. `~/.pi/agent/pi-notice.json`（或 `PI_NOTICE_CONFIG` 指定的文件）
3. `<项目>/.pi/pi-notice.json`
4. 环境变量

完整示例见 [`pi-notice.example.json`](./pi-notice.example.json)。一个最小配置：

```json
{
  "channels": ["auto"],
  "events": { "settled": true, "ask": true, "todo": true, "errors": true, "retry": true, "session": true },
  "summary": { "maxBodyChars": 220, "maxReplyChars": 140 }
}
```

### 主要字段

- `channels`：`auto`、`desktop`、`termux`、`ntfy`、`osc` 的数组。`auto` 可与其他通道组合。
- `events`：`settled`、`ask`、`todo`、`errors`、`retry`、`session` 六个开关。
- `sessionReasons`：哪些 `session_start` 原因发“会话已恢复”，默认 `["resume"]`；可选 `startup`、`reload`、`new`、`resume`、`fork`。
- `minDurationMs`：短于该时长的成功轮次不通知；错误始终通知。默认 `0`。
- `quietHours`：静默时段，支持跨午夜（如 `23:00` → `08:00`）。`allowUrgent: true` 时提问/错误仍会通知。
- `summary`：正文长度、回复摘录长度，以及是否包含项目名/耗时/回复/todo。
- `desktop`：`sound`、Windows `appId`、toast `timeoutSeconds`。
- `termux`：`termux-notification` 命令、通知 id、优先级、声音、震动、分组、点击动作。
- `ntfy`：服务器地址、topic、token、优先级、tags。topic 为空时 ntfy 通道不可用。
- `osc`：终端转义序列通知（Ghostty/iTerm2/WezTerm/Kitty），默认关闭；只在 stdout 是 TTY 时发送，不会污染 JSON/RPC 输出。
- `dedupeWindowMs`：相同 key 的去重窗口。
- `debug`：在 stderr 打印每次发送和失败详情。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `PI_NOTICE_DISABLED=1` | 关闭通知 |
| `PI_NOTICE_CONFIG=/path/file.json` | 指定用户配置文件 |
| `PI_NOTICE_CHANNELS=desktop,ntfy` | 覆盖 `channels` |
| `PI_NOTICE_EVENTS=settled,ask` | 事件白名单；`+session,-todo` 形式做增量修改 |
| `PI_NOTICE_SESSION_REASONS=resume,fork` | 覆盖会话重连原因 |
| `PI_NOTICE_MIN_DURATION_MS=5000` | 覆盖最短通知时长 |
| `PI_NOTICE_QUIET_HOURS=23:00-08:00` / `off` | 静默时段 |
| `PI_NOTICE_NTFY_URL` / `PI_NOTICE_NTFY_TOPIC` / `PI_NOTICE_NTFY_TOKEN` | ntfy 配置 |
| `PI_NOTICE_TERMUX_ACTION` | Android 通知点击动作 |
| `PI_NOTICE_DEBUG=1` | 调试日志 |

## Android / Termux

1. 从 F-Droid 或 GitHub 安装 Termux，以及同源的 **Termux:API** 应用。
2. 在 Termux 中安装命令行工具：

   ```bash
   pkg install termux-api
   termux-notification --title "Pi" --content "Termux 通知测试"
   ```

3. 正常启动 Pi 即可。`channels: ["auto"]` 会自动走 `termux` 通道。

点击通知回到 Pi 的可选配置：

```json
{
  "termux": {
    "action": "am start -n com.termux/.app.TermuxActivity"
  }
}
```

不同 Termux 版本的参数可能略有差异；扩展会先尝试完整参数（声音/震动/分组），失败时用最小参数重试。

## iOS / 远程推送（可选）

iOS 不允许普通本地进程直接弹系统通知。需要远程推送时，可以使用 ntfy：

1. 在 iPhone 安装 ntfy App，订阅一个 topic。
2. 配置：

   ```json
   {
     "channels": ["desktop", "ntfy"],
     "ntfy": {
       "url": "https://ntfy.sh",
       "topic": "your-long-random-topic",
       "token": "",
       "priority": "auto"
     }
   }
   ```

3. `/notice test` 验证。

自建 ntfy 时把 `url` 改成服务器地址；如果服务器路径包含 topic，可用 `{topic}` 占位符。

## 命令

```text
/notice status   查看开关、通道、事件、静默时段和配置文件
/notice on       本次运行开启
/notice off      本次运行关闭
/notice toggle   切换
/notice test     发送一条测试通知，并报告每个通道的结果
/notice reload   重新读取配置文件
```

`on/off` 只影响当前进程；修改配置文件后才会持久化。

## 实现要点

- 入口：`extensions/pi-notice.ts`
- 配置合并与校验：`src/config.ts`
- 文案/摘要/todo 解析：`src/format.ts`
- 通道：`src/channels/`（desktop / termux / ntfy / osc）
- 去重、静默时段、发送队列：`src/notify.ts`

Pi 事件到通知的映射：

```text
agent_settled                  -> 本轮摘要（完成/中止/出错 + 耗时 + 回复 + todo）
rpiv:ask-user:prompt           -> 等待回答（问题、选项数）
ui_prompt_start (非 custom)    -> 等待确认/选择/输入/编辑
tool_execution_end (todo)      -> todo 进度变化
message_end + agent_end        -> 错误 / 自动重试
成功响应后的首次 message_end    -> 已恢复连接
session_start (resume)         -> 会话已恢复
```

## 开发

```bash
npm install
npm run check     # tsc --noEmit
npm test          # node --test，使用 Node 原生 TS 类型剥离
npm run demo      # 走真实通道发一条测试通知
pi -e ./extensions/pi-notice.ts -p "Reply with exactly: OK"
```

发布流程见 [`RELEASING.md`](./RELEASING.md)。

要求 Node.js >= 22.22.2（`node-notifier@11` 的要求）。

## 故障排查

- **完全没有通知**：先跑 `/notice status`，再跑 `/notice test`。检查 `events` 开关、`quietHours`、`minDurationMs` 和 `channels`。
- **Windows 没有 Toast**：确认系统通知未关闭、专注助手未拦截；`desktop.appId` 可以改成自己的应用名。首次使用可能需要在系统设置里允许通知。
- **macOS 没有通知**：在“系统设置 → 通知”中允许终端/Pi 的通知；检查专注模式。
- **Linux**：安装 `libnotify`，确认 `notify-send "test" "hello"` 可用。
- **Termux**：确认 Termux:API 应用与 `termux-api` 包都已安装，且 `termux-notification` 在 PATH 中。
- **ntfy 失败**：确认 topic、服务器地址和 token；`/notice test` 会显示 HTTP 状态。
- **提示找不到 node-notifier**：在 pi-notice 包目录执行 `npm install`，或通过 `pi install` 让 Pi 安装依赖。
- **不想让命令输出/代码内容进入通知**：摘要只取最后回复的前若干字符；可在配置中调小 `summary.maxReplyChars`，或把 `includeReply` 设为 `false`。

通知正文可能包含模型输出，请注意不要在工作区里放置不希望出现在锁屏通知上的敏感内容。
