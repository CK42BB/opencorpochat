// SPDX-License-Identifier: AGPL-3.0-only
// Organization export as NDJSON (one JSON object per line: {"type": ..., "data": ...}).
// The format is documented in docs/export-format.md. Secrets (password hashes, TOTP
// secrets, token hashes) are never exported.
import { Readable } from 'node:stream';
import type { Ctx } from '../../context.js';

const PAGE = 1000;

async function* paged<T extends { id: string }>(fetch: (after: string) => Promise<T[]>) {
  let after = '';
  for (;;) {
    const rows = await fetch(after);
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1]!.id;
  }
}

export async function* exportRecords(
  ctx: Ctx,
  opts: { userId?: string } = {},
): AsyncGenerator<{ type: string; data: unknown }> {
  yield {
    type: 'meta',
    data: {
      format: 'ocpc-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: opts.userId ? 'user' : 'org',
    },
  };
  if (!opts.userId) yield { type: 'org', data: ctx.settings.public() };

  let users = ctx.db
    .selectFrom('users')
    .select([
      'id',
      'email',
      'username',
      'display_name',
      'full_name',
      'title',
      'pronouns',
      'phone',
      'role',
      'timezone',
      'avatar_file_id',
      'deactivated_at',
      'created_at',
    ]);
  if (opts.userId) users = users.where('id', '=', opts.userId);
  for (const u of await users.execute()) yield { type: 'user', data: u };

  if (!opts.userId) {
    for (const c of await ctx.db.selectFrom('channels').selectAll().execute())
      yield { type: 'channel', data: c };
    for (const m of await ctx.db
      .selectFrom('channel_members')
      .select(['channel_id', 'user_id', 'role', 'joined_at'])
      .execute()) {
      yield { type: 'channel_member', data: m };
    }
    for (const g of await ctx.db.selectFrom('user_groups').selectAll().execute())
      yield { type: 'user_group', data: g };
    for (const g of await ctx.db.selectFrom('user_group_members').selectAll().execute())
      yield { type: 'user_group_member', data: g };
    for (const e of await ctx.db.selectFrom('custom_emoji').selectAll().execute())
      yield { type: 'custom_emoji', data: e };
  }

  const msgs = paged((after) => {
    let q = ctx.db
      .selectFrom('messages')
      .select([
        'id',
        'channel_id',
        'user_id',
        'thread_root_id',
        'body',
        'kind',
        'as_name',
        'also_in_channel',
        'poll',
        'forwarded_from',
        'edited_at',
        'deleted_at',
        'created_at',
      ])
      .where('id', '>', after);
    if (opts.userId) q = q.where('user_id', '=', opts.userId);
    return q.orderBy('id').limit(PAGE).execute();
  });
  for await (const m of msgs) yield { type: 'message', data: m };

  let reactions = ctx.db.selectFrom('reactions').selectAll();
  if (opts.userId) reactions = reactions.where('user_id', '=', opts.userId);
  for (const r of await reactions.execute()) yield { type: 'reaction', data: r };

  if (!opts.userId)
    for (const p of await ctx.db.selectFrom('pins').selectAll().execute())
      yield { type: 'pin', data: p };

  let files = ctx.db
    .selectFrom('files')
    .select([
      'id',
      'uploader_id',
      'purpose',
      'channel_id',
      'message_id',
      'name',
      'mime',
      'size',
      'storage_key',
      'created_at',
    ]);
  if (opts.userId) files = files.where('uploader_id', '=', opts.userId);
  for (const f of await files.execute()) yield { type: 'file', data: f };
}

export function exportStream(ctx: Ctx, opts: { userId?: string } = {}) {
  return Readable.from(
    (async function* () {
      for await (const rec of exportRecords(ctx, opts)) yield JSON.stringify(rec) + '\n';
    })(),
  );
}
