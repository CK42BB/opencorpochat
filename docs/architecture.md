# Architecture overview

This is the contributor's map of OpenCorpoChat. For the reasoning behind the major choices, see the [ADRs](adr/). For the product requirements, see the [PRD](PRD.md).

## The big picture

```
┌──────────────────────────── Browser / PWA ─────────────────────────────┐
│  React + Vite SPA  ── REST (fetch) ──┐      ┌── WebSocket (events) ──┐ │
│  WebRTC media  ◀────────── P2P / TURN / LiveKit SFU ─────────────────▶ │
└──────────────────────────────────────┼──────┼─────────────────────────┘
                                       ▼      ▼
                  ┌──────────────── Node.js server (Fastify) ───────────────┐
                  │ HTTP API · WS gateway · call signaling · jobs scheduler │
                  │ authz/policy · search · webhooks · push · email         │
                  └───────┬───────────────┬─────────────────┬───────────────┘
                          ▼               ▼                 ▼
                 SQLite (default)   Local disk (default)  SMTP / OIDC /
                 or PostgreSQL      or S3-compatible      Web Push (optional)
```

- **One process.** The server serves the API, the WebSocket gateway, background jobs, _and_ the built web app. There's no Redis, message broker or search cluster.
- **One language.** Everything is TypeScript. Request and response shapes are Zod schemas in `packages/shared`, used by both the server (validation) and the client (types).
- **The API is the product.** The web client only uses the public REST and WebSocket API, so bots and integrations can do anything the UI can.

## Packages

| Path              | Contents                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Zod schemas, realtime event types, permission constants, small pure utilities (mention parsing, ULID helpers). No Node- or browser-only APIs. |
| `apps/server`     | Fastify server, WebSocket gateway, background jobs, `ocpc` CLI. Entry points: `src/index.ts` (server) and `src/cli.ts` (CLI).                 |
| `apps/web`        | React SPA. In development, Vite runs on :5173 and proxies `/api` to :8080. In production, the server serves `apps/web/dist`.                  |

## Server structure

```
apps/server/src/
├── index.ts            # boot: config → db/migrations → app → listen
├── cli.ts              # ocpc command-line tool
├── config.ts           # env parsing & validation (fails fast)
├── app.ts              # Fastify instance, plugins, module registration
├── db/                 # Kysely setup, dialect selection, migrations
├── lib/                # cross-cutting helpers (ids, crypto, errors, rate limit)
├── realtime/           # WebSocket gateway, connection registry, fan-out
├── jobs/               # in-process scheduler (reminders, retention, digests…)
└── modules/
    ├── authz/          # can(user, action, resource) — the single policy point
    ├── auth/           # passwords, sessions, invites, TOTP, OIDC
    ├── users/
    ├── channels/
    ├── messages/       # messages, threads, reactions, pins, saved items
    ├── files/          # upload/download, storage backends (local, S3)
    ├── search/         # SearchProvider: SQLite FTS5 / Postgres tsvector
    ├── notifications/  # in-app, Web Push, email
    ├── calls/          # signaling, TURN credentials, LiveKit tokens
    ├── integrations/   # API tokens, bots, webhooks, slash commands
    └── admin/          # settings, audit log, retention, export/import
```

Each module owns its **routes**, **service** and **queries**. Other modules call its service functions, never its tables directly. This keeps every feature in one folder, so a fork can change or remove one with confidence.

## Request lifecycle

1. Fastify receives the request. The auth hook resolves the caller from the session cookie (browser) or `Authorization: Bearer` token (bots and API tokens).
2. The route validates the input against a shared Zod schema.
3. The route asks `authz.can(user, action, resource)`. If the answer is no, it returns 403, or 404 when revealing the resource's existence would leak information.
4. The service performs the change in a DB transaction.
5. The service publishes a realtime event. The gateway fans it out to connected sockets of users allowed to see it.
6. Side effects (push, email, outgoing webhooks, search indexing where not trigger-based) are queued to the in-process job runner, so the HTTP response isn't held up.

## Realtime protocol

- The client connects to `GET /api/v1/ws` using its session cookie or a bearer token.
- The server sends `hello { sessionId, serverTime }`.
- Server events look like `{ type, seq, data }`, where `seq` increases with each event on that connection.
- **Event types:** `message.created|updated|deleted`, `reaction.added|removed`, `channel.created|updated|archived|member_joined|member_left`, `read.updated`, `typing`, `presence`, `user.updated`, `pin.added|removed`, `call.*`, `notification`.
- **Client → server frames:** `typing`, `presence.ping`, `call.signal`.
- **After a reconnect**, the client calls `GET /api/v1/sync?since=<timestamp>` to fill any gap. Events aren't replayed over the socket.

The fan-out is in-memory, which suits the single-node design. A `PubSub` interface exists so a fork can add Redis or Postgres `LISTEN/NOTIFY` to run several nodes.

## Data

- **IDs** are ULIDs. They sort by time, which makes them good for cursor pagination ("messages before X").
- **Migrations** live in `apps/server/src/db/migrations/`, written with Kysely's schema builder so the same migration runs on SQLite and Postgres. They run automatically at startup in a transaction. They only go forward and must never be edited after release.
- **Dialect differences** stay behind small interfaces. The main ones are full-text search (FTS5 vs `tsvector`) and a few date functions.

See PRD §8.4 for the core tables.

## Authorization

All permission logic lives in `modules/authz` as pure functions with full unit-test coverage. The key rules:

- Roles are `owner` > `admin` > `member` > `guest`, plus `bot`.
- **Guests** see only channels they were explicitly added to: no directory, no user list, and no search results outside those channels.
- **Private channels and DMs** are invisible to non-members. Asking for one returns 404, not 403.
- **Announcement (read-only) channels** accept posts only from admins and owners.

## Calls

Signaling (join/leave/offer/answer/ICE) travels over the existing WebSocket. The server only relays messages and tracks who is in each call. Media goes peer-to-peer (mesh, up to about 6 people), through a TURN relay when direct connection isn't possible, or through LiveKit when configured. The UI talks to a `CallTransport` interface with two implementations: `MeshTransport` and `LiveKitTransport`. See [ADR 0005](adr/0005-webrtc-mesh-with-optional-livekit.md).

## Web client

- **Server data** (channels, messages, users) is cached with TanStack Query. Realtime events update that cache directly instead of refetching.
- **UI and realtime-only state** (presence, typing, current call) lives in small Zustand stores.
- **Styling** uses CSS modules and design tokens (CSS custom properties) for themes. A fork can rebrand by changing the tokens.
- **Rendering:** messages are stored as raw text and rendered from a safe Markdown subset with sanitization. HTML from users is never trusted.
- **i18n:** all strings go through the translation helper.
- **PWA:** a service worker caches the app shell and receives Web Push.

## Where to start

- To add an API endpoint, look at an existing module's `routes.ts` and add the schema to `packages/shared`.
- To add a realtime event, add its type to `packages/shared`, publish it from the service, and handle it in the web client's event reducer.
- To change permissions, edit `modules/authz` and its tests.
