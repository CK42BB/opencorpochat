// SPDX-License-Identifier: AGPL-3.0-only
// Database connection + migrations. SQLite is the zero-config default; PostgreSQL is
// selected when DATABASE_URL starts with postgres://.
import {
  Kysely,
  PostgresDialect,
  SqliteDialect,
  sql,
  type Migration,
  type MigrationProvider,
  Migrator,
} from 'kysely';
import type { Config } from '../config.js';
import type { Database } from './schema.js';
import * as m0001 from './migrations/0001_initial.js';

export type Dialect = 'sqlite' | 'postgres';
export type DB = Kysely<Database>;

export interface DbHandle {
  db: DB;
  dialect: Dialect;
  close(): Promise<void>;
}

export async function openDatabase(config: Config): Promise<DbHandle> {
  if (config.database.kind === 'postgres') {
    const pg = (await import('pg')).default;
    // Return BIGINT/COUNT as JS numbers (safe for our value ranges).
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const pool = new pg.Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
    });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    return { db, dialect: 'postgres', close: () => db.destroy() };
  }
  const Sqlite = (await import('better-sqlite3')).default;
  const file = config.database.file;
  const sqlite = new Sqlite(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, dialect: 'sqlite', close: () => db.destroy() };
}

const MIGRATIONS: Record<string, { up: (db: Kysely<any>, d: Dialect) => Promise<void> }> = {
  '0001_initial': m0001,
};

export async function migrate(handle: DbHandle): Promise<string[]> {
  const provider: MigrationProvider = {
    async getMigrations() {
      const out: Record<string, Migration> = {};
      for (const [name, mod] of Object.entries(MIGRATIONS)) {
        out[name] = { up: (db) => mod.up(db, handle.dialect) };
      }
      return out;
    },
  };
  const migrator = new Migrator({ db: handle.db, provider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** Rebuild derived indexes (e.g. after restoring a SQLite backup). */
export async function rebuildSearchIndex(handle: DbHandle) {
  if (handle.dialect === 'sqlite') {
    await sql`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`.execute(handle.db);
  }
}

export const bool = (v: unknown) => v === 1 || v === true || v === '1';
export const int = (v: boolean) => (v ? 1 : 0);
export function json<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
