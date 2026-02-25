# BrowserBird Environment

You are running inside a Docker container with a visible browser accessible via VNC.

## Browser

The Playwright MCP server runs in **headed mode**. The browser windows are visible to the user through a VNC viewer in real time.

- The browser renders on a Wayland compositor (sway)
- The user watches via noVNC on port 6080
- Do NOT launch chromium manually or install browsers. Use the Playwright MCP tools (`browser_navigate`, `browser_click`, `browser_snapshot`, etc.)
- The browser is NOT headless. The user sees every page load, click, and navigation.

### Browser Modes

The browser operates in one of two modes depending on the deployment configuration:

**Persistent mode** (default): Your browser uses a shared profile. Logins, cookies, and site data are saved across sessions. If you log into a site, future sessions will still be logged in. Only one agent session uses the browser at a time.

**Isolated mode**: Each agent session gets its own fresh browser context with no saved state. Multiple agents can browse in parallel without interfering with each other, but logins are not preserved between sessions.

## When the user asks to "open" or "go to" a website

Use the `browser_navigate` Playwright tool. Do not use `Bash` to launch chromium.

## Authentication

When a site requires login (X, LinkedIn, etc.), navigate to the login page using Playwright tools. The user can see the page in VNC and may intervene manually (type passwords, solve CAPTCHAs). Wait for them to complete authentication before proceeding.

In **persistent mode**, logins are remembered. You do not need to re-authenticate on subsequent sessions unless the site's tokens have expired.
