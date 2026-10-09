// SPDX-License-Identifier: AGPL-3.0-only
// User groups (@handles) and custom emoji.
import type { FastifyInstance } from 'fastify';
import { CustomEmojiInput, UserGroupInput, type CustomEmoji, type UserGroup } from '@ocpc/shared';
import type { Ctx } from '../../context.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { route } from '../../lib/route.js';
import { nowIso } from '../../lib/time.js';
import { isUsernameTaken } from '../users/service.js';
import { audit } from './audit.js';

export async function listGroups(ctx: Ctx): Promise<UserGroup[]> {
  const groups = await ctx.db.selectFrom('user_groups').selectAll().orderBy('handle').execute();
  const members = await ctx.db.selectFrom('user_group_members').selectAll().execute();
  return groups.map((g) => ({
    id: g.id,
    handle: g.handle,
    name: g.name,
    description: g.description,
    memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.user_id),
  }));
}

export async function listCustomEmoji(ctx: Ctx): Promise<CustomEmoji[]> {
  const rows = await ctx.db.selectFrom('custom_emoji').selectAll().orderBy('name').execute();
  return rows.map((e) => ({ name: e.name, url: `/api/v1/files/${e.file_id}/${e.name}`, createdBy: e.created_by }));
}

async function publishGroup(ctx: Ctx, id: string) {
  const g = (await listGroups(ctx)).find((x) => x.id === id);
  if (g) ctx.hub.broadcast('group.updated', { group: g });
  return g;
}

export function directoryRoutes(app: FastifyInstance, ctx: Ctx) {
  route(app, ctx, {
    method: 'GET',
    url: '/groups',
    summary: 'List user groups',
    tags: ['groups'],
    handler: () => listGroups(ctx),
  });

  route(app, ctx, {
    method: 'POST',
    url: '/groups',
    summary: 'Create a user group (mentionable as @handle)',
    tags: ['groups'],
    auth: 'admin',
    body: UserGroupInput,
    handler: async ({ user, body, ip }) => {
      if (await isUsernameTaken(ctx, body.handle)) throw conflict('That handle is already in use');
      const id = ulid();
      await ctx.db.insertInto('user_groups').values({ id, handle: body.handle, name: body.name, description: body.description, created_by: user.id, created_at: nowIso() }).execute();
      if (body.memberIds.length) {
        await ctx.db.insertInto('user_group_members').values(body.memberIds.map((uid) => ({ group_id: id, user_id: uid }))).onConflict((oc) => oc.doNothing()).execute();
      }
      await audit(ctx, { actorId: user.id, action: 'group.created', targetType: 'group', targetId: id, ip });
      return publishGroup(ctx, id);
    },
  });

  route(app, ctx, {
    method: 'PATCH',
    url: '/groups/:id',
    summary: 'Update a user group',
    tags: ['groups'],
    auth: 'admin',
    body: UserGroupInput.partial(),
    handler: async ({ user, body, params, ip }) => {
      const g = await ctx.db.selectFrom('user_groups').selectAll().where('id', '=', params.id!).executeTakeFirst();
      if (!g) throw notFound('Group');
      if (body.handle && body.handle !== g.handle && (await isUsernameTaken(ctx, body.handle))) throw conflict('That handle is already in use');
      await ctx.db.updateTable('user_groups').set({ handle: body.handle, name: body.name, description: body.description }).where('id', '=', g.id).execute();
      if (body.memberIds) {
        await ctx.db.deleteFrom('user_group_members').where('group_id', '=', g.id).execute();
        if (body.memberIds.length) {
          await ctx.db.insertInto('user_group_members').values(body.memberIds.map((uid) => ({ group_id: g.id, user_id: uid }))).onConflict((oc) => oc.doNothing()).execute();
        }
      }
      await audit(ctx, { actorId: user.id, action: 'group.updated', targetType: 'group', targetId: g.id, ip });
      return publishGroup(ctx, g.id);
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/groups/:id',
    summary: 'Delete a user group',
    tags: ['groups'],
    auth: 'admin',
    handler: async ({ user, params, ip }) => {
      await ctx.db.deleteFrom('user_groups').where('id', '=', params.id!).execute();
      ctx.hub.broadcast('group.deleted', { groupId: params.id! });
      await audit(ctx, { actorId: user.id, action: 'group.deleted', targetType: 'group', targetId: params.id!, ip });
    },
  });

  route(app, ctx, {
    method: 'GET',
    url: '/emoji',
    summary: 'List custom emoji',
    tags: ['emoji'],
    handler: () => listCustomEmoji(ctx),
  });

  route(app, ctx, {
    method: 'POST',
    url: '/emoji',
    summary: 'Add a custom emoji from an uploaded image',
    tags: ['emoji'],
    auth: 'member',
    body: CustomEmojiInput,
    handler: async ({ user, body }) => {
      const f = await ctx.db.selectFrom('files').selectAll().where('id', '=', body.fileId).executeTakeFirst();
      if (!f || f.uploader_id !== user.id || !f.mime.startsWith('image/')) throw badRequest('Upload an image first');
      if (Number(f.size) > 256 * 1024) throw badRequest('Emoji images must be under 256 KB');
      const exists = await ctx.db.selectFrom('custom_emoji').select('name').where('name', '=', body.name).executeTakeFirst();
      if (exists) throw conflict(`:${body.name}: already exists`);
      await ctx.db.updateTable('files').set({ purpose: 'emoji' }).where('id', '=', f.id).execute();
      await ctx.db.insertInto('custom_emoji').values({ name: body.name, file_id: f.id, created_by: user.id, created_at: nowIso() }).execute();
      const emoji = await listCustomEmoji(ctx);
      ctx.hub.broadcast('emoji.updated', { emoji });
      return emoji;
    },
  });

  route(app, ctx, {
    method: 'DELETE',
    url: '/emoji/:name',
    summary: 'Remove a custom emoji',
    tags: ['emoji'],
    auth: 'member',
    handler: async ({ user, params }) => {
      const e = await ctx.db.selectFrom('custom_emoji').selectAll().where('name', '=', params.name!).executeTakeFirst();
      if (!e) throw notFound('Emoji');
      if (e.created_by !== user.id && user.role !== 'admin' && user.role !== 'owner') throw forbidden();
      await ctx.db.deleteFrom('custom_emoji').where('name', '=', e.name).execute();
      ctx.hub.broadcast('emoji.updated', { emoji: await listCustomEmoji(ctx) });
    },
  });
}
