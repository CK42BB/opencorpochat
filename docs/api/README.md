# API overview

Everything the web client does goes through the same public API, so anything a person can do in the UI, a bot or script can do too.

- **REST**: `https://<your-server>/api/v1/...` (JSON). The full machine-readable reference is served by every instance at **`/api/v1/openapi.json`** (OpenAPI 3.1). Load it into any OpenAPI viewer or client generator.
- **Realtime**: a WebSocket at `/api/v1/ws`. See [realtime.md](realtime.md).

## Authentication

| Client        | How                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app       | Session cookie `ocpc_session`. Cookie-authenticated requests other than `GET` must include the header `X-OCPC-CSRF: 1`.                     |
| Scripts, bots | `Authorization: Bearer <token>`. Create a personal token under **Settings → Integrations**, or a bot (admins) whose token posts as the bot. |

Tokens carry scopes:

- `read` covers `GET` requests.
- `write` covers everything else, and implies `read`.
- `admin` is required for admin endpoints and can only be issued to admins.

```sh
TOKEN=ocpc_xxx
curl -H "Authorization: Bearer $TOKEN" https://chat.example.com/api/v1/me
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"body":"Deploy finished :rocket:"}' \
  https://chat.example.com/api/v1/channels/<channelId>/messages
```

## Errors

Errors use HTTP status codes with a JSON body:

```json
{ "error": "forbidden", "message": "You do not have permission to do that" }
```

The `error` codes are `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_large`, `rate_limited`, `csrf` and `internal`. Validation errors include `details` listing the failing fields.

## Incoming webhooks

Incoming webhooks need no token. The secret is part of the URL.

```sh
curl -X POST -H 'content-type: application/json' \
  -d '{"text":"Build #42 passed ✅", "username":"CI"}' \
  https://chat.example.com/api/v1/hooks/<id>/<secret>
```

The webhook accepts `text` (Markdown), an optional `username` that overrides the display name, and an optional `attachments[]` array with `pretext`, `title`, `title_link`, `text` and `fallback` fields. Many existing tools already send this widely used shape.

## Outgoing webhooks and custom slash commands

The server sends a JSON `POST` to your URL and signs each request:

```
X-OCPC-Timestamp: 1767225600
X-OCPC-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```

Verify the signature and reject timestamps older than about 5 minutes. A minimal verifier is in [`examples/webhook-receiver.mjs`](../../examples/webhook-receiver.mjs).

- **Outgoing webhook payload:** `{event, webhook_id, channel_id, channel_name, message_id, thread_root_id, user_id, user_name, text, trigger_word, timestamp}`. To post a reply, respond with `{"text": "..."}`.
- **Slash command payload:** `{command, text, user_id, user_name, channel_id, channel_name, thread_root_id}`. Respond with `{"text": "...", "response_type": "ephemeral" | "in_channel", "username"?: "..."}`.

## Rate limits

Defaults:

- 600 requests per minute per IP overall.
- Login and registration: 10 per 5 minutes.
- Posting messages: 60 per minute.
- Incoming webhooks: 60 per minute.

Exceeding a limit returns `429` with a `retry-after` header.
