<p align="center">
  <img src="apps/web/public/icon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">OpenCorpoChat</h1>

<p align="center">
  <strong>Self-hosted, open-source team chat for organizations of up to ~200 people.</strong><br>
  Channels, DMs, threads, search, files, voice &amp; video calls, integrations and SSO, in one container you own.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/opencorpochat/opencorpochat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/opencorpochat/opencorpochat/actions/workflows/ci.yml/badge.svg"></a>
</p>

---

## Why

Small organizations shouldn't pay a per-seat tax, every month, forever, to talk to each other. OpenCorpoChat gives you everything a team needs day to day:

- No paid tier.
- No feature flags held back for an "enterprise" plan.
- No telemetry.

Run it on a $10 VPS or a spare office machine.

- **Complete:** messaging, threads, search, files, calls, bots, SSO, 2FA, guests, an admin console and compliance export are all included.
- **Easy to run:** one process with SQLite works out of the box. PostgreSQL, S3, SMTP, TURN and LiveKit are optional upgrades.
- **Easy to fork:** it's TypeScript end to end, built on boring libraries, with one folder per feature. See [docs/architecture.md](docs/architecture.md).
- **Yours:** export everything at any time in a documented format. The project is AGPL-3.0, so it stays free for everyone.

## Features

| | |
|---|---|
| **Conversations** | Public and private channels, DMs and group DMs, announcement (read-only) channels, default channels, archiving, starring, muting, custom sidebar sections |
| **Messaging** | Markdown, code highlighting, threads (with "also send to channel"), emoji reactions and custom emoji, @mentions, @here/@channel and @group mentions, edits, deletes, pins, saved items, polls, forwarding, link previews, scheduled messages, reminders, drafts, typing indicators |
| **Files** | Drag-and-drop or paste uploads with image, video, audio and PDF previews, stored on local disk or any S3-compatible store |
| **Search** | Full-text search with `in:`, `from:`, `before:`, `after:`, `has:file`, `is:thread` and more, plus a Ctrl/⌘-K quick switcher |
| **Notifications** | Unread and mention badges, activity feed, desktop notifications and Web Push (installable PWA), email digests for missed messages, keywords, Do Not Disturb and working-hours schedule, statuses |
| **Calls** | 1:1 calls and channel huddles with screen sharing over WebRTC, TURN support, an optional LiveKit SFU for larger meetings, and a built-in connection diagnostics page |
| **Integrations** | REST API with an OpenAPI spec, realtime WebSocket API, bot accounts, scoped API tokens, incoming and outgoing webhooks (HMAC-signed), custom slash commands |
| **Identity & security** | Invite links, guest accounts, OpenID Connect SSO (Google, Microsoft Entra, Okta, Keycloak, Authentik…), TOTP 2FA (can be required org-wide), session management, rate limiting, strict CSP |
| **Admin & compliance** | Admin console, usage stats (computed locally), audit log, retention policies, per-person data export and erasure, full org export, import from Slack-format export archives, backup and restore CLI |
| **Accessibility & i18n** | Keyboard-first (press `?`), screen-reader live regions, light and dark themes, compact mode, translation-ready UI |

## Quick start

### Docker (recommended)

```sh
docker run -d --name ocpc -p 8080:8080 -v ocpc-data:/data \
  -e OCPC_PUBLIC_URL=http://localhost:8080 \
  ghcr.io/opencorpochat/opencorpochat:latest
```

Open http://localhost:8080. The setup wizard creates your organization and owner account.

For production with automatic HTTPS, use [`deploy/compose/docker-compose.yml`](deploy/compose/docker-compose.yml), which runs the app behind Caddy. The full stack (PostgreSQL, MinIO, coturn, LiveKit) is in [`docker-compose.full.yml`](deploy/compose/docker-compose.full.yml).

### From source

Requires Node.js ≥ 22.12 and pnpm 10.

```sh
pnpm install
pnpm build
OCPC_PUBLIC_URL=http://localhost:8080 pnpm start
```

The **[Admin guide](docs/admin-guide.md)** covers HTTPS, SSO, email, TURN, backups, upgrades and every configuration option.

## Development

```sh
pnpm install
pnpm dev        # API on :8080, web app with hot reload on http://localhost:5173
pnpm test       # unit + integration tests (SQLite; set DATABASE_URL to run against Postgres)
pnpm typecheck && pnpm lint
```

```
apps/server     Fastify API, WebSocket gateway, jobs, `ocpc` CLI   (src/modules/<feature>/)
apps/web        React PWA                                           (src/{components,pages,settings,admin,calls})
packages/shared Zod schemas, types, realtime events, permissions — shared by both
deploy/         Dockerfile, Compose, Caddy/nginx/coturn/LiveKit/systemd examples
docs/           PRD, architecture, admin guide, API, ADRs
```

## API

Every instance serves its OpenAPI document at `/api/v1/openapi.json`. Start with [docs/api](docs/api/README.md). There are runnable examples for a [bot](examples/bot.mjs) and a [webhook receiver](examples/webhook-receiver.mjs).

```sh
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"body":"Hello from a script 👋"}' https://chat.example.com/api/v1/channels/$CHANNEL/messages
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), which covers dev setup, coding standards and the **DCO sign-off** (`git commit -s`). Also read our [Code of Conduct](CODE_OF_CONDUCT.md) and [governance](GOVERNANCE.md).

To report a vulnerability, follow [SECURITY.md](SECURITY.md). Please don't open a public issue.

## License & trademarks

OpenCorpoChat is free software, licensed under the **[GNU Affero General Public License v3.0](LICENSE)**. If you run a modified version for others over a network, you must offer them its source code. Set `OCPC_SOURCE_URL` to point to your fork; the link is shown in the app's About dialog.

OpenCorpoChat is an independent project. It is not affiliated with or endorsed by any other chat vendor. Product names such as Slack® and Microsoft Teams® are trademarks of their respective owners. They are mentioned only to describe compatibility, such as importing a Slack-format export. See [NOTICE](NOTICE).
