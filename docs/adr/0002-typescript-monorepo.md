# 2. TypeScript end-to-end in a pnpm monorepo

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Small organizations rarely have a dedicated developer, and when they do, that person is most likely a web developer. Forkability is a core goal (PRD §2). The candidates we considered were Go + React, Elixir/Phoenix + React, and TypeScript end-to-end.

## Decision

- Use **TypeScript (strict)** for the server, web client and shared code.
- Use a **pnpm workspaces** monorepo: `apps/server`, `apps/web`, `packages/shared`.
- Server: **Node.js ≥ 22**, **Fastify**, `ws` WebSockets, **Kysely** for SQL, **Zod** for validation.
- Client: **React**, **Vite**, TanStack Query, Zustand, plain CSS modules with design tokens.

Request, response and event schemas are defined once in `packages/shared` and used on both sides.

## Consequences

- One language and toolchain for the whole stack. This gives us the largest possible contributor pool and lets a full-stack change land in a single PR.
- Client and server types can't drift apart.
- Node uses more memory than Go would. That's acceptable at our scale (≤ 200 users, under 200 MB at idle).
- One native module (`better-sqlite3`) needs prebuilt binaries or a build toolchain. The Docker image takes care of this.
