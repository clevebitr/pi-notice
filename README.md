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

启动 Pi 后运行：

```text
/notice status   查看状态
/notice test     发送测试通知
/notice on       开启
/notice off      关闭
/notice reload   重新读取配置
```

## 配置

按顺序读取并合并：

1. `~/.pi/agent/pi-notice.json`
2. `<项目>/.pi/pi-notice.json`
3. 环境变量

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

| 字段 | 通知时机 |
| --- | --- |
| `settled` | 一轮对话结束 |
| `ask` | 等待用户回答或确认 |
| `todo` | todo 进度变化 |
| `errors` | 模型报错 |
| `retry` | 自动重试与恢复 |
| `session` | 会话重连 |

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
