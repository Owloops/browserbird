# BrowserBird CLI Reference

CLI location: `./bin/browserbird`

## Birds (scheduled tasks)

```
browserbird birds list                          List all birds
browserbird birds add [options]                  Create a bird (--name, --schedule, --prompt, --channel, --agent)
browserbird birds edit <uid> [options]          Edit a bird (--name, --schedule, --prompt, --channel, --agent)
browserbird birds remove <uid>                  Delete a bird
browserbird birds enable <uid>                  Enable a bird
browserbird birds disable <uid>                 Disable a bird
browserbird birds fly <uid>                     Trigger a bird immediately
browserbird birds flights <uid>                 Show flight history
```

Options for add/edit: `--channel <id>`, `--agent <id>`, `--active-hours 09:00-17:00`

All bird schedules use the global `timezone` from the config file (default: UTC).

Schedule format: standard 5-field cron (`0 9 * * 1-5`) or macros (`@daily`, `@hourly`, `@weekly`, `@monthly`).

## Docs (system prompt documents)

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

## Keys (vault secrets)

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

## Backups

```
browserbird backups list                        List available backups
browserbird backups create                      Create a new backup
browserbird backups delete <name>               Delete a backup
browserbird backups restore <name>              Restore from a backup (requires daemon restart)
```

Options for create: `--name <name>` (custom filename)

Automatic daily backups run at 2:00 AM via system bird. Configure retention and auto-backup in `database.backups` config. Backups are stored in `.browserbird/backups/`.

## Sessions

```
browserbird sessions list                       List recent sessions
browserbird sessions logs <uid>                 Show session messages and detail
browserbird sessions chat <message>             Send a message and stream the response
```

Options for chat: `--session <uid>` (resume), `--agent <id>`

## System

```
browserbird config                              View merged configuration
browserbird logs                                Show log entries (--level error|warn|info)
browserbird jobs                                Show job queue
browserbird jobs retry <id>                     Retry a failed job
browserbird doctor                              Check system dependencies
```
