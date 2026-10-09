# OpenCorpoChat — Product Requirements Document

|              |                                                                      |
| ------------ | -------------------------------------------------------------------- |
| **Status**   | Draft v1.0 — approved for build                                      |
| **Date**     | 2026-10-09                                                           |
| **License**  | AGPL-3.0-only                                                        |
| **Audience** | Maintainers, contributors, and organizations evaluating self-hosting |

---

## 1. Problem

Small organizations (under ~200 people) pay per seat, per month, for team chat. Prices keep rising, they're increasingly bundled with AI features nobody asked for, and the free tiers shrink every year (message history limits, integration caps, retention locks). Your company's own conversation history becomes a hostage in the vendor's pricing negotiations.

Open-source alternatives do exist, but each has a cost:

- **Heavy operational footprint.** They need several services (a database, a search cluster, a message broker, an object store) before you can send a message.
- **Open-core paywalls.** Basics like SSO, guest accounts, compliance export, or read receipts sit behind an "enterprise" license.
- **Hard to fork.** Large polyglot codebases discourage the small IT generalist who wants to change one thing.

## 2. Vision

> **One container, one command, one afternoon — and a 200-person company has team chat with calls, threads, search, integrations and SSO that it owns forever.**

OpenCorpoChat is a self-hosted team communication platform. It's built to be:

1. **Complete for small orgs.** Everything a team under 200 people uses daily in commercial chat tools. No paid tier, no feature flags held back.
2. **Trivial to operate.** A single process with SQLite works out of the box. PostgreSQL and S3 are optional upgrades, not prerequisites.
3. **Easy to fork.** One language (TypeScript), one monorepo, boring well-known libraries, clear module boundaries, and docs written for generalists.
4. **Legally clean.** An original implementation of common, generic collaboration concepts. No copied code, assets, trademarks, or proprietary protocols.

## 3. Target users & personas

| Persona        | Description                                                 | Key needs                                                                                 |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Member**     | Everyday employee                                           | Fast messaging, threads, search, notifications that don't overwhelm, calls, mobile access |
| **Admin**      | Office manager / IT generalist, not necessarily a developer | Easy install, user management, SSO, backups, upgrades without drama                       |
| **Owner**      | Founder / exec                                              | Data ownership, cost control, compliance export, retention policy                         |
| **Guest**      | Contractor, client, partner                                 | Access only to specific channels                                                          |
| **Integrator** | Developer at the org                                        | Webhooks, bot API, slash commands, documented REST + realtime API                         |
| **Forker**     | Developer at another org / consultancy                      | Readable code, extension points, permissive contribution process                          |

**Scale target:** up to 200 active users and ~50 concurrent call participants per instance, plus a few million messages over the life of the instance. Run it on a $10–20/month VPS or a spare office machine.

## 4. Principles

1. **Batteries included, nothing required.** Every external dependency (Postgres, S3, SMTP, LiveKit, OIDC) is optional and has a built-in fallback.
2. **Boring tech.** Pick widely understood libraries over clever ones. A contributor who knows React and Node should be productive in an hour.
3. **The API is the product.** The web client uses only the public REST + WebSocket API. Anything the UI can do, a bot can do.
4. **Privacy by default.** No telemetry and no third-party calls unless an admin enables them. Link previews are fetched server-side with SSRF protection, and can be turned off.
5. **Accessible and international.** WCAG 2.2 AA is the target. All UI strings are externalized for translation.
6. **Secure by default.** Argon2id-equivalent password hashing (scrypt via Node core), secure cookies, CSRF protection, rate limiting, strict CSP, and least privilege everywhere.

## 5. IP & legal guardrails (non-negotiable)

These apply to every contribution and are enforced in review:

- **No copied code** from proprietary products, and none from open-source projects under incompatible licenses. Code from AGPL-compatible projects (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0, AGPL-3.0) must keep its attribution and be recorded in `NOTICE` / `THIRD_PARTY_LICENSES`.
- **No trademarks.** Third-party marks appear only in nominative, descriptive use (e.g. "import from a Slack export"). They never appear in branding, product names, icons, or marketing that implies affiliation.
- **No copied visual identity.** Layout uses generic, long-established chat conventions (sidebar + message list + composer, which predates every current vendor). Colors, logos, icons, illustrations, sounds and copywriting are original or properly licensed: icons come from Lucide (ISC), and emoji are rendered with the platform's native Unicode emoji, so no emoji image assets are bundled.
- **No reverse engineering** of proprietary clients or private protocols. Interoperability features use only **publicly documented** formats: documented export archive formats, incoming-webhook JSON conventions, and open standards (OIDC, WebRTC, Web Push, SMTP, OpenAPI, SCIM later).
- **Open standards only for calls.** WebRTC (W3C/IETF), with the optional SFU being LiveKit (Apache-2.0). No proprietary codecs are bundled; browsers supply the codecs.
- **Developer Certificate of Origin (DCO)** sign-off is required on every commit, so the provenance of every line is attested.
- **Dependency license gate in CI** fails the build if any dependency has a license incompatible with AGPL-3.0.
- **SPDX headers** (`SPDX-License-Identifier: AGPL-3.0-only`) in all source files, compatible with the REUSE spec.

## 6. Scope — features

Priority key: **P0** = v1.0 launch blocker, **P1** = v1.x, **P2** = later / community.

### 6.1 Workspace & identity

| ID   | Feature                                                                                                      | Pri |
| ---- | ------------------------------------------------------------------------------------------------------------ | --- |
| W-1  | Single organization per instance (keeps the model simple; run multiple instances for multiple orgs)          | P0  |
| W-2  | First-run setup wizard: creates owner account, org name, default channels                                    | P0  |
| W-3  | Email + password accounts (scrypt hashing, password policy)                                                  | P0  |
| W-4  | Invite links (expiring, max-uses, optional email domain restriction) and email invites                       | P0  |
| W-5  | Roles: **owner**, **admin**, **member**, **guest** (guest = channel-scoped)                                  | P0  |
| W-6  | Profile: display name, full name, title, pronouns (optional free text), avatar, timezone, phone              | P0  |
| W-7  | Custom status (emoji + text + expiry) and Do Not Disturb with schedule                                       | P0  |
| W-8  | TOTP two-factor authentication with recovery codes; admin can require 2FA                                    | P0  |
| W-9  | OpenID Connect SSO (Google Workspace, Microsoft Entra, Okta, Keycloak, Authentik…); optional "SSO only" mode | P0  |
| W-10 | Session management: list and revoke active sessions                                                          | P0  |
| W-11 | Deactivate users (content kept, login blocked); hard-delete per data-protection request                      | P0  |
| W-12 | User groups (`@design`, `@oncall`) mentionable as a unit                                                     | P1  |
| W-13 | SCIM 2.0 provisioning                                                                                        | P2  |
| W-14 | LDAP auth                                                                                                    | P2  |

### 6.2 Conversations

| ID   | Feature                                                                   | Pri |
| ---- | ------------------------------------------------------------------------- | --- |
| C-1  | Public channels (discoverable, anyone joins)                              | P0  |
| C-2  | Private channels (invite-only, invisible to non-members)                  | P0  |
| C-3  | Direct messages (1:1) and group DMs (up to 9 people)                      | P0  |
| C-4  | Channel topic, description, archive / unarchive                           | P0  |
| C-5  | Channel roles: channel admins can manage membership and settings          | P1  |
| C-6  | Read-only "announcement" channels (only admins post)                      | P0  |
| C-7  | Default channels that new members auto-join                               | P0  |
| C-8  | Browse / search channel directory                                         | P0  |
| C-9  | Mute channel, per-channel notification preference (all / mentions / none) | P0  |
| C-10 | Sidebar sections: Starred, Channels, DMs; custom sections                 | P1  |
| C-11 | Shared channels between instances (federation)                            | P2  |

### 6.3 Messaging

| ID   | Feature                                                                                                        | Pri |
| ---- | -------------------------------------------------------------------------------------------------------------- | --- |
| M-1  | Send / receive in real time over WebSocket, with optimistic UI and retry                                       | P0  |
| M-2  | Markdown subset: bold, italic, strike, inline code, code blocks with syntax highlighting, quotes, lists, links | P0  |
| M-3  | Threads (replies in side panel; optional "also send to channel")                                               | P0  |
| M-4  | Emoji reactions (native Unicode + custom emoji)                                                                | P0  |
| M-5  | @user, @channel, @here, @group mentions with autocomplete                                                      | P0  |
| M-6  | #channel links with autocomplete                                                                               | P0  |
| M-7  | Edit (shows "edited") and delete (shows tombstone in threads) own messages; admins can delete any              | P0  |
| M-8  | Pinned messages per channel                                                                                    | P0  |
| M-9  | Saved items (personal bookmarks)                                                                               | P0  |
| M-10 | Unread tracking per channel, unread divider, mark as unread, jump to first unread                              | P0  |
| M-11 | Typing indicators                                                                                              | P0  |
| M-12 | Link previews (server-fetched, SSRF-safe, size/time-limited, can be disabled)                                  | P1  |
| M-13 | Scheduled messages                                                                                             | P1  |
| M-14 | Reminders ("remind me about this in 1h")                                                                       | P1  |
| M-15 | Message forwarding / share to another channel                                                                  | P1  |
| M-16 | Polls                                                                                                          | P1  |
| M-17 | Drafts persisted per channel (local + server sync)                                                             | P1  |
| M-18 | Read receipts in DMs (opt-in per org)                                                                          | P2  |

### 6.4 Files

| ID  | Feature                                                                             | Pri |
| --- | ----------------------------------------------------------------------------------- | --- |
| F-1 | Upload via button, drag-and-drop, and paste                                         | P0  |
| F-2 | Image previews/thumbnails, inline video/audio player, PDF preview in browser        | P0  |
| F-3 | Storage backends: local disk (default) or S3-compatible (MinIO, AWS, Backblaze, R2) | P0  |
| F-4 | Per-file and per-org size quotas; allowed MIME types configurable                   | P0  |
| F-5 | Files browser per channel                                                           | P1  |
| F-6 | Optional ClamAV scan hook                                                           | P2  |

### 6.5 Search

| ID  | Feature                                                                                | Pri |
| --- | -------------------------------------------------------------------------------------- | --- |
| S-1 | Full-text search over messages the user can access (SQLite FTS5 / Postgres `tsvector`) | P0  |
| S-2 | Filters: `in:#channel`, `from:@user`, `before:`, `after:`, `has:file`, `has:link`      | P0  |
| S-3 | Quick switcher (Ctrl/Cmd-K) for channels, DMs and people                               | P0  |
| S-4 | File name search                                                                       | P1  |

### 6.6 Notifications & presence

| ID  | Feature                                                                                   | Pri |
| --- | ----------------------------------------------------------------------------------------- | --- |
| N-1 | Presence: online / away (idle detection) / offline / DND                                  | P0  |
| N-2 | In-app notification + unread badges + favicon/tab title badge                             | P0  |
| N-3 | Browser/OS notifications via Web Push (VAPID, no third-party push service needed for web) | P0  |
| N-4 | Email notifications for missed mentions/DMs (batched digest, configurable delay)          | P1  |
| N-5 | Keyword notifications                                                                     | P1  |
| N-6 | Notification schedule (working hours)                                                     | P1  |

### 6.7 Voice, video & screen share

| ID  | Feature                                                                         | Pri |
| --- | ------------------------------------------------------------------------------- | --- |
| V-1 | 1:1 voice/video calls from DMs (WebRTC peer-to-peer, server-relayed signaling)  | P0  |
| V-2 | Small group calls & persistent "huddle" in a channel (mesh, ≤ 6 participants)   | P0  |
| V-3 | Screen sharing                                                                  | P0  |
| V-4 | STUN/TURN config (bundled coturn instructions; Google STUN not used by default) | P0  |
| V-5 | Optional LiveKit SFU integration for larger meetings (up to ~50)                | P1  |
| V-6 | Call notifications / ringing, join/leave sounds (original sounds)               | P0  |
| V-7 | Recording (via LiveKit egress)                                                  | P2  |

### 6.8 Integrations & extensibility

| ID  | Feature                                                                                                                                 | Pri |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --- |
| I-1 | Public REST API (OpenAPI 3.1 spec, generated docs)                                                                                      | P0  |
| I-2 | Realtime WebSocket event API (documented event schema)                                                                                  | P0  |
| I-3 | Personal access tokens & bot accounts with scoped tokens                                                                                | P0  |
| I-4 | Incoming webhooks (post JSON → channel; accepts the widely used `{"text": ...}` shape)                                                  | P0  |
| I-5 | Outgoing webhooks (trigger words / all messages in channel → HTTP POST, HMAC-signed)                                                    | P1  |
| I-6 | Slash commands: built-ins (`/me`, `/shrug`, `/topic`, `/invite`, `/leave`, `/remind`, `/status`, `/call`) + custom HTTP-backed commands | P1  |
| I-7 | Interactive message buttons (bot receives signed callback)                                                                              | P2  |
| I-8 | Server-side plugin API (in-process hooks)                                                                                               | P2  |

### 6.9 Administration & compliance

| ID  | Feature                                                                                                     | Pri |
| --- | ----------------------------------------------------------------------------------------------------------- | --- |
| A-1 | Admin console: users, invites, roles, channels, settings, custom emoji                                      | P0  |
| A-2 | Audit log (logins, role changes, deletions, settings changes, exports)                                      | P0  |
| A-3 | Message retention policy (org-wide and per channel; automatic purge job)                                    | P1  |
| A-4 | Full org export (JSON + files, documented format)                                                           | P0  |
| A-5 | Import from public export formats: generic chat export JSON (Slack-format export archive as first importer) | P1  |
| A-6 | Legal hold (exempt users/channels from retention)                                                           | P2  |
| A-7 | Data-subject requests: export a user's data, erase a user                                                   | P1  |
| A-8 | Usage stats dashboard (local only, no telemetry)                                                            | P1  |
| A-9 | Backup & restore commands (`ocpc backup`, `ocpc restore`)                                                   | P0  |

### 6.10 Clients

| ID  | Feature                                                                                   | Pri |
| --- | ----------------------------------------------------------------------------------------- | --- |
| X-1 | Responsive web app (desktop + mobile browsers)                                            | P0  |
| X-2 | Installable PWA (offline shell, Web Push, app badge) — covers iOS/Android/desktop install | P0  |
| X-3 | Light/dark/system themes; compact/comfortable density                                     | P0  |
| X-4 | Keyboard shortcuts (documented, discoverable via `?`)                                     | P0  |
| X-5 | i18n framework, English shipped; community translations                                   | P0  |
| X-6 | Native desktop wrapper (Tauri)                                                            | P2  |
| X-7 | Native mobile apps                                                                        | P2  |

### 6.11 Explicit non-goals for v1

- Multi-tenant SaaS hosting (one org per instance by design)
- Federation between instances (P2; may adopt an open protocol later)
- End-to-end encryption (P2; transport TLS + at-rest disk encryption recommended in v1; MLS considered later)
- Built-in AI features (integrators can add bots; nothing ships calling external AI services)
- Docs/wiki/tasks/calendar suites (integrate instead)

## 7. Non-functional requirements

| Area                | Requirement                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance**     | p95 message send→deliver < 150 ms on LAN; initial app load < 2 s on 4G for 200-user org; channel switch < 300 ms                               |
| **Capacity**        | 200 users, 50 concurrent in calls (with SFU), 10M messages on Postgres, 2M on SQLite                                                           |
| **Footprint**       | Idle server < 200 MB RAM; runs on 1 vCPU / 1 GB RAM                                                                                            |
| **Availability**    | Single-node design; zero-downtime is non-goal; restart < 10 s; graceful WebSocket reconnect with gap-fill                                      |
| **Security**        | OWASP ASVS L2 as guide; CSP; rate limits on auth & API; all authz enforced server-side; dependency audit in CI; SECURITY.md disclosure process |
| **Privacy**         | No outbound network calls unless configured (SMTP, OIDC, S3, link previews, push)                                                              |
| **Accessibility**   | WCAG 2.2 AA; full keyboard operation; screen-reader live regions for new messages                                                              |
| **Browser support** | Last 2 versions of Chromium, Firefox, Safari (desktop & mobile)                                                                                |
| **Upgrades**        | Automatic, forward-only, transactional DB migrations on startup; documented rollback via backup                                                |
| **Observability**   | Structured JSON logs; `/healthz` & `/readyz`; optional Prometheus `/metrics`                                                                   |

## 8. Architecture

### 8.1 Overview

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

Single process. No Redis, broker, or search cluster. The realtime fan-out is in-memory, which is fine for a single node. A pub/sub adapter interface lets a fork add Redis/Postgres `LISTEN/NOTIFY` for multi-node later.

### 8.2 Tech stack

| Layer        | Choice                                                                         | Why                                                                     |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Language     | TypeScript (strict) everywhere                                                 | One language for whole stack; largest contributor pool                  |
| Runtime      | Node.js ≥ 22 LTS                                                               | Ubiquitous; built-in `crypto.scrypt`, `fetch`, test runner              |
| HTTP         | Fastify                                                                        | Fast, schema-first, mature plugin ecosystem                             |
| Realtime     | `ws` via `@fastify/websocket`                                                  | Standard WebSocket; no proprietary protocol                             |
| DB access    | Kysely (typed SQL query builder)                                               | One codebase targets SQLite + Postgres; SQL stays visible and teachable |
| DB drivers   | `better-sqlite3`, `pg`                                                         | Standard                                                                |
| Validation   | Zod (shared schemas → API types + OpenAPI)                                     | Single source of truth client/server                                    |
| Web UI       | React 18 + Vite + React Router                                                 | Mainstream                                                              |
| Client state | TanStack Query (server cache) + Zustand (UI/realtime state)                    | Small, well-known                                                       |
| Styling      | Plain CSS modules + CSS custom properties (design tokens)                      | No framework lock-in; easy theming for forks                            |
| Icons        | Lucide (ISC)                                                                   | Clean license                                                           |
| Markdown     | `marked` + DOMPurify-equivalent sanitization on render; server stores raw text | Safe by construction                                                    |
| Testing      | Vitest (unit/integration), Playwright (e2e)                                    | Mainstream                                                              |
| Packaging    | Docker image, docker-compose examples, plain `node` tarball                    | Easy installs                                                           |
| Monorepo     | pnpm workspaces                                                                | Fast, strict                                                            |

### 8.3 Repository layout

```
opencorpochat/
├── apps/
│   ├── server/          # Fastify API, WS gateway, jobs, CLI (ocpc)
│   └── web/             # React SPA / PWA
├── packages/
│   └── shared/          # Zod schemas, event types, permission constants, utils
├── deploy/              # Dockerfile, compose files, Caddy/nginx/coturn examples
├── docs/                # PRD, architecture, admin guide, API, ADRs
├── .github/             # CI, templates, dependabot, scorecard
└── (governance files)   # LICENSE, NOTICE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, GOVERNANCE, CHANGELOG
```

Server module boundaries live under `apps/server/src/modules/<domain>/` (auth, users, channels, messages, files, search, calls, integrations, admin, notifications). Each module owns its routes, service logic, and DB queries. Cross-module calls go through service functions, never through another module's tables directly. Forkers can find everything about a feature in one folder.

### 8.4 Data model (core tables)

```
org_settings(key, value_json)
users(id, email, username, display_name, full_name, title, pronouns, avatar_file_id,
      role[owner|admin|member|guest|bot], timezone, status_emoji, status_text, status_expires_at,
      dnd_until, password_hash, totp_secret, totp_enabled, deactivated_at, created_at)
sessions(id, user_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at)
identities(user_id, provider, subject)                     -- OIDC links
invites(id, code_hash, created_by, role, email, max_uses, uses, expires_at)
channels(id, kind[public|private|dm|group_dm], name, topic, description, created_by,
         is_default, is_readonly, archived_at, created_at, last_message_at)
channel_members(channel_id, user_id, role[admin|member], notify_level, muted,
                last_read_message_id, joined_at)
messages(id, channel_id, user_id, thread_root_id, body, kind[user|system|bot], edited_at,
         deleted_at, reply_count, last_reply_at, also_in_channel, created_at)
reactions(message_id, user_id, emoji, created_at)
mentions(message_id, user_id)                              -- for notification + "mentions" view
pins(channel_id, message_id, pinned_by, created_at)
saved_items(user_id, message_id, created_at)
thread_follows(message_id, user_id, last_read_reply_id)
files(id, uploader_id, channel_id, message_id, name, mime, size, storage_key, width, height,
      thumb_key, created_at)
custom_emoji(name, file_id, created_by)
user_groups(id, handle, name) / user_group_members(group_id, user_id)
webhooks(id, kind[incoming|outgoing], channel_id, token_hash, url, trigger_words, created_by)
api_tokens(id, user_id, name, token_hash, scopes, last_used_at, expires_at)
slash_commands(id, command, url, token_hash, created_by)
push_subscriptions(id, user_id, endpoint, p256dh, auth)
scheduled_messages(id, user_id, channel_id, thread_root_id, body, send_at)
reminders(id, user_id, message_id, text, remind_at)
calls(id, channel_id, started_by, started_at, ended_at) / call_participants(...)
audit_log(id, actor_id, action, target_type, target_id, metadata_json, ip, created_at)
```

IDs are **ULIDs** (sortable, URL-safe), which also give cursor pagination and ordering for free.

### 8.5 Authorization model

The policy lives in one module (`authz`) as pure functions such as `can(user, action, resource)`, and every route calls it. The module has 100% unit-test coverage. Guests can only see channels they were explicitly added to, and can't see the directory, user list, or search results outside those channels.

### 8.6 Realtime protocol

A client opens `GET /api/v1/ws` (session cookie or bearer token). The server sends `hello {sessionId, serverTime}`. Every event looks like `{type, seq, data}`. `seq` is a per-connection monotonic counter. Each client also tracks the last event timestamp and calls `GET /api/v1/sync?since=` after a reconnect to fill any gap.

The event types are `message.created|updated|deleted`, `reaction.added|removed`, `channel.created|updated|archived|member_joined|member_left`, `read.updated`, `typing`, `presence`, `user.updated`, `pin.added|removed`, `call.*` (signaling), and `notification`.

Client→server frames: `typing`, `presence.ping`, `call.signal`.

### 8.7 Calls

- **Signaling** runs over the existing WebSocket using `call.join/leave/offer/answer/ice` frames. The server only relays and tracks who is in which call.
- **Media** in mesh mode is browser-to-browser (≤ 6 participants). The ICE servers come from config. The docs show how to run coturn and generate time-limited TURN credentials with the standard TURN REST API HMAC scheme.
- **SFU mode:** if `LIVEKIT_URL`/key/secret are set, the server mints LiveKit access tokens and the client uses `livekit-client`. The call UI is shared and the media layer is swappable behind a `CallTransport` interface.

### 8.8 Search

- **SQLite:** an FTS5 virtual table kept in sync by triggers.
- **Postgres:** a generated `tsvector` column with a GIN index.
- A `SearchProvider` interface means a fork can plug in Meilisearch/Typesense. Results are always filtered by the channels the user is a member of (or public channels, for non-guests).

### 8.9 Configuration

Configuration is environment-variable-first and validated with Zod at boot, which fails fast with readable errors. Only a few settings are needed:

- `OCPC_PUBLIC_URL` is required.
- `OCPC_DATA_DIR` defaults to `./data`.
- `DATABASE_URL` defaults to a SQLite file in the data dir.
- Optional: `S3_*`, `SMTP_*`, `OIDC_*`, `TURN_*`, `LIVEKIT_*`, and `VAPID_*` (auto-generated and persisted if absent).

Org-level settings (name, invite policy, retention, 2FA requirement…) live in the DB and are edited in the admin console.

## 9. Deployment & operations

| Path                                                                                         | Audience                         |
| -------------------------------------------------------------------------------------------- | -------------------------------- |
| `docker run -p 8080:8080 -v ocpc:/data ghcr.io/<org>/opencorpochat`                          | Fastest start                    |
| `deploy/compose/docker-compose.yml` — app + Caddy (auto-HTTPS)                               | Recommended small-org production |
| `deploy/compose/docker-compose.full.yml` — app + Postgres + MinIO + coturn + LiveKit + Caddy | Larger orgs                      |
| `pnpm install && pnpm build && node apps/server/dist/index.js`                               | Bare metal / forkers             |

Built-in jobs (in-process scheduler) handle scheduled messages, reminders, email digests, retention purges, expired-status clearing, and session cleanup.

`ocpc` CLI commands: `migrate`, `create-admin`, `reset-password`, `backup`, `restore`, `export`, `import-slack`, `generate-vapid`.

## 10. Open-source standards & compliance checklist

- [ ] `LICENSE` — AGPL-3.0 full text; `SPDX-License-Identifier` headers in source
- [ ] `NOTICE` — copyright & third-party attributions
- [ ] `README.md` — what/why, screenshots, quick start, feature matrix, links
- [ ] `CONTRIBUTING.md` — dev setup, coding standards, DCO sign-off, PR process, IP guardrails
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- [ ] `SECURITY.md` — private vulnerability reporting, supported versions, response SLA
- [ ] `GOVERNANCE.md` — maintainers, decision process (lazy consensus + ADRs), how to become a maintainer
- [ ] `CHANGELOG.md` — Keep a Changelog format, SemVer releases
- [ ] `SUPPORT.md` — where to get help
- [ ] `.github/` — issue forms (bug, feature), PR template, CODEOWNERS, dependabot, CI, CodeQL, OpenSSF Scorecard, DCO check, release workflow (SBOM via CycloneDX, image signing via cosign/provenance)
- [ ] `REUSE.toml` — REUSE-spec compliance for non-source files
- [ ] AGPL §13 compliance built in: the app shows a "Source code" link in the About dialog (configurable for forks), so users interacting over the network can get the corresponding source
- [ ] Dependency license allowlist check in CI
- [ ] `docs/adr/` — Architecture Decision Records for major choices

## 11. Milestones

| Milestone              | Contents                                                                                                                                                                                   | Exit criteria                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **M0 Foundations**     | Monorepo, tooling, CI, governance docs, config, DB layer + migrations, health endpoints                                                                                                    | `pnpm dev` runs both apps; CI green                        |
| **M1 Core chat**       | Setup wizard, auth (password + sessions), invites, users/profiles, channels, DMs, messages, threads, reactions, mentions, edit/delete, unread, typing, presence, realtime WS, web UI shell | Two users can chat in real time in channels, DMs & threads |
| **M2 Daily-driver**    | Files (local/S3), search + quick switcher, pins, saved items, statuses/DND, notifications (in-app + Web Push), custom emoji, admin console, audit log, themes, shortcuts, PWA              | A 10-person team can dogfood for a week                    |
| **M3 Calls**           | WebRTC 1:1 + mesh huddles, screen share, TURN config, LiveKit adapter                                                                                                                      | Stable 4-person call with screen share across NAT via TURN |
| **M4 Integrations**    | API tokens, bots, incoming/outgoing webhooks, slash commands, OpenAPI docs                                                                                                                 | Example bot & CI webhook work end-to-end                   |
| **M5 Enterprise-lite** | OIDC SSO, TOTP 2FA, retention, export, Slack-export import, email notifications, scheduled messages, reminders, user groups                                                                | Admin checklist in docs passes                             |
| **M6 Release 1.0**     | Docker images, compose files, admin guide, e2e suite, a11y audit, security review, translations scaffold                                                                                   | Tagged v1.0.0 with SBOM & signed image                     |

## 12. Success metrics

- **Time to first message** after `docker run`: under 5 minutes.
- **Install success:** a non-developer admin can deploy using only the docs. We'll validate this with 3 external testers.
- **Forkability:** a new contributor lands their first PR within a day of cloning.
- **Adoption:** 50 orgs self-reporting production use within 12 months.
- **Zero** license-compliance or IP issues raised.

## 13. Risks & mitigations

| Risk                                                    | Mitigation                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scope creep toward "everything a giant vendor does"     | P0/P1/P2 discipline; non-goals list; plugin/webhook escape hatch                                              |
| WebRTC NAT traversal failures                           | TURN docs + compose file with coturn; connection diagnostics page                                             |
| SQLite limits as orgs grow                              | Same code on Postgres; documented migration via export/import                                                 |
| Security bugs in a self-hosted product orgs don't patch | Secure defaults, in-app "update available" notice (opt-in check), SECURITY.md process, minimal attack surface |
| Trademark/IP claims                                     | Guardrails in §5, DCO, review checklist, nominative-use-only policy                                           |
| Maintainer burnout                                      | GOVERNANCE.md, clear module ownership, keep the core small                                                    |

## 14. Open questions

1. Should guests count toward any limits? (No limits exist — proposed: no.)
2. Preferred container registry and GitHub org name (placeholder `opencorpochat/opencorpochat`).
3. Translation platform (Weblate hosted for OSS is the leading candidate).
