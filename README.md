<div align="center">

<img src="web/public/logo-icon.svg" alt="BrowserBird" width="80"/>

**A self-hosted AI assistant in Slack, with a real browser and a scheduler.**

[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@owloops/browserbird?style=flat-square)](https://www.npmjs.com/package/@owloops/browserbird)
[![Install size](https://packagephobia.com/badge?p=@owloops/browserbird)](https://packagephobia.com/result?p=@owloops/browserbird)

</div>

Owloops has been building browser automation tools since 2020. [Hand-written CSS selectors](https://github.com/Owloops/flybird) required technical knowledge and broke on every layout change. [Automating selector discovery with Chrome Recorder](https://github.com/Owloops/owloops-chrome-recorder) helped with setup but not with breakage. [A Chrome extension with an LLM agent loop](https://github.com/Owloops/owloops-extension) solved that by understanding the task rather than memorizing steps, but the loop ran inside the extension driving an open tab with no server, no scheduling, and no persistence. GPT-3.5 was not reliable enough for complex pages either.

BrowserBird runs as a server process with a Chromium browser it controls via Playwright MCP. Send a message in Slack, watch the browser work live via the built-in VNC viewer, get the result back in the thread. Sessions persist across conversations, tasks run on a schedule, and everything stays on your own infrastructure.

BrowserBird handles the thin layer: Slack adapter, session routing, scheduler, browser access, CLI, and web dashboard. The agent handles reasoning, memory, tools, and sub-agents.

## Features

- **Browse and act.** Ask it to open a page, fill a form, extract information, draft a reply, or complete a multi-step workflow. It controls a real Chromium browser and you can watch it work live.
- **Scheduled tasks.** Set up birds: prompts that run on a cron schedule and post results back to Slack. Daily briefings, monitoring checks, report generation.
- **Persistent sessions.** Each Slack thread maps to a session. Context carries across conversations, pick up where you left off.
- **Multi-agent routing.** Assign different agents to different channels, each with their own model and system prompt.
- **Job queue.** All tasks go through a retry-capable queue with exponential backoff.
- **Web dashboard.** Sessions, flight logs, scheduled birds, live browser view, and config all in one place.

## Installation

### Local (npm)

Install globally and run on your own machine. Browser actions open in your local Chromium.

```bash
npm install -g @owloops/browserbird
browserbird --config browserbird.json
```

### Server (Docker)

Run on a headless server with everything pre-wired: virtual display, VNC, noVNC, Playwright, and agent CLI in containers. Watch the browser live from anywhere via the noVNC viewer.

```bash
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, BROWSERBIRD_AUTH_TOKEN, and agent auth (see below)

docker compose -f oci/compose.yml up -d
# or: podman-compose -f oci/compose.yml up -d
```

Pre-built images are pulled from `ghcr.io/owloops/browserbird` automatically. No local build needed.

The stack runs two containers: a `vm` container with the Wayland compositor, VNC server, and noVNC; and a `browserbird` container with the agent CLI, Playwright MCP, and BrowserBird itself.

> [!NOTE]
> `shm_size: 2g` is required for Chromium stability inside containers.

## Slack App Setup

1. Create a new Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Import `manifest.json` from this repo (Settings → App Manifest)
3. Upload `web/public/logo-icon.png` as the app icon (Basic Information → Display Information)
4. Install the app to your workspace
5. Copy **Bot User OAuth Token** to `SLACK_BOT_TOKEN`
6. Enable Socket Mode, copy **App-Level Token** to `SLACK_APP_TOKEN`

### Slash Commands

Once the app is installed, `/bird` is available in any channel:

```
/bird list              Show all configured birds
/bird fly <name>        Trigger a bird immediately
/bird logs <name>       Show recent flights
/bird enable <name>     Enable a bird
/bird disable <name>    Disable a bird
/bird create            Create a new bird (opens form)
/bird status            Show daemon status
```

## Configuration

```bash
cp browserbird.example.json browserbird.json
```

```json
{
  "timezone": "UTC",
  "slack": {
    "botToken": "env:SLACK_BOT_TOKEN",
    "appToken": "env:SLACK_APP_TOKEN",
    "requireMention": true,
    "coalesce": { "debounceMs": 3000, "bypassDms": true },
    "channels": ["*"],
    "quietHours": { "enabled": false, "start": "23:00", "end": "08:00", "timezone": "UTC" }
  },
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
  ],
  "sessions": {
    "ttlHours": 24,
    "maxConcurrent": 5,
    "processTimeoutMs": 300000
  },
  "database": { "retentionDays": 30 },
  "browser": { "enabled": false, "mcpConfigPath": null },
  "birds": { "maxAttempts": 3 },
  "web": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 18800,
    "authToken": "env:BROWSERBIRD_AUTH_TOKEN",
    "corsOrigin": ""
  }
}
```

| Key        | Default | Description                                                         |
| ---------- | ------- | ------------------------------------------------------------------- |
| `timezone` | `"UTC"` | IANA timezone used as default for new birds (e.g. `"America/Chicago"`) |

<details>
<summary><strong>slack</strong></summary>

| Key                         | Default   | Description                                                               |
| --------------------------- | --------- | ------------------------------------------------------------------------- |
| `botToken`                  | required  | Bot user OAuth token                                                      |
| `appToken`                  | required  | App-level token for Socket Mode                                           |
| `requireMention`            | `true`    | Only respond in channels when the bot is `@mentioned`; DMs always respond |
| `coalesce.debounceMs`       | `3000`    | Wait N ms after last message before dispatching (group channels)          |
| `coalesce.bypassDms`        | `true`    | Skip debouncing for DMs                                                   |
| `channels`                  | `["*"]`   | Restrict to specific channel IDs, or `"*"` for all                        |
| `quietHours.enabled`        | `false`   | Silence the bot during specified hours                                    |
| `quietHours.start`          | `"23:00"` | Start of quiet period (HH:MM)                                             |
| `quietHours.end`            | `"08:00"` | End of quiet period (HH:MM), can wrap midnight                            |
| `quietHours.timezone`       | `"UTC"`   | IANA timezone for quiet hours                                             |

</details>

<details>
<summary><strong>agents</strong></summary>

Each agent is scoped to specific channels. Multiple agents are matched in order, first match wins.

| Key                | Default                   | Description                                           |
| ------------------ | ------------------------- | ----------------------------------------------------- |
| `id`               | required                  | Unique agent identifier                               |
| `name`             | required                  | Display name                                          |
| `provider`         | `"claude"`                | Provider CLI to use                                   |
| `model`            | `"sonnet"`                | Primary model                                         |
| `fallbackModel`    | none                      | Optional fallback when primary is unavailable         |
| `maxTurns`         | `50`                      | Max conversation turns per session                    |
| `systemPrompt`     | none                      | Instructions prepended to every session               |
| `channels`         | `["*"]`                   | Channel IDs this agent handles, or `"*"` for all      |
| `processTimeoutMs` | inherits `sessions` value | Per-agent subprocess timeout override in milliseconds |

</details>

<details>
<summary><strong>sessions</strong></summary>

| Key                | Default  | Description                                        |
| ------------------ | -------- | -------------------------------------------------- |
| `ttlHours`         | `24`     | Session lifetime in hours (resets on each message)  |
| `maxConcurrent`    | `5`      | Max simultaneous agent processes                    |
| `processTimeoutMs` | `300000` | Per-request timeout in milliseconds                 |

</details>

<details>
<summary><strong>browser</strong></summary>

| Key             | Default         | Description                                    |
| --------------- | --------------- | ---------------------------------------------- |
| `enabled`       | `false`       | Enable Playwright MCP for the agent            |
| `mcpConfigPath` | `null`        | Path to your MCP config (relative or absolute) |
| `vncPort`       | `5900`        | VNC server port                                |
| `novncPort`     | `6080`        | Upstream noVNC WebSocket port                  |
| `novncHost`     | `"localhost"` | Upstream noVNC host (e.g. `"vm"` in Docker)    |

</details>

<details>
<summary><strong>birds</strong></summary>

| Key           | Default | Description                                   |
| ------------- | ------- | --------------------------------------------- |
| `maxAttempts` | `3`     | Max job attempts before a bird stops retrying |

Each bird also supports per-bird `active_hours_start` and `active_hours_end` (HH:MM format), set via CLI `--active-hours 09:00-17:00` or the API. When configured, the bird only runs during that time window in its configured timezone. Wrap-around windows (e.g. `22:00-06:00`) are supported.

</details>

<details>
<summary><strong>database</strong></summary>

| Key                     | Default | Description                                            |
| ----------------------- | ------- | ------------------------------------------------------ |
| `retentionDays` | `30` | How long to keep messages, flight logs, jobs, and logs |

</details>

<details>
<summary><strong>web</strong></summary>

| Key          | Default       | Description                                                    |
| ------------ | ------------- | -------------------------------------------------------------- |
| `enabled`    | `true`        | Enable the web dashboard and API                               |
| `host`       | `"127.0.0.1"` | Bind address (`0.0.0.0` for Docker/remote)                     |
| `port`       | `18800`       | Web UI and REST API port                                       |
| `authToken`  | none          | Bearer token for API auth (optional but recommended)           |
| `corsOrigin` | none          | Allowed origin for CORS headers (for cross-origin SPA hosting) |

</details>

### Environment variables

Values in config can reference environment variables using `"env:VAR_NAME"`. Additionally:

| Variable                      | Description                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN`             | Bot user OAuth token                                                                                                |
| `SLACK_APP_TOKEN`             | App-level token for Socket Mode                                                                                     |
| `BROWSERBIRD_AUTH_TOKEN`      | Web UI auth token                                                                                                   |
| `ANTHROPIC_API_KEY`           | Agent auth via API key (recommended). Pay-per-token through [console.anthropic.com](https://console.anthropic.com) |
| `CLAUDE_CODE_OAUTH_TOKEN`     | Agent auth via OAuth token (personal use). Uses your Claude Pro/Max subscription. See note below                   |
| `BROWSERBIRD_RETENTION_DAYS`  | Override `database.retentionDays`                                                                                   |
| `BROWSERBIRD_MCP_CONFIG_PATH` | Override `browser.mcpConfigPath`                                                                                    |
| `NO_COLOR`                    | Disable colored output                                                                                              |

> [!NOTE]
> **Agent authentication:** `ANTHROPIC_API_KEY` (pay-per-token) is required for shared or commercial deployments per Anthropic's Consumer ToS. `CLAUDE_CODE_OAUTH_TOKEN` is fine for personal self-hosted use. Set one or the other, not both.

## CLI

```bash
browserbird                        # Start the daemon
browserbird --config ./my.json     # Use a specific config file
browserbird doctor                 # Check agent CLI and Node.js version
```

### Birds

```bash
browserbird birds list
browserbird birds add "0 9 * * 1-5" "Summarize what happened in #general yesterday" --channel C123456
browserbird birds add "@daily" "Check the status page and report any incidents" --agent code-reviewer
browserbird birds add "*/30 * * * *" "Monitor uptime" --active-hours "09:00-17:00"
browserbird birds edit <id> --schedule "0 8 * * *" --agent support-bot
browserbird birds edit <id> --active-hours "08:00-22:00"
browserbird birds enable <id>
browserbird birds disable <id>
browserbird birds remove <id>
browserbird birds fly <id>
browserbird birds logs <id>
```

Supported formats: standard 5-field cron (`* * * * *`) and macros (`@daily`, `@hourly`, `@weekly`, `@monthly`).

### Sessions

```bash
browserbird sessions list
browserbird sessions logs <id>
```

### Settings

```bash
browserbird settings
browserbird settings --config ./my.json
```

### Database

```bash
browserbird database logs
browserbird database logs --level warn --limit 50
browserbird database jobs
browserbird database jobs stats
browserbird database jobs retry <id>
browserbird database jobs retry --all-failed
browserbird database jobs delete <id>
browserbird database jobs clear --completed
browserbird database jobs clear --failed
```

## Web Dashboard

Runs at `http://localhost:18800` by default. Real-time updates via SSE.

| Page         | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| **Status**   | System stats, active sessions overview                                              |
| **Sessions** | Agent sessions with message counts, clickable to inspect full history               |
| **Birds**    | Scheduled birds: create, edit, enable/disable, trigger, inline flight history       |
| **Flights**  | Flight log across all birds, with status filter and per-flight retry                |
| **Browser**  | Live noVNC viewer (Docker only)                                                     |
| **Settings** | Config (agents, sessions, slack, browser) + Database tab (job queue, cleanup, logs) |

## License

[FSL-1.1-MIT](LICENSE), source available, converts to MIT after two years.

> [!NOTE]
> This project was built with assistance from LLMs. Human review and guidance provided throughout.
