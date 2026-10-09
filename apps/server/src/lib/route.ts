// SPDX-License-Identifier: AGPL-3.0-only
// A thin route helper: auth + Zod validation + OpenAPI registration in one place,
// so every endpoint is documented automatically and enforces the same rules.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import type { ApiScope, Role } from '@ocpc/shared';
import type { Ctx } from '../context.js';
import type { UsersTable } from '../db/schema.js';
import { badRequest, forbidden, unauthorized } from './errors.js';

export type AuthLevel = 'none' | 'optional' | 'user' | 'member' | 'admin' | 'owner';

export interface AuthInfo {
  user: UsersTable;
  sessionId: string | null;
  tokenId: string | null;
  scopes: ApiScope[] | null; // null = full (session) access
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

export interface RouteDoc {
  method: string;
  url: string;
  summary: string;
  tags: string[];
  auth: AuthLevel;
  body?: ZodType;
  query?: ZodType;
}

export interface HandlerArgs<B, Q> {
  req: FastifyRequest;
  reply: FastifyReply;
  body: B;
  query: Q;
  params: Record<string, string>;
  auth: AuthInfo;
  user: UsersTable;
  ip: string;
}

interface RouteDef<B extends ZodType | undefined, Q extends ZodType | undefined> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  summary: string;
  tags: string[];
  auth?: AuthLevel;
  /** Required token scope (session auth always has full access). Defaults by method. */
  scope?: ApiScope;
  body?: B;
  query?: Q;
  rateLimit?: { max: number; timeWindow: string | number };
  handler: (
    args: HandlerArgs<B extends ZodType ? z.output<B> : undefined, Q extends ZodType ? z.output<Q> : undefined>,
  ) => Promise<unknown> | unknown;
}

const ROLE_RANK: Record<Role, number> = { bot: 1, guest: 0, member: 1, admin: 2, owner: 3 };

export function route<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined>(
  app: FastifyInstance,
  ctx: Ctx,
  def: RouteDef<B, Q>,
) {
  const authLevel = def.auth ?? 'user';
  ctx.routeDocs.push({
    method: def.method,
    url: '/api/v1' + def.url,
    summary: def.summary,
    tags: def.tags,
    auth: authLevel,
    body: def.body,
    query: def.query,
  });
  const scope: ApiScope = def.scope ?? (def.method === 'GET' ? 'read' : 'write');

  app.route({
    method: def.method,
    url: def.url,
    config: def.rateLimit ? { rateLimit: def.rateLimit } : undefined,
    handler: async (req, reply) => {
      const auth = req.auth;
      if (authLevel !== 'none' && authLevel !== 'optional') {
        if (!auth) throw unauthorized();
        const role = auth.user.role as Role;
        if (authLevel === 'member' && role === 'guest') throw forbidden('Guests cannot do that');
        if (authLevel === 'admin' && ROLE_RANK[role] < 2) throw forbidden('Admins only');
        if (authLevel === 'owner' && role !== 'owner') throw forbidden('Owners only');
        if (auth.scopes) {
          const ok =
            auth.scopes.includes(scope) ||
            (scope === 'read' && auth.scopes.includes('write')) ||
            auth.scopes.includes('admin');
          if (!ok) throw forbidden(`Token lacks the "${scope}" scope`);
          if (authLevel === 'admin' && !auth.scopes.includes('admin')) throw forbidden('Token lacks the "admin" scope');
        }
      }
      let body: unknown = undefined;
      if (def.body) {
        const r = def.body.safeParse(req.body ?? {});
        if (!r.success) throw badRequest(formatZodError(r.error), r.error.issues);
        body = r.data;
      }
      let query: unknown = undefined;
      if (def.query) {
        const r = def.query.safeParse(req.query ?? {});
        if (!r.success) throw badRequest(formatZodError(r.error), r.error.issues);
        query = r.data;
      }
      const result = await def.handler({
        req,
        reply,
        body: body as never,
        query: query as never,
        params: (req.params ?? {}) as Record<string, string>,
        auth: auth as AuthInfo,
        user: auth?.user as UsersTable,
        ip: req.ip,
      });
      if (reply.sent) return reply;
      if (result === undefined) return reply.code(204).send();
      return result;
    },
  });
}

export function formatZodError(err: z.ZodError) {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
});
