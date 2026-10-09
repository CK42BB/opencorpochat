#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// `ocpc` administration CLI. Run `ocpc help` for usage.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  createWriteStream,
} from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import {
  email as emailSchema,
  password as passwordSchema,
  username as usernameSchema,
  VERSION,
} from '@ocpc/shared';
import { generateVapidKeys, loadConfig } from './config.js';
import { migrate, openDatabase, rebuildSearchIndex } from './db/index.js';
import { hashPassword, randomToken } from './lib/crypto.js';

const HELP = `OpenCorpoChat ${VERSION} — administration CLI

Usage: ocpc <command> [options]

Commands:
  migrate                         Apply database migrations
  create-admin --email E --username U [--password P] [--name N]
                                  Create an owner account (password generated if omitted)
  reset-password --email E [--password P]
                                  Set a new password (generated if omitted)
  backup --out DIR                SQLite: consistent copy of the DB + files into DIR
  restore --in DIR                Restore a backup made with "backup" (stop the server first)
  export --out FILE               Export the organization as NDJSON
  import-slack --in FILE|DIR      Import a Slack-format workspace export (ZIP or folder)
  seed-demo [--password P] [--force]
                                  Fill an EMPTY instance with a fictional demo company to explore
  generate-vapid                  Print a new VAPID key pair for Web Push
  --version                       Print version
`;

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function withApp<T>(fn: (ctx: import('./context.js').Ctx) => Promise<T>) {
  const { buildApp } = await import('./app.js');
  const config = loadConfig(process.env, { OCPC_LOG_LEVEL: 'warn' } as never);
  const built = await buildApp(config, { scheduler: false, logger: false });
  try {
    return await fn(built.ctx);
  } finally {
    await built.stop();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      in: { type: 'string' },
      force: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    case '--version':
    case 'version':
      console.log(VERSION);
      return;

    case 'generate-vapid': {
      const k = generateVapidKeys();
      console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
      return;
    }

    case 'migrate': {
      const config = loadConfig();
      const handle = await openDatabase(config);
      const applied = await migrate(handle);
      await handle.close();
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
      return;
    }

    case 'create-admin': {
      const email = emailSchema.safeParse(values.email);
      const username = usernameSchema.safeParse(values.username);
      if (!email.success || !username.success) fail('Provide a valid --email and --username');
      const pw = values.password ?? randomToken(12);
      if (!passwordSchema.safeParse(pw).success) fail('Password must be at least 10 characters');
      await withApp(async (ctx) => {
        const { insertUser, isUsernameTaken, findUserByLogin } =
          await import('./modules/users/service.js');
        const { joinDefaultChannels } = await import('./modules/channels/service.js');
        if (await findUserByLogin(ctx, email.data)) fail('A user with that email already exists');
        if (await isUsernameTaken(ctx, username.data)) fail('That username is taken');
        const u = await insertUser(ctx, {
          email: email.data,
          username: username.data,
          displayName: values.name ?? username.data,
          role: 'owner',
          passwordHash: await hashPassword(pw),
        });
        if (!ctx.settings.get().setupComplete) await ctx.settings.update({ setupComplete: true });
        await joinDefaultChannels(ctx, u.id);
        console.log(`Created owner @${u.username} <${u.email}>`);
        if (!values.password) console.log(`Temporary password: ${pw}`);
      });
      return;
    }

    case 'reset-password': {
      if (!values.email) fail('Provide --email');
      const pw = values.password ?? randomToken(12);
      if (!passwordSchema.safeParse(pw).success) fail('Password must be at least 10 characters');
      await withApp(async (ctx) => {
        const { findUserByLogin } = await import('./modules/users/service.js');
        const u = await findUserByLogin(ctx, values.email!);
        if (!u) fail('No such user');
        await ctx.db
          .updateTable('users')
          .set({ password_hash: await hashPassword(pw) })
          .where('id', '=', u.id)
          .execute();
        await ctx.db.deleteFrom('sessions').where('user_id', '=', u.id).execute();
        console.log(
          `Password reset for @${u.username}.${values.password ? '' : ` New password: ${pw}`}`,
        );
      });
      return;
    }

    case 'backup': {
      const out = values.out ?? fail('Provide --out DIR');
      const config = loadConfig();
      if (config.database.kind !== 'sqlite') {
        fail(
          'For PostgreSQL use pg_dump for the database, and back up OCPC_DATA_DIR (and your S3 bucket) separately.',
        );
      }
      mkdirSync(out, { recursive: true });
      const target = path.join(out, 'ocpc.db');
      if (existsSync(target)) fail(`${target} already exists`);
      const Sqlite = (await import('better-sqlite3')).default;
      const db = new Sqlite(config.database.file, { readonly: true });
      await db.backup(target);
      db.close();
      if (!config.s3) cpSync(config.filesDir, path.join(out, 'files'), { recursive: true });
      for (const f of ['secret.key', 'vapid.json']) {
        if (existsSync(path.join(config.dataDir, f)))
          copyFileSync(path.join(config.dataDir, f), path.join(out, f));
      }
      writeFileSync(
        path.join(out, 'backup.json'),
        JSON.stringify(
          { version: VERSION, createdAt: new Date().toISOString(), s3: !!config.s3 },
          null,
          2,
        ),
      );
      console.log(
        `Backup written to ${out}${config.s3 ? ' (files are in S3 and were not copied)' : ''}`,
      );
      return;
    }

    case 'restore': {
      const input = values.in ?? fail('Provide --in DIR');
      const meta = path.join(input, 'backup.json');
      if (!existsSync(meta)) fail('Not a backup directory (backup.json missing)');
      const config = loadConfig();
      if (config.database.kind !== 'sqlite') fail('Restore supports SQLite backups only');
      const info = JSON.parse(readFileSync(meta, 'utf8'));
      for (const suffix of ['', '-wal', '-shm'])
        rmSync(config.database.file + suffix, { force: true });
      copyFileSync(path.join(input, 'ocpc.db'), config.database.file);
      if (existsSync(path.join(input, 'files'))) {
        rmSync(config.filesDir, { recursive: true, force: true });
        cpSync(path.join(input, 'files'), config.filesDir, { recursive: true });
      }
      for (const f of ['secret.key', 'vapid.json']) {
        if (existsSync(path.join(input, f)))
          copyFileSync(path.join(input, f), path.join(config.dataDir, f));
      }
      const handle = await openDatabase(config);
      await migrate(handle);
      await rebuildSearchIndex(handle);
      await handle.close();
      console.log(`Restored backup from ${info.createdAt} (version ${info.version}).`);
      return;
    }

    case 'export': {
      const out = values.out ?? fail('Provide --out FILE');
      await withApp(async (ctx) => {
        const { exportStream } = await import('./modules/admin/export.js');
        await pipeline(exportStream(ctx), createWriteStream(out));
        console.log(`Exported to ${out}`);
      });
      return;
    }

    case 'import-slack': {
      const input = values.in ?? fail('Provide --in FILE|DIR');
      await withApp(async (ctx) => {
        const { importSlackExport } = await import('./modules/admin/import-slack.js');
        await importSlackExport(ctx, input);
      });
      return;
    }

    case 'seed-demo': {
      await withApp(async (ctx) => {
        const { seedDemo } = await import('./modules/admin/seed-demo.js');
        const r = await seedDemo(ctx, { force: values.force, password: values.password });
        console.log(
          `Demo company "Brightfield Studio" created: ${r.people} people, ${r.channels} channels.`,
        );
        console.log(`Sign in as ${r.email} with password: ${r.password}`);
        console.log(
          '(Every demo account uses the same password. Usernames: jordan, maya, sam, priya, leo, ...)',
        );
      });
      return;
    }

    default:
      console.log(HELP);
      fail(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
