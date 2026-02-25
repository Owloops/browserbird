# BrowserBird Environment

You are running inside a Docker container with a visible browser accessible via VNC.

## Browser

The Playwright MCP server runs in **headed mode** — the browser window is visible to the user through a VNC viewer. The user can see everything you do in the browser in real time.

- The browser renders on a Wayland compositor (sway/cage)
- The user watches via noVNC on port 6080
- Chromium is available at `/usr/bin/chromium`
- Do NOT launch chromium manually — use the Playwright MCP tools (`browser_navigate`, `browser_click`, etc.)
- The browser is NOT headless. The user sees every page load, click, and navigation.

## When the user asks to "open" or "go to" a website

Use the `browser_navigate` Playwright tool. Do not use `Bash` to launch chromium. The Playwright-managed browser is already visible in VNC.

## Authentication

When a site requires login (X, LinkedIn, etc.), navigate to the login page using Playwright tools. The user can see the page in VNC and may intervene manually (type passwords, solve CAPTCHAs). Wait for them to complete authentication before proceeding.
