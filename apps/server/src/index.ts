#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// OpenCorpoChat server entry point.
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { startStunServer } from './realtime/stun.js';

async function main() {
  const config = loadConfig();
  const { app, stop } = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `OpenCorpoChat listening on ${config.publicUrl} (db: ${config.database.kind}, storage: ${config.s3 ? 's3' : 'local'})`,
  );
  if (!config.webDir) app.log.warn('Web client build not found; serving the API only.');
  const stopStun = config.stun.port
    ? startStunServer(config.stun.port, config.host, (m) => app.log.info(m))
    : () => {};
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      app.log.info(`${sig} received, shutting down`);
      stopStun();
      await stop().catch(() => {});
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
