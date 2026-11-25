// SPDX-License-Identifier: AGPL-3.0-only
// Import runs: analysis (preview), the import itself, undo, and archive clean-up.
// The admin API and the CLI both go through here, so both are audited the same way.
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { ImportsTable } from '../../db/schema.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import {
  previewImport,
  runImport,
  undoImport,
  validateOptions,
  type ImportOptions,
  type ImportReport,
  type Preview,
  type Progress,
} from './engine.js';
import { archiveSize, openSource, sha256File } from './model.js';

export const importsDir = (ctx: Ctx) => path.join(ctx.config.dataDir, 'imports');

/** Only one import runs at a time per server. */
let running: string | null = null;
export const runningImport = () => running;

export function toImport(r: ImportsTable, full = false) {
  const report = json<ImportReport | null>(r.report, null);
  return {
    id: r.id,
    source: r.source,
    label: r.label,
    fileName: r.file_name,
    sha256: r.sha256,
    size: Number(r.size),
    status: r.status,
    hasArchive: !!r.archive_path,
    error: r.error,
    createdBy: r.created_by,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    options: json<ImportOptions | null>(r.options, null),
    progress: json<Progress | null>(r.progress, null),
    totals: report?.totals ?? null,
    ...(full ? { preview: json<Preview | null>(r.preview, null), report } : {}),
  };
}

async function getRow(ctx: Ctx, id: string) {
  const row = await ctx.db
    .selectFrom('imports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw Object.assign(new Error('Import not found'), { statusCode: 404 });
  return row;
}

/** Register an archive and analyze it. Resolves once the preview is ready. */
export async function analyzeArchive(
  ctx: Ctx,
  input: {
    archivePath: string;
    fileName: string;
    actorId: string;
    ip?: string | null;
    keepArchive: boolean;
    id?: string;
  },
) {
  const id = input.id ?? ulid();
  const sha256 = await sha256File(input.archivePath);
  const size = archiveSize(input.archivePath);
  await ctx.db
    .insertInto('imports')
    .values({
      id,
      source: 'unknown',
      label: '',
      file_name: input.fileName,
      archive_path: input.keepArchive ? input.archivePath : null,
      sha256,
      size,
      status: 'analyzing',
      options: null,
      preview: null,
      progress: null,
      report: null,
      error: null,
      created_by: input.actorId,
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
    })
    .execute();
  await audit(ctx, {
    actorId: input.actorId,
    action: 'migration.uploaded',
    targetType: 'import',
    targetId: id,
    ip: input.ip,
    metadata: { fileName: input.fileName, size, sha256 },
  });
  try {
    const src = await openSource(input.archivePath);
    try {
      const preview = await previewImport(ctx, src);
      await ctx.db
        .updateTable('imports')
        .set({
          source: src.kind,
          label: src.label,
          preview: JSON.stringify(preview),
          status: 'ready',
        })
        .where('id', '=', id)
        .execute();
      return { id, preview };
    } finally {
      src.close();
    }
  } catch (err) {
    await ctx.db
      .updateTable('imports')
      .set({ status: 'failed', error: (err as Error).message })
      .where('id', '=', id)
      .execute();
    throw err;
  }
}

/** Run an analyzed import. Resolves when it has finished. */
export async function startImport(
  ctx: Ctx,
  id: string,
  options: ImportOptions,
  actor: { id: string; ip?: string | null },
  archivePath?: string,
) {
  validateOptions(options);
  const row = await getRow(ctx, id);
  const file = archivePath ?? row.archive_path;
  if (!file) throw new Error('The archive for this import was deleted; upload it again');
  if (!['ready', 'completed', 'failed'].includes(row.status) || !row.preview)
    throw new Error(`This import cannot be started (status: ${row.status})`);
  if (running) throw new Error('Another import is already running');
  running = id;
  try {
    await ctx.db
      .updateTable('imports')
      .set({
        status: 'running',
        options: JSON.stringify(options),
        started_at: nowIso(),
        finished_at: null,
        error: null,
      })
      .where('id', '=', id)
      .execute();
    await audit(ctx, {
      actorId: actor.id,
      action: 'migration.started',
      targetType: 'import',
      targetId: id,
      ip: actor.ip,
      metadata: { source: row.source, sha256: row.sha256, ...options },
    });
    let last = 0;
    const src = await openSource(
      file,
      row.source === 'unknown' ? undefined : (row.source as 'slack' | 'teams'),
    );
    let report: ImportReport;
    try {
      report = await runImport(ctx, src, {
        importId: id,
        actorId: actor.id,
        options,
        onProgress: async (p) => {
          if (Date.now() - last < 1000 && p.phase !== 'done') return;
          last = Date.now();
          await ctx.db
            .updateTable('imports')
            .set({ progress: JSON.stringify(p) })
            .where('id', '=', id)
            .execute();
        },
      });
    } finally {
      src.close();
    }
    await ctx.db
      .updateTable('imports')
      .set({ status: 'completed', report: JSON.stringify(report), finished_at: nowIso() })
      .where('id', '=', id)
      .execute();
    await audit(ctx, {
      actorId: actor.id,
      action: 'migration.completed',
      targetType: 'import',
      targetId: id,
      ip: actor.ip,
      metadata: {
        sha256: row.sha256,
        users: report.users,
        ...report.totals,
        channels: report.channels.length,
      },
    });
    return report;
  } catch (err) {
    await ctx.db
      .updateTable('imports')
      .set({ status: 'failed', error: (err as Error).message, finished_at: nowIso() })
      .where('id', '=', id)
      .execute();
    await audit(ctx, {
      actorId: actor.id,
      action: 'migration.failed',
      targetType: 'import',
      targetId: id,
      ip: actor.ip,
      metadata: { error: (err as Error).message },
    });
    throw err;
  } finally {
    running = null;
  }
}

export async function undo(ctx: Ctx, id: string, actor: { id: string; ip?: string | null }) {
  const row = await getRow(ctx, id);
  if (!['completed', 'failed'].includes(row.status))
    throw new Error(`This import cannot be undone (status: ${row.status})`);
  if (running) throw new Error('Wait for the running import to finish');
  running = id;
  try {
    const counts = await undoImport(ctx, id);
    await ctx.db
      .updateTable('imports')
      .set({ status: 'undone', finished_at: nowIso() })
      .where('id', '=', id)
      .execute();
    await audit(ctx, {
      actorId: actor.id,
      action: 'migration.undone',
      targetType: 'import',
      targetId: id,
      ip: actor.ip,
      metadata: counts,
    });
    return counts;
  } finally {
    running = null;
  }
}

export async function deleteArchive(
  ctx: Ctx,
  id: string,
  actor: { id: string; ip?: string | null },
) {
  const row = await getRow(ctx, id);
  if (running === id) throw new Error('Wait for the import to finish');
  if (row.archive_path && row.archive_path.startsWith(importsDir(ctx) + path.sep))
    rmSync(row.archive_path, { force: true });
  await ctx.db.updateTable('imports').set({ archive_path: null }).where('id', '=', id).execute();
  await audit(ctx, {
    actorId: actor.id,
    action: 'migration.archive_deleted',
    targetType: 'import',
    targetId: id,
    ip: actor.ip,
    metadata: { sha256: row.sha256 },
  });
}

/** After a restart, runs that were in progress can no longer finish. */
export async function recoverInterrupted(ctx: Ctx) {
  await ctx.db
    .updateTable('imports')
    .set({
      status: 'failed',
      error: 'Interrupted by a server restart. Start it again: items already imported are skipped.',
    })
    .where('status', 'in', ['running', 'analyzing'])
    .execute();
}
