<div align="center">

<img src="web/public/logo-icon.svg" alt="BrowserBird" width="80"/>

# BrowserBird

Self-hosted AI agent for Slack with a real browser, a scheduler, and a web dashboard.

[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@owloops/browserbird?style=flat-square)](https://www.npmjs.com/package/@owloops/browserbird)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.21-brightgreen?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

</div>

<video src="https://github.com/user-attachments/assets/c71791c3-ba1c-4590-8931-f3adc2dcac2d" autoplay loop muted playsinline></video>

https://github.com/user-attachments/assets/ff9bfe81-dde8-4bd2-acf5-47b48f43be9b

Talk to an AI agent in Slack threads. It can browse the web with a real Chromium browser you can watch live through VNC, run scheduled tasks on a cron, and keep persistent sessions across conversations. BrowserBird is the orchestration layer; the agent CLI ([claude](https://docs.anthropic.com/en/docs/claude-code/overview), [opencode](https://github.com/anomalyco/opencode)) handles reasoning, memory, tools, and sub-agents.

Built by [Owloops](https://github.com/Owloops), building browser automation tools since 2020.

## Installation

On first run, open the web UI and complete the onboarding wizard. It walks through Slack tokens, agent config, and API keys.

### Docker (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Owloops/browserbird/main/compose.yml -o compose.yml
docker compose up -d
```

Everything is included: agent CLI, Chromium browser, VNC, and Playwright MCP. Open `http://<host>:18800` to begin onboarding.

The browser runs in **persistent** mode by default: logins and cookies are saved across sessions, one agent at a time. Set `BROWSER_MODE=isolated` in `.env` for parallel sessions with fresh contexts (requires container restart).

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/browserbird)

## Slack

[![Create Slack App](https://img.shields.io/badge/Slack-Create_App-4A154B?style=for-the-badge&logo=slack&logoColor=white)](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22BrowserBird%22%2C%22description%22%3A%22A%20self-hosted%20AI%20assistant%20in%20Slack%2C%20with%20a%20real%20browser%20and%20a%20scheduler.%22%2C%22background_color%22%3A%22%231a1a2e%22%7D%2C%22features%22%3A%7B%22assistant_view%22%3A%7B%22assistant_description%22%3A%22A%20self-hosted%20AI%20assistant%20in%20Slack%2C%20with%20a%20real%20browser%20and%20a%20scheduler.%22%7D%2C%22app_home%22%3A%7B%22home_tab_enabled%22%3Atrue%2C%22messages_tab_enabled%22%3Atrue%2C%22messages_tab_read_only_enabled%22%3Afalse%7D%2C%22bot_user%22%3A%7B%22display_name%22%3A%22BrowserBird%22%2C%22always_online%22%3Atrue%7D%2C%22slash_commands%22%3A%5B%7B%22command%22%3A%22%2Fbird%22%2C%22description%22%3A%22Manage%20BrowserBird%20birds%22%2C%22usage_hint%22%3A%22list%20%7C%20fly%20%7C%20logs%20%7C%20enable%20%7C%20disable%20%7C%20create%20%7C%20status%22%2C%22should_escape%22%3Afalse%7D%5D%7D%2C%22oauth_config%22%3A%7B%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22reactions%3Aread%22%2C%22reactions%3Awrite%22%2C%22users%3Aread%22%2C%22commands%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22bot_events%22%3A%5B%22app_mention%22%2C%22assistant_thread_context_changed%22%2C%22assistant_thread_started%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%5D%7D%2C%22interactivity%22%3A%7B%22is_enabled%22%3Atrue%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Atrue%2C%22token_rotation_enabled%22%3Afalse%7D%7D)

The manifest pre-configures all scopes, events, and slash commands. After creating the app, install it to your workspace and grab two tokens: the **Bot User OAuth Token** (`xoxb-...`) from OAuth & Permissions, and an **app-level token** (`xapp-...`) with `connections:write` scope from Basic Information.

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

> [!TIP]
> If `/bird` fails or routes to the wrong app, you may have another Slack app in the workspace with the same slash command. Remove or rename the duplicate from [api.slack.com/apps](https://api.slack.com/apps).

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
| `BROWSERBIRD_DB`          | Path to SQLite database file. Overridden by `--db` flag                                          |
| `NO_COLOR`                | Disable colored output                                                                           |

The **opencode** provider inherits standard env vars per model provider: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, etc. See the full list at [models.dev](https://models.dev).

> [!NOTE]
> **Agent authentication:** `ANTHROPIC_API_KEY` (pay-per-token) is required for shared or commercial deployments per Anthropic's Consumer ToS. `CLAUDE_CODE_OAUTH_TOKEN` is fine for personal self-hosted use (claude provider only). When both are set, the claude provider uses OAuth and the opencode provider uses the API key.

## CLI

Available on npm: `npx @owloops/browserbird`

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
  --config       config file path (env: BROWSERBIRD_CONFIG)
  --db           database file path (env: BROWSERBIRD_DB)

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
