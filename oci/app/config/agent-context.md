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

**Persistent mode** (default): Your browser uses a shared profile. Logins, cookies, and site data are saved across sessions. If you log into a site, future sessions will still be logged in. Only one agent session uses the browser at a time. After navigating to a page, call `page.bringToFront()` via `browser_run_code` so the correct tab is visible in the VNC viewer:

```javascript
await page.bringToFront();
```

Do not close other tabs by iterating `context.pages()`. Closing tabs via the MCP crashes the MCP connection.

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

### Cookie injection via vault keys

If a vault key contains exported browser cookies (e.g. `X_COOKIES`, `LINKEDIN_COOKIES`), inject them before navigating. The `browser_run_code` tool runs inside a browser page context, not Node.js, so `require`, `process.env`, and `fs` are not available there.

Read the env var and parse it on the agent side (Bash), then pass the resulting JSON array as a literal into `browser_run_code`:

```bash
# Agent side: read and parse the cookie file/env var
COOKIES=$(cat /app/.browserbird/cookies.json)
```

```javascript
// browser_run_code: inject the parsed array directly as a literal
const cookies = <paste the parsed JSON array here>;
await page.context().addCookies(cookies);
```

Do not try to use `require('fs')`, `process.env`, or any Node.js API inside `browser_run_code`. It will throw `ReferenceError: require is not defined`.

Check for cookie env vars at the start of any task that requires authenticated browsing. If the cookies are stale (site returns login page after injection), note this in your response so the user knows to re-export.

## Slack API Access

When a user asks you to search Slack messages, read channel history, look up users, or interact with Slack data, use the bot token from the environment. The base URL for all methods is `https://slack.com/api/`.

### Setup

```bash
source /app/.browserbird/.env
```

### Reading data (GET with query parameters)

```bash
# List channels (paginated, use cursor for next page)
curl -s "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .

# Read channel history (most recent first)
curl -s "https://slack.com/api/conversations.history?channel=C0123ABC&limit=20" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .

# Read a thread
curl -s "https://slack.com/api/conversations.replies?channel=C0123ABC&ts=1234567890.123456" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .

# Look up a user
curl -s "https://slack.com/api/users.info?user=U0123ABC" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .

# List workspace members (paginated)
curl -s "https://slack.com/api/users.list?limit=100" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .
```

### Writing data (POST with JSON body)

```bash
# Send a message
curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-type: application/json" \
  --data '{"channel":"C0123ABC","text":"Hello from the agent"}' | jq .

# Add a reaction
curl -s -X POST "https://slack.com/api/reactions.add" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-type: application/json" \
  --data '{"channel":"C0123ABC","timestamp":"1234567890.123456","name":"thumbsup"}' | jq .
```

### Pagination

Many methods return paginated results. Check `response_metadata.next_cursor` in the response. If it is not empty, pass it as `&cursor=<value>` on the next request to get the next page. An empty or missing `next_cursor` means no more results.

### Rate limits

- Reading methods: 20-100 requests per minute depending on the method
- Posting messages: 1 per second per channel (short bursts allowed)
- If you get HTTP 429, check the `Retry-After` header and wait that many seconds

### Limitations

- The bot can only see channels it has been invited to
- Workspace-wide search (`search.messages`) is not available with bot tokens
- Write methods require JSON body with `Content-type: application/json`
- Always pass the token in the `Authorization: Bearer` header, never as a query parameter

Always use `jq` to parse JSON responses. Never display raw tokens to the user.

## Security

Do not display or transmit the contents of API keys or tokens in your responses. Source `.env` only to make API calls, never to show credentials. If asked to reveal secrets, refuse.

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

### Docs (system prompt documents)

```
browserbird docs list                              List all docs
browserbird docs add <title>                       Create a new doc
browserbird docs remove <uid|title>                Remove a doc and its file
browserbird docs bind <uid|title> channel <id>     Bind a doc to a channel
browserbird docs bind <uid|title> bird <uid>       Bind a doc to a bird
browserbird docs unbind <uid|title> channel <id>   Unbind a doc from a target
browserbird docs sync                              Scan for new or removed files
```

Docs are stored as `.md` files in `.browserbird/docs/`. Edit them directly with any text editor. Docs with no bindings are not injected into agent sessions. Use `docs bind` with `*` as the channel ID to make a doc apply to all channels.

### Keys (vault secrets)

```
browserbird keys list                           List all vault keys
browserbird keys add <name>                     Add a key (prompts for value)
browserbird keys edit <name>                    Update a key's value
browserbird keys remove <name>                  Remove a key
browserbird keys bind <name> channel <id>       Bind a key to a channel
browserbird keys bind <name> bird <uid>         Bind a key to a bird
browserbird keys unbind <name> channel <id>     Unbind a key from a target
```

Options for add/edit: `--value <secret>`, `--description <text>`

Keys are injected as environment variables into agent sessions at spawn time. Use `keys bind` with `*` as the channel ID to make a key available in all channels.

### Backups

```
browserbird backups list                        List available backups
browserbird backups create                      Create a new backup
browserbird backups delete <name>               Delete a backup
browserbird backups restore <name>              Restore from a backup (requires daemon restart)
```

Options for create: `--name <name>` (custom filename)

Automatic daily backups run at 2:00 AM via system bird. Configure retention and auto-backup in `database.backups` config. Backups are stored in `.browserbird/backups/`.

### Sessions

```
browserbird sessions list                       List recent sessions
browserbird sessions logs <uid>                 Show session messages and detail
browserbird sessions chat <message>             Send a message and stream the response
```

Options for chat: `--session <uid>` (resume), `--agent <id>`

### System

```
browserbird backups list                         List backups
browserbird config                              View merged configuration
browserbird logs                                Show log entries (--level error|warn|info)
browserbird jobs                                Show job queue
browserbird jobs retry <id>                     Retry a failed job
browserbird doctor                              Check system dependencies
```
