// SPDX-License-Identifier: AGPL-3.0-only
import type { Ctx } from '../../context.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';

export interface AuditInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(ctx: Ctx, e: AuditInput) {
  await ctx.db
    .insertInto('audit_log')
    .values({
      id: ulid(),
      actor_id: e.actorId,
      action: e.action,
      target_type: e.targetType,
      target_id: e.targetId ?? null,
      metadata: JSON.stringify(e.metadata ?? {}),
      ip: e.ip ?? null,
      created_at: nowIso(),
    })
    .execute();
}
