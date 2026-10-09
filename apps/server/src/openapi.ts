// SPDX-License-Identifier: AGPL-3.0-only
// Generates an OpenAPI 3.1 document from the route registry (see lib/route.ts).
import { z } from 'zod';
import { VERSION } from '@ocpc/shared';
import type { RouteDoc } from './lib/route.js';

function schemaOf(t: z.ZodType | undefined, io: 'input' | 'output' = 'input') {
  if (!t) return undefined;
  try {
    return z.toJSONSchema(t, { io, unrepresentable: 'any' });
  } catch {
    return { type: 'object' };
  }
}

export function buildOpenApi(routes: RouteDoc[], publicUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.url.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const querySchema = schemaOf(r.query) as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;
    const queryParams = Object.entries(querySchema?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: querySchema?.required?.includes(name) ?? false,
      schema,
    }));
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: r.tags,
      parameters: [...params, ...queryParams],
      responses: {
        '200': { description: 'OK' },
        '204': { description: 'No content' },
        '4XX': {
          description: 'Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    if (r.auth === 'none') op.security = [];
    if (r.auth === 'admin' || r.auth === 'owner') op.description = `Requires the ${r.auth} role.`;
    if (r.body)
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: schemaOf(r.body) } },
      };
    paths[path] = { ...(paths[path] ?? {}), [r.method.toLowerCase()]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenCorpoChat API',
      version: VERSION,
      description:
        'REST API for OpenCorpoChat. Authenticate with a session cookie (web app) or `Authorization: Bearer <token>` (bots, scripts). ' +
        'Cookie-authenticated non-GET requests must send the header `X-OCPC-CSRF: 1`. Realtime events: `GET /api/v1/ws` (WebSocket).',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
    },
    servers: [{ url: publicUrl }],
    security: [{ bearer: [] }, { cookie: [] }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'ocpc_session' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' }, message: { type: 'string' }, details: {} },
          required: ['error', 'message'],
        },
      },
    },
    paths,
  };
}
