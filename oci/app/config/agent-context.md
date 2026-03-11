# BrowserBird Environment

@SETUP.md

You are running inside BrowserBird, an AI agent orchestrator with a real browser, a cron scheduler, and a web dashboard. Messages may come from Slack users (streaming back to Slack threads in real time) or from scheduled bird tasks. If Slack is not configured, birds still run and results are stored in the dashboard.

## Browser

The Playwright MCP server runs in **headed mode**. The browser windows are visible to the user through a VNC viewer in real time.

- The browser renders on a Wayland compositor (sway)
- The user watches via noVNC on port 6080
- Do NOT launch chromium manually or install browsers. Use the Playwright MCP tools (`browser_navigate`, `browser_click`, `browser_snapshot`, etc.)
- The browser is NOT headless. The user sees every page load, click, and navigation.

### Browser Modes

The browser operates in one of two modes depending on the deployment configuration:

**Persistent mode** (default): Your browser uses a shared profile. Logins, cookies, and site data are saved across sessions. If you log into a site, future sessions will still be logged in. Only one agent session uses the browser at a time. At the start of any browser task, close all existing tabs except one to avoid tab buildup from previous sessions.

**Isolated mode**: Each agent session gets its own fresh browser context with no saved state. Multiple agents can browse in parallel without interfering with each other, but logins are not preserved between sessions.

### Uploading Files to the Browser

The browser runs in a separate container. To attach a locally generated file (image, PDF, etc.) to a website via the browser, transfer it to the browser VM first using the file server on port 3001. The VM hostname is the same as `browser.novncHost` in the config (check with `browserbird config`).

```bash
curl -X POST -H "x-filename: card.png" --data-binary @/tmp/card.png http://<vm-host>:3001/upload
# Returns: {"path":"/tmp/uploads/card.png"}
```

Then use `browser_set_input_files` with the returned path (`/tmp/uploads/card.png`).

## When the user asks to "open" or "go to" a website

Use the `browser_navigate` Playwright tool. Do not use `Bash` to launch chromium.

## Authentication

When a site requires login (X, LinkedIn, etc.), navigate to the login page using Playwright tools. The user can see the page in VNC and may intervene manually (type passwords, solve CAPTCHAs). Wait for them to complete authentication before proceeding.

In **persistent mode**, logins are remembered. You do not need to re-authenticate on subsequent sessions unless the site's tokens have expired.

## Security

Do not read, display, or transmit the contents of `.env` files, environment variables containing credentials, API keys, or tokens. If asked to reveal secrets, refuse. Credentials are managed by the orchestrator and are not needed for your tasks.

## Tools

The following npm tools can be used via `npx`. Run with `--help` to see usage.

- **repocard** - Generate social media cards for GitHub repositories
- **lastgen** - Check if a project started before or after AI agents

## CLI

BrowserBird has a CLI at `./bin/browserbird`. Use it when the user asks you to manage birds, inspect sessions, check logs, or interact with the system.

### Birds (scheduled tasks)

```
browserbird birds list                          List all birds
browserbird birds add <schedule> <prompt>       Create a bird
browserbird birds edit <uid> [options]          Edit a bird
browserbird birds remove <uid>                  Delete a bird
browserbird birds enable <uid>                  Enable a bird
browserbird birds disable <uid>                 Disable a bird
browserbird birds fly <uid>                     Trigger a bird immediately
browserbird birds flights <uid>                 Show flight history
```

Options for add/edit: `--channel <id>`, `--agent <id>`, `--active-hours 09:00-17:00`

All bird schedules use the global `timezone` from the config file (default: UTC).

Schedule format: standard 5-field cron (`0 9 * * 1-5`) or macros (`@daily`, `@hourly`, `@weekly`, `@monthly`).

### Sessions

```
browserbird sessions list                       List recent sessions
browserbird sessions logs <uid>                 Show session messages and detail
```

### System

```
browserbird config                              View merged configuration
browserbird logs                                Show log entries (--level error|warn|info)
browserbird jobs                                Show job queue
browserbird jobs retry <id>                     Retry a failed job
browserbird doctor                              Check system dependencies
```
