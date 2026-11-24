// SPDX-License-Identifier: AGPL-3.0-only
// Admin API for migrating from other chat tools: upload an archive, review the preview,
// run the import, invite the imported people, and undo or clean up. Owners only, since
// an import can include private conversations.
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, HttpError, notFound, tooLarge } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { HOUR, isoIn, nowIso } from '../../lib/time.js';
import { audit } from '../admin/audit.js';
import { sendMail } from '../notifications/email.js';
import { unclaimedPeople } from './engine.js';
import {
  analyzeArchive,
  deleteArchive,
  importsDir,
  recoverInterrupted,
  runningImport,
  startImport,
  toImport,
  undo,
} from './service.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/, 'Use a date like 2024-01-31')
  .transform((s) => (s.length === 10 ? `${s}T00:00:00.000Z` : s));

export const ImportOptionsInput = z.object({
  channelIds: z.array(z.string().max(300)).max(20_000).optional(),
  includePrivate: z.boolean().default(false),
  includeDirect: z.boolean().default(false),
  acknowledgePrivate: z.boolean().optional(),
  since: isoDate.optional(),
  until: isoDate.optional(),
  files: z.boolean().default(true),
  mergeExisting: z.boolean().default(true),
});

/** Turn service errors into HTTP errors. */
async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === 404) throw notFound('Import');
    if (/already running|Wait for/.test(e.message)) throw conflict(e.message);
    throw badRequest(e.message);
  }
}

export function migrationRoutes(app: FastifyInstance, ctx: Ctx) {
  recoverInterrupted(ctx).catch((err) => ctx.log.error({ err }, 'could not recover imports'));

  route(app, ctx, {
    method: 'GET',
    url: '/admin/imports',
    summary: 'List imports from other chat tools',
    tags: ['admin'],
    auth: 'owner',
    handler: async () => {
      const rows = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute();
      return { imports: rows.map((r) => toImport(r)), running: runningImport() };
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/imports',
    summary:
      'Upload an export archive (multipart/form-data, field "file"): a Slack-format export ZIP or a Teams archive from "ocpc collect-teams". Returns the analysis.',
    tags: ['admin'],
    auth: 'owner',
    rateLimit: { max: 10, timeWindow: '1 minute' },
    handler: async ({ req, user, ip }) => {
      const maxBytes = ctx.config.maxImportMb * 1024 * 1024;
      const part = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
      if (!part) throw badRequest('No file provided');
      const id = ulid();
      mkdirSync(importsDir(ctx), { recursive: true, mode: 0o700 });
      const file = path.join(importsDir(ctx), `${id}.zip`);
      try {
        await pipeline(part.file, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
      } catch (err) {
        rmSync(file, { force: true });
        throw err;
      }
      if (part.file.truncated) {
        rmSync(file, { force: true });
        throw tooLarge(
          `Archives must be smaller than ${ctx.config.maxImportMb} MB. Use "ocpc import" on the server for larger ones.`,
        );
      }
      const fileName = (part.filename || 'export.zip').replace(/[\\/\0\r\n]/g, '_').slice(0, 200);
      await wrap(() =>
        analyzeArchive(ctx, {
          id,
          archivePath: file,
          fileName,
          actorId: user.id,
          ip,
          keepArchive: true,
        }),
      );
      const row = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toImport(row, true);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/admin/imports/people',
    summary: 'Imported people who have not claimed their account yet',
    tags: ['admin'],
    auth: 'owner',
    handler: async () => ({
      people: (await unclaimedPeople(ctx)).map((p) => ({
        id: p.id,
        email: p.email,
        displayName: p.display_name,
        username: p.username,
      })),
    }),
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/imports/people/invite',
    summary:
      'Send email-bound invites to imported people so they can claim their account and history',
    tags: ['admin'],
    auth: 'owner',
    body: z.object({ userIds: z.array(z.string().max(40)).max(5000).optional() }),
    handler: async ({ body, user, ip }) => {
      let people = await unclaimedPeople(ctx);
      if (body.userIds) people = people.filter((p) => body.userIds!.includes(p.id));
      const out: { userId: string; email: string; link: string; emailed: boolean }[] = [];
      for (const p of people) {
        const code = randomToken(18);
        const inviteId = ulid();
        await ctx.db
          .insertInto('invites')
          .values({
            id: inviteId,
            code_hash: sha256(code),
            created_by: user.id,
            role: 'member',
            email: p.email,
            max_uses: 1,
            uses: 0,
            channel_ids: '[]',
            expires_at: isoIn(14 * 24 * HOUR),
            revoked_at: null,
            created_at: nowIso(),
          })
          .execute();
        const link = `${ctx.config.publicUrl}/join/${code}`;
        let emailed = false;
        if (ctx.config.smtp) {
          const org = ctx.settings.get().name;
          try {
            await sendMail(
              ctx,
              p.email,
              `Your ${org} chat history has moved`,
              `Hi ${p.display_name},\n\n${org} has moved its team chat to a new home. Your messages and channels have been brought over.\n\nClaim your account to pick up where you left off (the link expires in 14 days):\n${link}\n`,
            );
            emailed = true;
          } catch (err) {
            ctx.log.warn({ err }, 'claim invite email failed');
          }
        }
        out.push({ userId: p.id, email: p.email, link, emailed });
      }
      await audit(ctx, {
        actorId: user.id,
        action: 'migration.invited',
        targetType: 'org',
        ip,
        metadata: { count: out.length, emailed: out.filter((o) => o.emailed).length },
      });
      return { invites: out };
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/admin/imports/:id',
    summary: 'Get an import with its preview, progress and report',
    tags: ['admin'],
    auth: 'owner',
    handler: async ({ params }) => {
      const row = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!row) throw notFound('Import');
      return toImport(row, true);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/imports/:id/start',
    summary:
      'Start an analyzed import in the background. Private channels and direct messages require acknowledgePrivate.',
    tags: ['admin'],
    auth: 'owner',
    body: ImportOptionsInput,
    handler: async ({ params, body, user, ip }) => {
      const row = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!row) throw notFound('Import');
      if (runningImport()) throw conflict('Another import is already running');
      if (!['ready', 'completed', 'failed'].includes(row.status) || !row.preview)
        throw badRequest(`This import cannot be started (status: ${row.status})`);
      if (!row.archive_path)
        throw badRequest('The archive for this import was deleted; upload it again');
      if ((body.includePrivate || body.includeDirect) && !body.acknowledgePrivate)
        throw badRequest(
          'Importing private channels or direct messages requires acknowledging that you have the authority and a lawful basis to do so',
        );
      startImport(ctx, row.id, body, { id: user.id, ip }).catch((err) =>
        ctx.log.warn({ err, importId: row.id }, 'import failed'),
      );
      // Wait until the run has been marked as running, so the response reflects it.
      for (let i = 0; i < 50 && runningImport() !== row.id; i++)
        await new Promise((r) => setTimeout(r, 10));
      const updated = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      return toImport(updated);
    },
  });

  route(app, ctx, {
    method: 'POST',
    url: '/admin/imports/:id/undo',
    summary:
      'Undo an import: delete the channels, messages and files it created, and placeholder accounts nobody claimed',
    tags: ['admin'],
    auth: 'owner',
    handler: async ({ params, user, ip }) => wrap(() => undo(ctx, params.id!, { id: user.id, ip })),
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/admin/imports/:id/archive',
    summary:
      'Delete the uploaded archive from the server (the import record and checksum are kept)',
    tags: ['admin'],
    auth: 'owner',
    handler: async ({ params, user, ip }) => {
      await wrap(() => deleteArchive(ctx, params.id!, { id: user.id, ip }));
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/admin/imports/:id/report',
    summary: 'Download the full import report (JSON) for your records',
    tags: ['admin'],
    auth: 'owner',
    handler: async ({ params, reply }) => {
      const row = await ctx.db
        .selectFrom('imports')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!row) throw notFound('Import');
      const audits = await ctx.db
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'created_at', 'metadata'])
        .where('target_type', '=', 'import')
        .where('target_id', '=', row.id)
        .orderBy('created_at')
        .execute();
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="ocpc-import-${row.id}.json"`);
      return {
        format: 'ocpc-import-report',
        version: 1,
        import: toImport(row, true),
        auditTrail: audits.map((a) => ({ ...a, metadata: JSON.parse(a.metadata) as unknown })),
      };
    },
  });
}
