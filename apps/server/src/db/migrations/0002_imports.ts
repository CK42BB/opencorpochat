// SPDX-License-Identifier: AGPL-3.0-only
// Migration support: one row per import run, plus a map from every source record
// (user, channel, message, file) to the local row it became. The map makes re-running
// an import safe (already imported items are skipped) and lets an admin undo an import.
import type { Kysely } from 'kysely';
import type { Dialect } from '../index.js';

export async function up(db: Kysely<any>, _dialect: Dialect): Promise<void> {
  const s = db.schema;
  await s
    .createTable('imports')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('label', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('file_name', 'text', (c) => c.notNull())
    .addColumn('archive_path', 'text')
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('size', 'bigint', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('options', 'text')
    .addColumn('preview', 'text')
    .addColumn('progress', 'text')
    .addColumn('report', 'text')
    .addColumn('error', 'text')
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('started_at', 'text')
    .addColumn('finished_at', 'text')
    .execute();

  await s
    .createTable('import_items')
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('source_id', 'text', (c) => c.notNull())
    .addColumn('import_id', 'text', (c) => c.notNull().references('imports.id').onDelete('cascade'))
    .addColumn('local_id', 'text', (c) => c.notNull())
    .addColumn('created', 'integer', (c) => c.notNull())
    .addColumn('claimed_at', 'text')
    // 1 = the person had left the source organization (never offered an invite).
    .addColumn('former', 'integer', (c) => c.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('import_items_pk', ['source', 'kind', 'source_id'])
    .execute();
  await s
    .createIndex('import_items_import_idx')
    .on('import_items')
    .columns(['import_id', 'kind'])
    .execute();
  await s
    .createIndex('import_items_local_idx')
    .on('import_items')
    .columns(['kind', 'local_id'])
    .execute();
}
