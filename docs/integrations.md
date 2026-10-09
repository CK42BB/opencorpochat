# Integrations cookbook

Copy-paste recipes for connecting your tools. For the reference material, including authentication, scopes, payloads and rate limits, see the [API overview](api/README.md) and [realtime API](api/realtime.md).

| I want to…                            | Use                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Post into a channel from another tool | [Incoming webhook](#post-ci-results-from-github-actions) (no code needed) |
| React to messages in a channel        | [Outgoing webhook](#outgoing-webhooks-and-signature-verification)         |
| Add a `/command`                      | [Custom slash command](#a-custom-slash-command)                           |
| Build an interactive bot              | [Bot account + WebSocket](#a-bot-that-listens-and-replies)                |
| Script against your own account       | [Personal token](#scripts-with-a-personal-token)                          |

## Post CI results from GitHub Actions

1. **Create the webhook:** in the channel, go to **Settings → Integrations → Incoming webhooks → New webhook**, pick the channel, and copy the URL. It is shown only once.
2. **Store it as a secret:** in GitHub, go to **Settings → Secrets → Actions** and add `OCPC_WEBHOOK_URL`.
3. **Add a final step to your workflow:**

```yaml
- name: Notify chat
  if: always()
  env:
    OCPC_WEBHOOK_URL: ${{ secrets.OCPC_WEBHOOK_URL }}
  run: |
    STATUS="${{ job.status }}"
    ICON=$([ "$STATUS" = "success" ] && echo "✅" || echo "❌")
    curl -sS -X POST -H 'content-type: application/json' \
      -d "{\"username\":\"CI\",\"text\":\"$ICON **${{ github.repository }}** \`${{ github.ref_name }}\` — $STATUS ([run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}))\"}" \
      "$OCPC_WEBHOOK_URL"
```

The `text` field supports Markdown, and `username` overrides the display name. Many tools that already support "Slack-compatible incoming webhooks" work unchanged, because the `{"text": "..."}` and `attachments[]` shape is accepted.

## An uptime alert

A cron job that checks a site and posts only when the check fails:

```sh
*/5 * * * * curl -fsS --max-time 10 https://example.com/health >/dev/null || \
  curl -sS -X POST -H 'content-type: application/json' \
  -d '{"username":"Uptime","text":"🚨 example.com health check failed"}' "$OCPC_WEBHOOK_URL"
```

## Outgoing webhooks and signature verification

Admins can create an **outgoing webhook** (**Settings → Integrations**) with a URL and optional trigger words such as `!deploy`. Each matching message is POSTed to your URL as JSON:

```json
{
  "event": "message.created",
  "channel_id": "…",
  "channel_name": "ops",
  "message_id": "…",
  "thread_root_id": null,
  "user_id": "…",
  "user_name": "sam",
  "text": "!deploy api",
  "trigger_word": "!deploy",
  "timestamp": "2026-10-09T12:00:00.000Z"
}
```

To post a reply, respond with `{"text": "..."}`. Every request is signed:

```
X-OCPC-Timestamp: 1767225600
X-OCPC-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```

Verify the signature in Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret, timestamp, rawBody, signature) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay guard
  const expected =
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
```

…or in Python:

```python
import hmac, hashlib, time
def verify(secret: str, ts: str, raw_body: bytes, sig: str) -> bool:
    if abs(time.time() - int(ts)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
```

## A custom slash command

Admins register commands under **Settings → Integrations → Slash commands**, for example `/deploy` with URL `https://ops.example.com/ocpc`. The server POSTs:

```json
{
  "command": "/deploy",
  "text": "staging",
  "user_id": "…",
  "user_name": "sam",
  "channel_id": "…",
  "channel_name": "ops",
  "thread_root_id": null
}
```

Your service replies with one of:

- `{"text": "Deploying staging…", "response_type": "ephemeral"}`: only the caller sees it.
- `{"text": "🚀 staging deployed by @sam", "response_type": "in_channel", "username": "Deploy"}`: posted to the channel.

[`examples/webhook-receiver.mjs`](../examples/webhook-receiver.mjs) is a complete, dependency-free receiver that verifies signatures and handles both slash commands and outgoing webhooks:

```sh
OCPC_SECRET=<signing secret shown when you created the command> node examples/webhook-receiver.mjs
```

## A bot that listens and replies

1. An admin creates a bot under **Settings → Integrations → Bots**. You get a token, shown once.
2. Add the bot to the channels it should work in, from the channel's members panel or with `/invite @yourbot`.
3. Run [`examples/bot.mjs`](../examples/bot.mjs). It connects to the realtime API and answers `!ping` with `pong`:

```sh
OCPC_URL=https://chat.example.com OCPC_TOKEN=ocpc_… node examples/bot.mjs
```

Bots authenticate the WebSocket with `?token=` or an `Authorization: Bearer` header. Messages they post show a **BOT** badge.

## Scripts with a personal token

Create a token under **Settings → Integrations → Personal API tokens** and choose its scopes: `read`, `write`, and `admin` (admins only).

```sh
export OCPC=https://chat.example.com TOKEN=ocpc_…

# Who am I?
curl -s -H "Authorization: Bearer $TOKEN" $OCPC/api/v1/me

# List my channels (with unread counts)
curl -s -H "Authorization: Bearer $TOKEN" $OCPC/api/v1/bootstrap | jq '.channels[] | {name, unreadCount}'

# Post a message
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"body":"Weekly report is up 📈"}' $OCPC/api/v1/channels/<channelId>/messages

# Search
curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode 'q=invoice from:@sam' $OCPC/api/v1/search
```

Tokens never need the CSRF header; that only applies to browser cookie sessions.

## Generate a typed API client

Every instance serves its OpenAPI 3.1 document at `/api/v1/openapi.json`:

```sh
# TypeScript types
npx openapi-typescript https://chat.example.com/api/v1/openapi.json -o ocpc-api.d.ts

# Clients in other languages
npx @openapitools/openapi-generator-cli generate \
  -i https://chat.example.com/api/v1/openapi.json -g python -o ./ocpc-client
```
