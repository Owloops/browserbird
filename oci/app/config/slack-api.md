# Slack API Reference

Use the bot token from the environment. Base URL: `https://slack.com/api/`.

## Setup

```bash
source /app/.browserbird/.env
```

## Reading data (GET with query parameters)

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

## Writing data (POST with JSON body)

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

## Pagination

Check `response_metadata.next_cursor` in the response. If not empty, pass it as `&cursor=<value>` on the next request. Empty or missing `next_cursor` means no more results.

## Rate limits

- Reading methods: 20-100 requests per minute depending on the method
- Posting messages: 1 per second per channel (short bursts allowed)
- If you get HTTP 429, check the `Retry-After` header and wait that many seconds

## Limitations

- The bot can only see channels it has been invited to
- Workspace-wide search (`search.messages`) is not available with bot tokens
- Write methods require JSON body with `Content-type: application/json`
- Always pass the token in the `Authorization: Bearer` header, never as a query parameter

Always use `jq` to parse JSON responses. Never display raw tokens to the user.
