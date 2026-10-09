// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { Transform } from 'node:stream';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import type { FilesTable } from '../../db/schema.js';
import { badRequest, forbidden, notFound, tooLarge } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { getMembershipRow, requireChannelAccess } from '../channels/service.js';
import { toFileInfo } from '../messages/service.js';

/** Types a browser may render inline. Everything else is forced to download. */
const INLINE_TYPES =
  /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|ogg|wav|webm|mp4|aac|flac)|application\/pdf|text\/plain)$/;

function sanitizeName(name: string) {
  // Stripping control characters is the point of this regex.
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\u0000-\u001f\u007f/\\]/g;
  const clean = name.replace(unsafe, '_').trim().slice(0, 200);
  return clean || 'file';
}

export function fileRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'POST',
    url: '/files',
    summary:
      'Upload a file (multipart/form-data, field "file"). Attach it by passing its id when posting a message.',
    tags: ['files'],
    query: z.object({
      width: z.coerce.number().int().min(1).max(100_000).optional(),
      height: z.coerce.number().int().min(1).max(100_000).optional(),
    }),
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: async ({ req, user, query }) => {
      const settings = ctx.settings.get();
      const maxBytes = settings.maxUploadMb * 1024 * 1024;
      const part = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
      if (!part) throw badRequest('No file provided');
      const mime = (part.mimetype || 'application/octet-stream').toLowerCase();
      if (
        settings.allowedMimePrefixes.length &&
        !settings.allowedMimePrefixes.some((p) => mime.startsWith(p))
      ) {
        part.file.resume();
        throw badRequest(`Files of type ${mime} are not allowed`);
      }
      const id = ulid();
      const key = `${id.slice(0, 2)}/${id}`;
      let size = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          cb(null, chunk);
        },
      });
      const declared = Number(req.headers['content-length'] ?? 0);
      await ctx.storage.put(key, part.file.pipe(counter), declared, mime);
      if (part.file.truncated) {
        await ctx.storage.delete(key);
        throw tooLarge(`Files must be smaller than ${settings.maxUploadMb} MB`);
      }
      const row: FilesTable = {
        id,
        uploader_id: user.id,
        purpose: 'attachment',
        channel_id: null,
        message_id: null,
        name: sanitizeName(part.filename),
        mime,
        size,
        storage_key: key,
        width: query.width ?? null,
        height: query.height ?? null,
        created_at: nowIso(),
      };
      await ctx.db.insertInto('files').values(row).execute();
      return toFileInfo(row);
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/files/:id/:name',
    summary: 'Download a file',
    tags: ['files'],
    query: z.object({ download: z.string().optional() }),
    handler: async ({ user, params, reply, req, query }) => {
      const f = await ctx.db
        .selectFrom('files')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!f) throw notFound('File');
      // Avatars, custom emoji and the org icon are visible to every signed-in user.
      if (f.purpose === 'attachment') {
        if (f.channel_id) {
          await requireChannelAccess(ctx, user, f.channel_id);
        } else if (f.uploader_id !== user.id) {
          throw notFound('File');
        }
      }
      const size = Number(f.size);
      const inline = INLINE_TYPES.test(f.mime) && !query.download;
      reply.header('Content-Type', inline ? f.mime : 'application/octet-stream');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      );
      reply.header(
        'Cache-Control',
        f.purpose === 'attachment' ? 'private, max-age=86400' : 'private, max-age=3600',
      );
      reply.header('Accept-Ranges', 'bytes');
      reply.header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range && size > 0) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) {
          reply.code(416).header('Content-Range', `bytes */${size}`);
          return reply.send();
        }
        reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${size}`)
          .header('Content-Length', end - start + 1);
        return reply.send(await ctx.storage.get(f.storage_key, { start, end }));
      }
      reply.header('Content-Length', size);
      return reply.send(await ctx.storage.get(f.storage_key));
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/channels/:id/files',
    summary: 'List files shared in a channel',
    tags: ['files'],
    query: z.object({ before: z.string().max(64).optional(), q: z.string().max(100).optional() }),
    handler: async ({ user, params, query }) => {
      await requireChannelAccess(ctx, user, params.id!);
      let q = ctx.db
        .selectFrom('files')
        .selectAll()
        .where('channel_id', '=', params.id!)
        .where('message_id', 'is not', null);
      if (query.before) q = q.where('id', '<', query.before);
      if (query.q) q = q.where('name', 'like', `%${query.q.replace(/[%_]/g, '')}%`);
      const rows = await q.orderBy('id', 'desc').limit(100).execute();
      return rows.map(toFileInfo);
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/files/:id',
    summary: 'Delete a file you uploaded',
    tags: ['files'],
    handler: async ({ user, params }) => {
      const f = await ctx.db
        .selectFrom('files')
        .selectAll()
        .where('id', '=', params.id!)
        .executeTakeFirst();
      if (!f) throw notFound('File');
      let allowed = f.uploader_id === user.id || user.role === 'admin' || user.role === 'owner';
      if (!allowed && f.channel_id) {
        const m = await getMembershipRow(ctx, f.channel_id, user.id);
        allowed = m?.role === 'admin';
      }
      if (!allowed) throw forbidden();
      await ctx.db.deleteFrom('files').where('id', '=', f.id).execute();
      await ctx.storage.delete(f.storage_key).catch(() => {});
      if (f.message_id) {
        const msg = await ctx.db
          .selectFrom('messages')
          .selectAll()
          .where('id', '=', f.message_id)
          .executeTakeFirst();
        if (msg) {
          const { publishMessage } = await import('../messages/service.js');
          await publishMessage(ctx, msg, 'message.updated');
        }
      }
    },
  });
}
