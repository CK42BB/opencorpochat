# 3. SQLite by default, PostgreSQL optional

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

"One container, one command" (PRD §2) rules out requiring a separate database server. But some organizations already run PostgreSQL, want managed backups, or expect large message histories.

## Decision

- **SQLite** (WAL mode, via `better-sqlite3`) is the default, stored in the data directory. No configuration is needed.
- **PostgreSQL** is used when `DATABASE_URL` starts with `postgres://`.
- All queries and migrations are written with **Kysely**, so a single codebase targets both. Dialect-specific behaviour is isolated behind small interfaces. The main example is full-text search: FTS5 on SQLite, `tsvector` with a GIN index on Postgres.
- CI runs the server test suite against both databases.

## Consequences

- Zero-dependency install for most users, and Postgres for those who want it.
- Contributors must write SQL that works on both. Kysely and the CI matrix enforce this.
- Moving from SQLite to Postgres is done with export/import rather than in place. This is documented in the admin guide.
- SQLite limits the server to a single node. That's consistent with the single-node design (see the PRD's non-goals).
