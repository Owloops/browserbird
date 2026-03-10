# VHS Demo for BrowserBird
# https://github.com/charmbracelet/vhs
#
# Prerequisites:
#   1. Start the daemon in another terminal: browserbird
#   2. Set ANTHROPIC_API_KEY
#   3. Run from the project root: vhs assets/demo.tape

Output assets/demo.gif
Set FontSize 16
Set Width 1280
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20
Set Shell bash

# Clean prompt (.bashrc overrides Env PS1, so set it inside the shell)
Hide
Type 'alias browserbird="./bin/browserbird"' Enter
Type "clear" Enter
Sleep 500ms
Show

# --- Help ---

Type "browserbird --help"
Sleep 300ms
Enter
Sleep 3s

# --- Create a bird ---

Type `browserbird birds add "0 9 * * 1-5" "Check HN front page for AI agent news, summarize top 3"`
Sleep 300ms
Enter
Sleep 3s

# --- List birds ---

Type "browserbird birds list"
Sleep 300ms
Enter
Sleep 3s

# --- Grab UID into a shell variable (hidden) ---

Hide
Type `BIRD=$(browserbird birds list --json 2>/dev/null | jq -r '.[-1].uid')`
Enter
Sleep 2s
Show

# --- Trigger the bird ---

Type "browserbird birds fly $BIRD"
Sleep 300ms
Enter
Sleep 3s

# --- Wait for the agent to complete ---

Type "# waiting for the agent to finish..."
Enter
Sleep 15s

# --- Check flight results ---

Type "browserbird birds flights $BIRD"
Sleep 300ms
Enter
Sleep 5s

# --- Show full result via JSON ---

Type "browserbird birds flights $BIRD --json | jq '.[0].result'"
Sleep 300ms
Enter
Sleep 5s

# --- Cleanup (hidden) ---

Hide
Type "browserbird birds remove $BIRD 2>/dev/null"
Enter
Sleep 1s
Show
