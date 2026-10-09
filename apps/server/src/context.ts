// SPDX-License-Identifier: AGPL-3.0-only
// The application context passed to every module: config, database, realtime hub, storage...
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { DB, Dialect, DbHandle } from './db/index.js';
import type { Hub } from './realtime/hub.js';
import type { Storage } from './modules/files/storage.js';
import type { SettingsStore } from './modules/admin/settings.js';
import type { RouteDoc } from './lib/route.js';

export interface Ctx {
  config: Config;
  handle: DbHandle;
  db: DB;
  dialect: Dialect;
  hub: Hub;
  storage: Storage;
  settings: SettingsStore;
  log: FastifyBaseLogger;
  routeDocs: RouteDoc[];
  /** Hooks other modules can subscribe to without import cycles. */
  events: AppEvents;
}

export interface AppEvents {
  onMessageCreated: Array<(messageId: string) => void | Promise<void>>;
}
