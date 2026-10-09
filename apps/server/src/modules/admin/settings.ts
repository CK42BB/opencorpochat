// SPDX-License-Identifier: AGPL-3.0-only
// Org-level settings stored in the database, cached in memory.
import type { OrgSettings } from '@ocpc/shared';
import type { DB } from '../../db/index.js';

export const DEFAULT_SETTINGS: OrgSettings = {
  name: 'OpenCorpoChat',
  iconUrl: null,
  allowSignupDomains: [],
  require2fa: false,
  ssoOnly: false,
  guestsEnabled: true,
  retentionDays: null,
  linkPreviews: true,
  readReceipts: false,
  maxUploadMb: 100,
  allowedMimePrefixes: [],
  defaultChannelIds: [],
  messageEditWindowMinutes: null,
};

type Stored = OrgSettings & { iconFileId: string | null; setupComplete: boolean };

export class SettingsStore {
  private cache: Stored = { ...DEFAULT_SETTINGS, iconFileId: null, setupComplete: false };

  constructor(
    private db: DB,
    private maxUploadCapMb: number,
  ) {}

  async load() {
    const rows = await this.db.selectFrom('org_settings').selectAll().execute();
    const next: Stored = {
      ...DEFAULT_SETTINGS,
      maxUploadMb: this.maxUploadCapMb,
      iconFileId: null,
      setupComplete: false,
    };
    for (const r of rows) {
      try {
        (next as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore corrupt values */
      }
    }
    next.maxUploadMb = Math.min(next.maxUploadMb, this.maxUploadCapMb);
    next.iconUrl = next.iconFileId ? `/api/v1/files/${next.iconFileId}/icon` : null;
    this.cache = next;
  }

  get(): Stored {
    return this.cache;
  }

  /** Public, client-facing view. */
  public(): OrgSettings {
    const { iconFileId: _i, setupComplete: _s, ...rest } = this.cache;
    return rest;
  }

  async update(patch: Partial<Stored>) {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const v = JSON.stringify(value);
      await this.db
        .insertInto('org_settings')
        .values({ key, value: v })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: v }))
        .execute();
    }
    await this.load();
  }
}
