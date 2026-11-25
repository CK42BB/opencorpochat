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
  import --in FILE|DIR [--dry-run] [--channels a,b] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
         [--include-private] [--include-dms] [--acknowledge-private] [--no-files] [--no-merge]
                                  Import a Slack-format export or a Teams archive (ZIP or folder).
                                  Shows a preview first; --dry-run stops there. Safe to re-run.
  collect-teams --out FILE.zip [--tenant T --client-id C] [--teams a,b]
         [--include-private-channels] [--include-chats] [--download-files] [--since YYYY-MM-DD]
                                  Collect Microsoft Teams data through Microsoft Graph into an
                                  archive for "import". Secret: OCPC_GRAPH_CLIENT_SECRET, or a
                                  token in OCPC_GRAPH_TOKEN. See docs/migration.md.
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
      'dry-run': { type: 'boolean' },
      channels: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      'include-private': { type: 'boolean' },
      'include-dms': { type: 'boolean' },
      'acknowledge-private': { type: 'boolean' },
      'no-files': { type: 'boolean' },
      'no-merge': { type: 'boolean' },
      tenant: { type: 'string' },
      'client-id': { type: 'string' },
      teams: { type: 'string' },
      'include-private-channels': { type: 'boolean' },
      'include-chats': { type: 'boolean' },
      'download-files': { type: 'boolean' },
      'max-file-mb': { type: 'string' },
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

    case 'import':
    case 'import-slack': {
      const input = path.resolve(values.in ?? fail('Provide --in FILE|DIR'));
      const date = (v: string | undefined, name: string) => {
        if (!v) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`--${name} must look like 2024-01-31`);
        return `${v}T00:00:00.000Z`;
      };
      const options = {
        channelIds: undefined as string[] | undefined,
        includePrivate: !!values['include-private'],
        includeDirect: !!values['include-dms'],
        acknowledgePrivate: !!values['acknowledge-private'],
        since: date(values.since, 'since'),
        until: date(values.until, 'until'),
        files: !values['no-files'],
        mergeExisting: !values['no-merge'],
      };
      if ((options.includePrivate || options.includeDirect) && !options.acknowledgePrivate)
        fail(
          'Importing private channels or direct messages requires --acknowledge-private: confirm you have the authority and a lawful basis to move these conversations, and that people have been told.',
        );
      await withApp(async (ctx) => {
        const { analyzeArchive, startImport } = await import('./modules/migration/service.js');
        const owner = await ctx.db
          .selectFrom('users')
          .select('id')
          .where('role', '=', 'owner')
          .where('deactivated_at', 'is', null)
          .orderBy('created_at')
          .executeTakeFirst();
        if (!owner) fail('Run first-time setup before importing');
        const { id, preview } = await analyzeArchive(ctx, {
          archivePath: input,
          fileName: path.basename(input),
          actorId: owner.id,
          ip: 'cli',
          keepArchive: false,
        });
        console.log(`${preview.label}`);
        console.log(
          `People: ${preview.totals.users} (${preview.totals.newUsers} new, created as inactive accounts until claimed)`,
        );
        const wanted = values.channels?.split(',').map((c) => c.trim().replace(/^#/, ''));
        const chosen = preview.channels.filter((c) => {
          if (wanted && !wanted.includes(c.name) && !wanted.includes(c.id)) return false;
          if (c.kind === 'private') return options.includePrivate;
          if (c.kind === 'dm' || c.kind === 'group_dm') return options.includeDirect;
          return true;
        });
        if (wanted) options.channelIds = chosen.map((c) => c.id);
        for (const c of preview.channels) {
          const mark = chosen.includes(c) ? '+' : '-';
          const label = c.kind === 'public' || c.kind === 'private' ? `#${c.name}` : c.name;
          const extra = c.alreadyImported ? `, ${c.alreadyImported} already imported` : '';
          console.log(
            `  ${mark} ${label} [${c.kind}] ${c.messages} messages, ${c.files} files${extra}`,
          );
        }
        if (preview.retention?.olderMessages)
          console.log(
            `Note: ${preview.retention.olderMessages} messages are older than your ${preview.retention.days}-day retention policy and will be deleted by the next retention run.`,
          );
        for (const w of preview.warnings) console.log(`Warning: ${w}`);
        if (values['dry-run']) {
          console.log('Dry run: nothing was imported.');
          return;
        }
        const r = await startImport(ctx, id, options, { id: owner.id, ip: 'cli' }, input);
        for (const c of r.channels)
          console.log(
            `  ${c.name}: ${c.messages} messages, ${c.files} files${c.skippedExisting ? ` (${c.skippedExisting} already imported)` : ''}`,
          );
        console.log(
          `Done: ${r.channels.length} conversations, ${r.totals.messages} messages, ${r.totals.files} files. People: ${r.users.created} created, ${r.users.matched} matched.`,
        );
        if (r.skipped.length)
          console.log(`${r.skipped.length} items skipped; see the report in Admin → Migrate.`);
        console.log(`Import id: ${id}. Undo it from Admin → Migrate if needed.`);
      });
      return;
    }

    case 'collect-teams': {
      const out = path.resolve(values.out ?? fail('Provide --out FILE.zip'));
      if (existsSync(out)) fail(`${out} already exists`);
      const token = process.env.OCPC_GRAPH_TOKEN;
      const clientSecret = process.env.OCPC_GRAPH_CLIENT_SECRET;
      if (!token && !(values.tenant && values['client-id'] && clientSecret))
        fail(
          'Provide --tenant and --client-id with the secret in OCPC_GRAPH_CLIENT_SECRET, or an access token in OCPC_GRAPH_TOKEN',
        );
      const { collectTeams } = await import('./modules/migration/teams-collect.js');
      await collectTeams({
        out,
        token,
        tenantId: values.tenant,
        clientId: values['client-id'],
        clientSecret,
        teams: values.teams
          ?.split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        includePrivateChannels: values['include-private-channels'],
        includeChats: values['include-chats'],
        downloadFiles: values['download-files'],
        maxFileMb: values['max-file-mb'] ? Number(values['max-file-mb']) : undefined,
        since: values.since ? `${values.since}T00:00:00.000Z` : undefined,
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
