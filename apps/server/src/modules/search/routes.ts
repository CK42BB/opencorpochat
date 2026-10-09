// SPDX-License-Identifier: AGPL-3.0-only
// Message search. SQLite uses FTS5; PostgreSQL uses a generated tsvector column.
// Results are always restricted to channels the searcher can read.
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { parseSearchQuery } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import type { MessagesTable } from '../../db/schema.js';
import { route } from '../../lib/route.js';
import { hydrate } from '../messages/service.js';

/** Build a safe FTS5 query: each term quoted, last term as a prefix match. */
export function ftsQuery(text: string) {
  const terms = text.match(/"[^"]+"|[^\s"]+/g) ?? [];
  return terms
    .map((t, i) => {
      const clean = t.replace(/^"|"$/g, '').replace(/"/g, '""').trim();
      if (!clean) return '';
      const quoted = `"${clean}"`;
      return i === terms.length - 1 && !t.startsWith('"') ? `${quoted}*` : quoted;
    })
    .filter(Boolean)
    .join(' ');
}

/** Build a safe PostgreSQL tsquery: terms ANDed, "phrases" adjacent, last term as a prefix. */
export function pgTsQuery(text: string) {
  const terms = text.match(/"[^"]+"|[^\s"]+/g) ?? [];
  const words = (s: string) => s.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms
    .map((t, i) => {
      if (t.startsWith('"')) {
        const w = words(t);
        return w.length ? `(${w.join(' <-> ')})` : '';
      }
      const w = words(t);
      if (!w.length) return '';
      const last = i === terms.length - 1;
      return w.map((x, j) => (last && j === w.length - 1 ? `${x}:*` : x)).join(' & ');
    })
    .filter(Boolean)
    .join(' & ');
}

export function searchRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/search',
    summary:
      'Search messages. Supports in:#channel from:@user before:/after:/on:YYYY-MM-DD has:file|link|reaction is:thread|pinned|saved',
    tags: ['search'],
    query: z.object({
      q: z.string().max(500),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      offset: z.coerce.number().int().min(0).max(5000).default(0),
    }),
    handler: async ({ user, query }) => {
      const sq = parseSearchQuery(query.q);
      let q = ctx.db
        .selectFrom('messages as m')
        .innerJoin('channels as c', 'c.id', 'm.channel_id')
        .selectAll('m')
        .where('m.deleted_at', 'is', null)
        .where('m.kind', '!=', 'system');

      // Access control: member channels, plus public channels for non-guests.
      q = q.where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('channel_members as cm')
              .select('cm.user_id')
              .whereRef('cm.channel_id', '=', 'm.channel_id')
              .where('cm.user_id', '=', user.id),
          ),
          ...(user.role === 'guest' ? [] : [eb('c.kind', '=', 'public')]),
        ]),
      );

      if (sq.text) {
        if (ctx.dialect === 'sqlite') {
          const fq = ftsQuery(sq.text);
          if (fq)
            q = q.where(
              sql<boolean>`m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${fq})`,
            );
        } else {
          const tq = pgTsQuery(sq.text);
          if (tq) q = q.where(sql<boolean>`m.search @@ to_tsquery('simple', ${tq})`);
        }
      }
      if (sq.inChannels.length) q = q.where('c.name', 'in', sq.inChannels);
      if (sq.fromUsers.length) {
        q = q.where('m.user_id', 'in', (eb) =>
          eb.selectFrom('users').select('id').where('username', 'in', sq.fromUsers),
        );
      }
      if (sq.after) q = q.where('m.created_at', '>=', sq.after);
      if (sq.before) q = q.where('m.created_at', '<', sq.before);
      for (const h of sq.has) {
        if (h === 'file')
          q = q.where((eb) =>
            eb.exists(
              eb.selectFrom('files as f').select('f.id').whereRef('f.message_id', '=', 'm.id'),
            ),
          );
        if (h === 'link') q = q.where('m.body', 'like', '%http%://%');
        if (h === 'reaction')
          q = q.where((eb) =>
            eb.exists(
              eb
                .selectFrom('reactions as r')
                .select('r.user_id')
                .whereRef('r.message_id', '=', 'm.id'),
            ),
          );
      }
      for (const i of sq.is) {
        if (i === 'thread')
          q = q.where((eb) =>
            eb.or([eb('m.thread_root_id', 'is not', null), eb('m.reply_count', '>', 0)]),
          );
        if (i === 'pinned')
          q = q.where((eb) =>
            eb.exists(
              eb
                .selectFrom('pins as p')
                .select('p.message_id')
                .whereRef('p.message_id', '=', 'm.id'),
            ),
          );
        if (i === 'saved')
          q = q.where((eb) =>
            eb.exists(
              eb
                .selectFrom('saved_items as s')
                .select('s.message_id')
                .whereRef('s.message_id', '=', 'm.id')
                .where('s.user_id', '=', user.id),
            ),
          );
      }
      if (
        !sq.text &&
        !sq.inChannels.length &&
        !sq.fromUsers.length &&
        !sq.has.length &&
        !sq.is.length &&
        !sq.after &&
        !sq.before
      ) {
        return { messages: [], hasMore: false };
      }
      const rows = (await q
        .orderBy('m.id', 'desc')
        .limit(query.limit + 1)
        .offset(query.offset)
        .execute()) as MessagesTable[];
      return {
        messages: await hydrate(ctx, rows.slice(0, query.limit), user.id),
        hasMore: rows.length > query.limit,
      };
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/search/files',
    summary: 'Search files by name',
    tags: ['search'],
    query: z.object({ q: z.string().min(1).max(200) }),
    handler: async ({ user, query }) => {
      const rows = await ctx.db
        .selectFrom('files as f')
        .innerJoin('channels as c', 'c.id', 'f.channel_id')
        .selectAll('f')
        .where('f.message_id', 'is not', null)
        .where('f.name', 'like', `%${query.q.replace(/[%_]/g, '')}%`)
        .where((eb) =>
          eb.or([
            eb.exists(
              eb
                .selectFrom('channel_members as cm')
                .select('cm.user_id')
                .whereRef('cm.channel_id', '=', 'f.channel_id')
                .where('cm.user_id', '=', user.id),
            ),
            ...(user.role === 'guest' ? [] : [eb('c.kind', '=', 'public')]),
          ]),
        )
        .orderBy('f.id', 'desc')
        .limit(50)
        .execute();
      const { toFileInfo } = await import('../messages/service.js');
      return rows.map(toFileInfo);
    },
  });
}
