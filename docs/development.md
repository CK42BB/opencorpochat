# Development guide

This guide gets you from `git clone` to shipping a change. It assumes you know TypeScript and React. You don't need to know the codebase yet.

## Setup

Requirements: **Node.js ≥ 22.12**, **pnpm 10** (`corepack enable`), and a C/C++ toolchain for the SQLite driver if no prebuilt binary matches your platform (Xcode CLT on macOS; `python3 make g++` on Linux).

```sh
git clone https://github.com/CK42BB/opencorpochat.git
cd opencorpochat
pnpm install
pnpm dev            # shared (watch) + API on :8080 + web on http://localhost:5173
pnpm cli seed-demo  # optional: fill an empty dev database with a demo company
```

Vite proxies `/api` (including the WebSocket) from `:5173` to `:8080`. Dev data lives in `apps/server/data/` (`OCPC_DATA_DIR`). Delete it to start over.

| Command                                        | What it does                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Run everything with hot reload                                                                                        |
| `pnpm build`                                   | Build shared, web and server (`apps/web/dist`, `apps/server/dist`)                                                    |
| `pnpm start`                                   | Run the production build (`node apps/server/dist/index.js`)                                                           |
| `pnpm test`                                    | Unit and integration tests (Vitest) in every package                                                                  |
| `pnpm e2e`                                     | Playwright end-to-end tests. Run `pnpm build` first; the first time, also run `pnpm exec playwright install chromium` |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Type checking, ESLint, Prettier                                                                                       |
| `pnpm licenses:check`                          | Fail if any production dependency has an AGPL-incompatible license                                                    |
| `pnpm cli <command>`                           | The `ocpc` admin CLI, run from source                                                                                 |

## Monorepo tour

```
packages/shared/src/      Shared by server and web: the contract
  entities.ts             Wire types (User, Channel, Message…)
  schemas.ts              Zod request schemas (validation + OpenAPI)
  events.ts               Realtime event and frame types
  permissions.ts          Pure authorization rules (can the user do X?)
  mentions.ts, search.ts, emoji.ts

apps/server/src/
  index.ts / cli.ts       Server entry point / `ocpc` CLI
  app.ts                  Fastify assembly: plugins, security headers, module registration
  config.ts               Every environment variable, validated with Zod
  context.ts              The Ctx object passed to all modules (db, hub, storage, settings…)
  lib/route.ts            route() helper: auth + validation + OpenAPI in one place
  db/                     Kysely setup, table types (schema.ts), migrations/
  realtime/               WebSocket gateway, Hub (fan-out), built-in STUN server
  jobs/scheduler.ts       In-process periodic jobs (reminders, digests, retention…)
  modules/<feature>/      One folder per feature:
      routes.ts           HTTP endpoints
      service.ts          Logic that other modules may call
    auth/ users/ channels/ messages/ files/ search/ notifications/
    calls/ integrations/ admin/ scheduling/

apps/web/src/
  App.tsx                 Routing, app shell, global shortcuts
  lib/                    api.ts (fetch), store.ts (zustand + realtime reducer),
                          realtime.ts (WebSocket), markdown.ts, notify.ts, i18n.ts
  components/             Message, MessageList, Composer, Sidebar, ThreadPanel, modals…
  pages/                  ChannelView, auth pages, Threads/Activity/Search/Browse/People
  settings/ admin/ calls/ Self-contained feature areas
  styles/app.css          Design tokens + all styles
  locales/                Translations (English strings are the keys)
```

**Rule of thumb:** cross-module calls go through another module's `service.ts`, never straight into its tables. To find everything about a feature, open its folder.

## How a request flows

Every endpoint is declared with `route()` from `apps/server/src/lib/route.ts`:

```ts
route(app, ctx, {
  method: 'POST',
  url: '/channels/:id/messages',
  summary: 'Post a message',           // → OpenAPI
  tags: ['messages'],
  auth: 'user',                         // 'none' | 'optional' | 'user' | 'member' | 'admin' | 'owner'
  body: PostMessageInput,               // Zod schema from @ocpc/shared → validation + OpenAPI
  rateLimit: { max: 60, timeWindow: '1 minute' },
  handler: async ({ user, params, body }) => { ... return result; },
});
```

1. An `onRequest` hook in `app.ts` resolves the caller from the session cookie or `Authorization: Bearer`. Cookie-based writes must also carry the `X-OCPC-CSRF: 1` header.
2. `route()` checks the auth level and the token scope (`read` for GET, `write` for everything else).
3. `route()` validates `body` and `query` with Zod and returns readable `400` errors.
4. Your handler runs. Return a value for JSON, or nothing for `204`. Throw `HttpError`s from `lib/errors.ts` (`notFound()`, `forbidden()`…).
5. The route is recorded in `ctx.routeDocs`, which feeds `/api/v1/openapi.json` automatically.

**Authorization:** use the pure helpers in `packages/shared/src/permissions.ts`. Server services such as `requireChannelAccess` and `requireMember` combine them with database lookups. The web client imports the same helpers to decide which buttons to show.

## Realtime

- **Connections:** `realtime/gateway.ts` accepts WebSocket connections at `/api/v1/ws`. `realtime/hub.ts` tracks connections and fans events out (`sendToUsers`, `sendToChannel`, `broadcast`).
- **Event types** are defined once in `packages/shared/src/events.ts` (`ServerEventMap`). Add a key there and both sides get type-checked.
- **Client side:** `lib/realtime.ts` connects with exponential backoff. On reconnect it refetches `/bootstrap` and the visible message list to fill any gap. Every event goes through `applyEvent()` in `lib/store.ts`.
- **Scaling:** the Hub is in-memory by design, since the target is a single node. To scale out, replace the `send*` methods with a Redis or Postgres `LISTEN/NOTIFY` fan-out.

## Database & migrations

[Kysely](https://kysely.dev) is a typed SQL query builder, so one codebase runs on **SQLite** (the default) and **PostgreSQL**. Table types live in `apps/server/src/db/schema.ts`.

Portable conventions, so the same SQL runs on both:

| Concept                | Column type | Notes                                                         |
| ---------------------- | ----------- | ------------------------------------------------------------- |
| IDs                    | `text`      | ULIDs (`lib/ids.ts`): sortable, and paging uses `id < cursor` |
| Timestamps             | `text`      | ISO-8601 UTC strings; compare as strings                      |
| Booleans               | `integer`   | 0/1. Use `bool()` / `int()` from `db/index.ts`                |
| JSON                   | `text`      | `JSON.stringify` / `json()`                                   |
| Counts from `count(*)` | —           | Always wrap in `Number(...)`; Postgres returns bigint         |

**Adding a migration:**

1. Create `apps/server/src/db/migrations/0002_<name>.ts` exporting `up(db, dialect)`. Use the schema builder and only the column types above. If you need dialect-specific SQL (indexes, full-text search), branch on `dialect`, as `0001_initial.ts` does.
2. Register it in the `MIGRATIONS` map in `apps/server/src/db/index.ts`. Names sort, so keep the numeric prefix.
3. Add the new table or columns to `db/schema.ts`.
4. Migrations run at startup inside a transaction. They are forward-only; there are no down migrations.

## Testing

| Layer                                                                        | Where                                                           | Run                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Pure logic (permissions, parsers, crypto, QR, STUN)                          | `*.test.ts` next to the code                                    | `pnpm test`                                                 |
| Server integration: real Fastify app, real SQLite, `app.inject` + `injectWS` | `apps/server/src/app.test.ts`, helpers in `src/test/helpers.ts` | `pnpm --filter @ocpc/server test`                           |
| Same tests against PostgreSQL                                                | —                                                               | `DATABASE_URL=postgres://… pnpm --filter @ocpc/server test` |
| End to end: two real browsers chatting and calling                           | `e2e/chat.spec.ts`                                              | `pnpm build && pnpm e2e`                                    |

CI runs all of these, plus the PostgreSQL job and the e2e suite on Linux. On macOS, headless Chromium has no working audio stack, so the e2e call test simulates "no microphone" there and verifies signaling and video.

## Recipe: add a feature end to end

Example: **bookmark folders**, which let people file saved messages into named folders.

1. **Contract** (`packages/shared`):
   - Add a `BookmarkFolder` type in `entities.ts`.
   - Add `CreateFolderInput = z.object({ name: z.string().trim().min(1).max(60) })` in `schemas.ts`.
   - Add a `'folder.updated': { folder: BookmarkFolder }` event in `events.ts`.
2. **Migration:** `0002_bookmark_folders.ts` creates `bookmark_folders(id text pk, user_id text, name text, created_at text)` and adds a nullable `folder_id text` column to `saved_items`. Register it, and update `db/schema.ts`.
3. **Service + routes:** create `apps/server/src/modules/bookmarks/routes.ts` with `GET/POST /folders` and `PATCH /saved/:messageId { folderId }`, using `route()` and `auth: 'user'`. After a write, call `ctx.hub.sendToUsers([user.id], 'folder.updated', { folder })`. Register `bookmarkRoutes(api, ctx)` in `app.ts`.
4. **Test:** add an integration test to `app.test.ts` using the `Client` helper: create a folder, file a saved item, and check that another user can't see it.
5. **Client state:** handle `'folder.updated'` in `applyEvent()` (`lib/store.ts`) and add `folders` to `State`.
6. **UI:** add a folder picker to the Saved page (`pages/lists.tsx` → `SavedPage`). Wrap every string in `t('…')`, and use existing CSS classes and tokens.
7. **Docs:** add a row to the feature matrix in `docs/features.md` and an entry to `CHANGELOG.md`.

Run `pnpm typecheck && pnpm lint && pnpm test`, then commit with `git commit -s`.

## Conventions

- **License header:** every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- **Strings:** all user-visible strings go through `t('English text', { vars })` from `apps/web/src/lib/i18n.ts`.
- **Dependencies:** check the license first; `pnpm licenses:check` runs in CI. Prefer the platform (Node `crypto`, `fetch`, Web APIs) over packages.
- **Styling:** use CSS custom properties from `:root` in `styles/app.css`, and never hard-code colors in components. The light and dark themes swap tokens only.
- **Accessibility:** label every input, give icon-only buttons an `aria-label`, and support the keyboard.
- **Zustand selectors** must return stable values. Selecting `s.users` and mapping in the component is fine. Selecting `s => ids.map(...)` creates a new array every time and causes an infinite render loop.
- **Commits:** follow Conventional Commits, include a DCO sign-off, and keep the [IP guardrails](../CONTRIBUTING.md#ip-guardrails-reviewer-checklist).

## Debugging

| Want to…                        | Do                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| See every request               | `OCPC_LOG_LEVEL=debug pnpm dev`                                                                                                                                                                                                                                                          |
| Inspect a call                  | Run `ocpcCallDebug()` in the browser console during a call: peer, ICE and candidate states                                                                                                                                                                                               |
| Inspect realtime traffic        | DevTools → Network → WS → `/api/v1/ws` → Messages                                                                                                                                                                                                                                        |
| Read the API                    | Open `/api/v1/openapi.json` in any OpenAPI viewer                                                                                                                                                                                                                                        |
| Reset dev data                  | Stop the server and delete `apps/server/data/`                                                                                                                                                                                                                                           |
| Test on Postgres without Docker | Any local Postgres works: `DATABASE_URL=postgres://user:pass@localhost:5432/ocpc`. Each test server creates and drops its own temporary database, so the user needs `CREATEDB`. If you can't grant it, set `OCPC_TEST_SHARED_DB=1` and use `--no-file-parallelism` on an empty database. |
