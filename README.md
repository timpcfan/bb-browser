<div align="center">

# bb-browser

### BadBoy Browser

**Your browser is the API. No keys. No bots. No scrapers.**

[![npm](https://img.shields.io/npm/v/bb-browser?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/bb-browser)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](#why) · [中文](#中文)

</div>

---

You're already logged into Gmail, Twitter, Reddit, Xiaohongshu — bb-browser lets AI agents use that. Not by stealing cookies or faking fingerprints. By **being** the browser.

```
AI Agent (Claude Code, Codex, etc.)
       │ CLI commands
       ▼
bb-browser CLI ──HTTP──▶ Daemon ──SSE──▶ Chrome Extension
                                              │
                                              ▼ chrome.debugger (CDP)
                                         Your Real Browser
                                    (logged-in sites, cookies, sessions)
```

## Why

Every scraping tool tries to **pretend** it's a browser. bb-browser **is** the browser.

| | Playwright / Selenium | Scraping libs | bb-browser |
|---|---|---|---|
| Browser | Headless, isolated | No browser | Your real Chrome |
| Login state | None, must re-login | Cookie extraction | Already there |
| Anti-bot | Detected easily | Cat-and-mouse game | Invisible — it IS the user |
| Internal sites | Need VPN/proxy setup | Can't reach | If you can see it, so can the agent |

## What it can do

### Browser Automation

```bash
bb-browser open https://example.com
bb-browser snapshot -i           # interactive elements only
bb-browser click @0              # click by ref
bb-browser fill @2 "hello"       # fill input
bb-browser press Enter
bb-browser screenshot
```

### Authenticated Fetch

Like `curl`, but with your browser's login state. No API keys, no tokens.

```bash
# Reddit — you're logged in, just fetch
bb-browser fetch https://www.reddit.com/api/me.json

# Any website's internal API — the browser handles auth
bb-browser fetch https://api.example.com/user/profile --json
```

### Network Capture

See what any website sends and receives — request headers, bodies, response data. Like Chrome DevTools Network tab, but from CLI.

```bash
bb-browser network requests --filter "api.example.com" --with-body --json
# → Full request headers (including auth/signing), full response body
# → See exactly how a website's API works — then build an adapter for it
```

### Site Adapters

Pre-built commands for popular websites. Community-driven via [bb-sites](https://github.com/epiral/bb-sites).

```bash
bb-browser site update                                    # install adapters
bb-browser site reddit/thread https://reddit.com/r/...    # Reddit discussion tree
bb-browser site twitter/user yan5xu                        # Twitter profile
bb-browser site xiaohongshu/feed                           # Xiaohongshu feed
bb-browser site hackernews/top                             # HN front page
```

> Xiaohongshu has request signing (X-s headers). Our adapters call the page's own Vue/Pinia store actions — the page signs the requests itself. Zero reverse engineering needed.

## Install

```bash
npm install -g bb-browser
```

Then load the Chrome extension:

1. `chrome://extensions/` → Enable Developer Mode
2. "Load unpacked" → select `node_modules/bb-browser/extension/`
3. Done.

```bash
bb-browser daemon    # start the daemon
bb-browser status    # verify connection
```

## Command Reference

| Category | Command | Description |
|----------|---------|-------------|
| **Navigate** | `open <url>` | Open URL |
| | `back` / `forward` / `refresh` | Navigate |
| | `close` | Close tab |
| **Snapshot** | `snapshot` | Full DOM tree |
| | `snapshot -i` | Interactive elements only |
| **Interact** | `click <ref>` | Click element |
| | `fill <ref> <text>` | Clear and fill |
| | `type <ref> <text>` | Append text |
| | `hover <ref>` | Hover |
| | `press <key>` | Keyboard (Enter, Tab, Control+a) |
| | `scroll <dir> [px]` | Scroll |
| | `check` / `uncheck <ref>` | Checkbox |
| | `select <ref> <val>` | Dropdown |
| **Data** | `get text <ref>` | Element text |
| | `get url` / `get title` | Page info |
| | `screenshot [path]` | Screenshot |
| | `eval "<js>"` | Run JavaScript |
| **Fetch** | `fetch <url> [--json]` | Authenticated HTTP fetch |
| **Site** | `site list` | List site adapters |
| | `site <name> [args]` | Run adapter |
| | `site update` | Update community adapters |
| **Network** | `network requests [filter]` | View requests |
| | `network requests --with-body` | Include headers & body |
| | `network route "<url>" --abort` | Block requests |
| | `network clear` | Clear records |
| **Tab** | `tab` | List tabs |
| | `tab new [url]` | New tab |
| | `tab <n>` | Switch tab |
| **Debug** | `console` / `errors` | Console & JS errors |
| | `trace start` / `trace stop` | Record user actions |
| **Daemon** | `daemon` / `stop` / `status` | Manage daemon |

All commands support `--json` for structured output and `--tab <id>` for multi-tab operations.

## Architecture

```
bb-browser/
├── packages/
│   ├── cli/          # CLI (TypeScript, argument parsing, HTTP client)
│   ├── daemon/       # HTTP daemon (SSE bridge, request-response matching)
│   ├── extension/    # Chrome extension (Manifest V3, chrome.debugger CDP)
│   └── shared/       # Shared types and protocol definitions
├── dist/             # Build output (npm publish)
└── extension/        # Built extension (npm publish)
```

| Layer | Tech |
|-------|------|
| CLI | TypeScript, zero dependencies |
| Daemon | Node.js HTTP + SSE |
| Extension | Chrome MV3 + `chrome.debugger` API |
| Build | pnpm monorepo + Turborepo + tsup + Vite |

## License

[MIT](LICENSE)

---

<a id="中文"></a>

## 中文

### BadBoy Browser — 坏孩子浏览器

**你的浏览器就是 API。不需要密钥，不需要爬虫，不需要模拟。**

你已经登录了 Gmail、Twitter、Reddit、小红书 — bb-browser 让 AI Agent 直接用你的浏览器。不是偷 Cookie，不是伪造指纹。是**成为**浏览器本身。

### 为什么不用 Playwright / Selenium

所有爬虫工具都在**假装**是浏览器。bb-browser **就是**浏览器。

- 真实的 Chrome 浏览器，不是无头环境
- 复用已有的登录态和 Cookie
- 通过 `chrome.debugger` API 操作，无自动化指纹
- 你能访问的网站，Agent 都能用

### 核心能力

**浏览器自动化** — 打开页面、点击、填写、截图，标准的浏览器控制。

**带登录态的 Fetch** — 像 `curl`，但自动带上你浏览器里的 Cookie 和会话。Reddit 的 `.json` API、Twitter 的 GraphQL、任何内部系统的 API — 一行命令。

**网络抓包** — 完整的 request headers（包括签名 header）和 response body。用来逆向任何网站的 API，然后写 adapter。

**Site Adapters** — 社区维护的网站适配器。`bb-browser site reddit/thread <url>` 直接拿 Reddit 讨论树。小红书的 X-s 签名？Adapter 通过调用页面自己的 Pinia store action 发请求，页面自己签名，零逆向。

### 安装

```bash
npm install -g bb-browser
```

加载 Chrome 扩展 → `chrome://extensions/` → 开发者模式 → 加载已解压扩展 → 选 `node_modules/bb-browser/extension/`

```bash
bb-browser daemon    # 启动
bb-browser status    # 确认连接
```
