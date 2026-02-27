<div align="center">

<img src="web/public/logo-icon.svg" alt="BrowserBird" width="80"/>

# BrowserBird

Slack-connected AI agent orchestrator with a real browser and a scheduler.

[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@owloops/browserbird?style=flat-square)](https://www.npmjs.com/package/@owloops/browserbird)
[![Install size](https://packagephobia.com/badge?p=@owloops/browserbird)](https://packagephobia.com/result?p=@owloops/browserbird)

</div>

<video src="https://github.com/user-attachments/assets/c71791c3-ba1c-4590-8931-f3adc2dcac2d" autoplay loop muted playsinline></video>

Owloops has been building browser automation tools since 2020. BrowserBird is the latest, written from scratch with lessons learned from earlier projects: [Owloops/flybird](https://github.com/Owloops/flybird), [Owloops/owloops-chrome-recorder](https://github.com/Owloops/owloops-chrome-recorder), [Owloops/owloops-extension](https://github.com/Owloops/owloops-extension).

It connects Slack to an agent CLI with a Chromium browser controlled via Playwright MCP, a cron scheduler, session persistence, and a web dashboard. BrowserBird handles the thin orchestration layer; the agent handles reasoning, memory, tools, and sub-agents.

## Installation

On first run, open the web UI and complete the onboarding wizard. It walks through Slack tokens, agent config, and API keys.

### Docker (recommended)

```bash
docker compose -f oci/compose.yml up -d
```

Everything is included: agent CLI, Chromium browser, VNC, and Playwright MCP. Open `http://<host>:18800` to begin onboarding.

To skip onboarding, pre-fill `.env` with your tokens before starting (see `cp .env.example .env`).

The browser runs in **persistent** mode by default: logins and cookies are saved across sessions, one agent at a time. Set `BROWSER_MODE=isolated` in `.env` for parallel sessions with fresh contexts (requires container restart). `shm_size: 2g` is required for Chromium stability.

### npm

```bash
npm install -g @owloops/browserbird
browserbird
```

Requires Node.js 22.21+ and at least one agent CLI installed ([claude](https://docs.anthropic.com/en/docs/claude-code/overview) or [opencode](https://github.com/anomalyco/opencode)). Open `http://localhost:18800` to begin onboarding.

## Slack

1. Create a new Slack app at [api.slack.com/apps](https://api.slack.com/apps) using the [manifest.json](https://raw.githubusercontent.com/Owloops/browserbird/main/manifest.json) from this repo
2. Go to OAuth & Permissions, install the app to your workspace, copy the **Bot User OAuth Token** (`xoxb-...`)
3. Go to Basic Information, create an app-level token with the `connections:write` scope, copy the token (`xapp-...`)

### Slash Commands

Once the app is installed, `/bird` is available in any channel:

```
/bird list              Show all configured birds
/bird fly <name>        Trigger a bird immediately
/bird logs <name>       Show recent flights
/bird enable <name>     Enable a bird
/bird disable <name>    Disable a bird
/bird create            Create a new bird (opens modal form)
/bird status            Show daemon status
```

## Configuration

The onboarding wizard handles initial setup. For manual configuration, copy the example config:

```bash
cp browserbird.example.json browserbird.json
```

See [browserbird.example.json](browserbird.example.json) for the full config with defaults.

Any string value can reference an environment variable with `"env:VAR_NAME"` syntax (e.g. `"env:SLACK_BOT_TOKEN"`).

The top-level `timezone` field (IANA format, default `"UTC"`) is used for cron scheduling and quiet hours.

<details>
<summary><strong>slack</strong> - Slack connection and behavior</summary>

```json
"slack": {
  "botToken": "env:SLACK_BOT_TOKEN",
  "appToken": "env:SLACK_APP_TOKEN",
  "requireMention": true,
  "coalesce": { "debounceMs": 3000, "bypassDms": true },
  "channels": ["*"],
  "quietHours": { "enabled": false, "start": "23:00", "end": "08:00", "timezone": "UTC" }
}
```

- `botToken`, `appToken`: Required. Bot user OAuth token and app-level token for Socket Mode
- `requireMention`: Only respond in channels when `@mentioned`; DMs always respond
- `coalesce.debounceMs`: Wait N ms after last message before dispatching (groups rapid messages)
- `coalesce.bypassDms`: Skip debouncing for DMs
- `channels`: Channel names or IDs to listen in, or `"*"` for all
- `quietHours`: Silence the bot during specified hours. Start/end in HH:MM format, can wrap midnight

</details>

<details>
<summary><strong>agents</strong> - Agent routing and model config</summary>

```json
"agents": [
  {
    "id": "default",
    "name": "BrowserBird",
    "provider": "claude",
    "model": "sonnet",
    "fallbackModel": "haiku",
    "maxTurns": 50,
    "systemPrompt": "You are responding in a Slack workspace. Be concise, helpful, and natural.",
    "channels": ["*"]
  }
]
```

Each agent is scoped to specific channels. Multiple agents are matched in order, first match wins.

- `id`, `name`: Required. Unique identifier and display name
- `provider`: `"claude"` or `"opencode"`
- `model`: Claude uses short names (`sonnet`, `haiku`). OpenCode uses `provider/model` format (`anthropic/claude-sonnet-4-20250514`)
- `fallbackModel`: Fallback when primary is unavailable (claude only)
- `maxTurns`: Max conversation turns per session
- `systemPrompt`: Instructions prepended to every session
- `channels`: Channel names or IDs this agent handles, or `"*"` for all
- `processTimeoutMs`: Per-agent subprocess timeout override (inherits from `sessions` if not set)

</details>

<details>
<summary><strong>sessions</strong> - Session lifecycle</summary>

```json
"sessions": {
  "ttlHours": 24,
  "maxConcurrent": 5,
  "processTimeoutMs": 300000
}
```

- `ttlHours`: Session lifetime in hours (resets on each message)
- `maxConcurrent`: Max simultaneous agent processes
- `processTimeoutMs`: Per-request timeout in milliseconds

</details>

<details>
<summary><strong>browser</strong> - Playwright MCP and VNC</summary>

```json
"browser": {
  "enabled": false,
  "mcpConfigPath": null,
  "vncPort": 5900,
  "novncPort": 6080,
  "novncHost": "localhost"
}
```

- `enabled`: Enable Playwright MCP for the agent
- `mcpConfigPath`: Path to your MCP config (relative or absolute)
- `vncPort`: VNC server port
- `novncPort`: Upstream noVNC WebSocket port
- `novncHost`: Upstream noVNC host (e.g. `"vm"` in Docker)

Browser mode (`persistent` or `isolated`) is controlled by the `BROWSER_MODE` environment variable, not the config file.

</details>

<details>
<summary><strong>birds</strong> - Scheduled task settings</summary>

```json
"birds": {
  "maxAttempts": 3
}
```

- `maxAttempts`: Max job attempts before a bird stops retrying

Each bird supports per-bird active hours set via CLI `--active-hours 09:00-17:00` or the API. Wrap-around windows (e.g. `22:00-06:00`) are supported.

</details>

<details>
<summary><strong>database</strong> - Retention policy</summary>

```json
"database": {
  "retentionDays": 30
}
```

- `retentionDays`: How long to keep messages, flight logs, jobs, and logs

</details>

<details>
<summary><strong>web</strong> - Dashboard and API server</summary>

```json
"web": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 18800,
  "corsOrigin": ""
}
```

- `enabled`: Enable the web dashboard and API
- `host`: Bind address (`0.0.0.0` for Docker/remote)
- `port`: Web UI and REST API port
- `corsOrigin`: Allowed origin for CORS headers (for cross-origin SPA hosting)

Authentication is handled via the web UI. On first visit, you create an account. All subsequent visits require login.

</details>

### Environment Variables

| Variable                  | Description                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `SLACK_BOT_TOKEN`         | Bot user OAuth token                                                                             |
| `SLACK_APP_TOKEN`         | App-level token for Socket Mode                                                                  |
| `ANTHROPIC_API_KEY`       | Anthropic API key (pay-per-token). Used by both claude and opencode providers                    |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for claude provider only (uses your Claude Pro/Max subscription)                     |
| `BROWSER_MODE`            | `persistent` (default) or `isolated`. Requires container restart                                 |
| `BROWSERBIRD_CONFIG`      | Path to `browserbird.json`. Overridden by `--config` flag                                        |
| `NO_COLOR`                | Disable colored output                                                                           |

The **opencode** provider inherits standard env vars per model provider: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, etc. See the full list at [models.dev](https://models.dev).

> [!NOTE]
> **Agent authentication:** `ANTHROPIC_API_KEY` (pay-per-token) is required for shared or commercial deployments per Anthropic's Consumer ToS. `CLAUDE_CODE_OAUTH_TOKEN` is fine for personal self-hosted use (claude provider only). When both are set, the claude provider uses OAuth and the opencode provider uses the API key.

## CLI

```
$ browserbird --help

   .__.
   ( ^>
   / )\
  <_/_/
   " "
usage: browserbird [command] [options]

commands:

  sessions    manage sessions
  birds       manage scheduled birds
  config      view configuration
  logs        show recent log entries
  jobs        inspect and manage the job queue
  doctor      check system dependencies

options:

  -h, --help     show this help
  -v, --version  show version
  --verbose      enable debug logging
  --config       config file path

run 'browserbird <command> --help' for command-specific options.
```

## Web UI

Runs at `http://localhost:18800` by default.

<img src="assets/webui-demo.png" alt="BrowserBird web UI" />

| Page         | Description                                                                        |
| ------------ | ---------------------------------------------------------------------------------- |
| **Status**   | System overview, failing birds, upcoming runs, active sessions                     |
| **Sessions** | Session list with message history, token usage, and conversation detail            |
| **Birds**    | Scheduled birds: create, edit, enable/disable, trigger, inline flight history      |
| **Browser**  | Live noVNC viewer (Docker only)                                                    |
| **Settings** | Config editor, agent management, secrets, system birds, job queue, and log viewer  |

## Development

```bash
git clone https://github.com/Owloops/browserbird.git
cd browserbird
npm ci
```

### Run locally

```bash
cd web && npm ci && npm run build && cd ..
./bin/browserbird
```

### Docker (build locally)

```bash
cp .env.example .env
docker compose -f oci/compose.yml up -d --build
```

### Checks

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm run format:check       # prettier
npm test                   # node --test
```

Web UI (from `web/`):

```bash
npm run check              # svelte-check
npm run format:check       # prettier
```

## License

[FSL-1.1-MIT](LICENSE), source available, converts to MIT after two years.

> [!NOTE]
> This project was built with assistance from LLMs. Human review and guidance provided throughout.
