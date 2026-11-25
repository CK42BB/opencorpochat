// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openZip, ZipWriter } from '../../lib/zip.js';
import { Client, invite, setupOrg, startTestServer, type TestServer } from '../../test/helpers.js';
import { htmlToMarkdown } from './html.js';
import { openSource } from './model.js';
import { analyzeArchive, startImport, undo } from './service.js';
import { slackToMarkdown } from './slack.js';
import { collectTeams } from './teams-collect.js';
import { TEAMS_MANIFEST } from './teams.js';

const NONE = { includePrivate: false, includeDirect: false, files: true };
const ts = (iso: string) => String(Date.parse(iso) / 1000) + '.000100';

function slackExport(dir: string, extra: object[] = []) {
  mkdirSync(path.join(dir, 'engineering'), { recursive: true });
  mkdirSync(path.join(dir, 'leadership'), { recursive: true });
  mkdirSync(path.join(dir, 'D01'), { recursive: true });
  const w = (f: string, v: unknown) => writeFileSync(path.join(dir, f), JSON.stringify(v));
  w('users.json', [
    { id: 'U1', name: 'olive', profile: { email: 'owner@acme.test', real_name: 'Olive' } },
    {
      id: 'U2',
      name: 'bob',
      profile: { email: 'bob@acme.test', real_name: 'Bob Builder', title: 'Engineer' },
    },
    {
      id: 'U3',
      name: 'carol',
      deleted: true,
      profile: { email: 'carol@acme.test', real_name: 'Carol' },
    },
    { id: 'B1', name: 'deploybot', is_bot: true },
  ]);
  w('channels.json', [
    { id: 'C1', name: 'engineering', members: ['U1', 'U2', 'U3'], purpose: { value: 'Builds' } },
  ]);
  w('groups.json', [{ id: 'G1', name: 'leadership', members: ['U1', 'U2'] }]);
  w('dms.json', [{ id: 'D01', members: ['U1', 'U2'] }]);
  const root = ts('2023-03-01T10:00:00Z');
  w('engineering/2023-03-01.json', [
    {
      type: 'message',
      user: 'U2',
      text: 'Hello <@U1>, *ship it* &amp; `a *b*`',
      ts: root,
      reactions: [{ name: 'tada', users: ['U1', 'U2'] }],
    },
    { type: 'message', user: 'U1', text: 'On it', ts: ts('2023-03-01T10:05:00Z'), thread_ts: root },
    {
      type: 'message',
      subtype: 'channel_join',
      user: 'U3',
      text: 'joined',
      ts: ts('2023-03-01T10:06:00Z'),
    },
    {
      type: 'message',
      user: 'U3',
      text: 'edited note',
      ts: ts('2023-03-01T11:00:00Z'),
      edited: { ts: ts('2023-03-01T11:01:00Z') },
    },
    {
      type: 'message',
      subtype: 'bot_message',
      username: 'deploybot',
      text: 'Deployed v1',
      ts: ts('2023-03-01T12:00:00Z'),
    },
    {
      type: 'message',
      user: 'U2',
      text: 'spec attached',
      ts: ts('2023-03-01T13:00:00Z'),
      files: [
        {
          id: 'F1',
          name: 'spec.pdf',
          mimetype: 'application/pdf',
          url_private_download: 'https://example.com/spec.pdf',
          permalink: 'https://acme.slack.test/files/F1',
        },
      ],
    },
  ]);
  w('engineering/2023-03-02.json', extra);
  w('leadership/2023-03-01.json', [
    { type: 'message', user: 'U1', text: 'Confidential plans', ts: ts('2023-03-01T09:00:00Z') },
  ]);
  w('D01/2023-03-01.json', [
    { type: 'message', user: 'U2', text: 'Private hello', ts: ts('2023-03-01T08:00:00Z') },
  ]);
}

let srv: TestServer;
let owner: Client;
let ownerId: string;
let work: string;

beforeAll(async () => {
  srv = await startTestServer();
  owner = await setupOrg(srv);
  ownerId = (
    await db()
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'owner')
      .executeTakeFirstOrThrow()
  ).id;
  work = mkdtempSync(path.join(tmpdir(), 'ocpc-mig-'));
});
afterAll(async () => {
  await srv.close();
  rmSync(work, { recursive: true, force: true });
});

const db = () => srv.ctx.db;
const messagesIn = async (channelId: string) =>
  db()
    .selectFrom('messages')
    .selectAll()
    .where('channel_id', '=', channelId)
    .orderBy('id')
    .execute();

describe('formats', () => {
  it('converts Slack markup', () => {
    expect(
      slackToMarkdown('*bold* _it_ ~gone~ <https://x.test|site> <#C1|eng> <!here> `*code*`'),
    ).toBe('**bold** _it_ ~~gone~~ [site](https://x.test) #eng @here `*code*`');
  });

  it('converts message HTML', () => {
    const md = htmlToMarkdown(
      '<div><p>Hi <at id="0">Bob</at>, see <a href="https://x.test">this</a> &amp; <b>that</b><br>next</p><ul><li>one</li><li>two</li></ul><pre><code>  indented\n</code></pre><emoji id="smile" alt="🙂" title="Smile"></emoji><script>alert(1)</script></div>',
      { mention: (id) => (id === '0' ? '<@U9>' : undefined) },
    );
    expect(md).toBe(
      'Hi <@U9>, see [this](https://x.test) & **that**\nnext\n- one\n- two\n```\n  indented\n```\n🙂',
    );
  });

  it('round-trips ZIP files', async () => {
    const f = path.join(work, 'rt.zip');
    const z = new ZipWriter(f);
    await z.add('a.txt', 'hello');
    await z.add('dir/b.json', JSON.stringify({ x: 'y'.repeat(1000) }));
    await z.close();
    const r = openZip(f);
    expect(r.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.json']);
    expect(r.entries[0]!.read().toString()).toBe('hello');
    expect(JSON.parse(r.entries[1]!.read().toString()).x).toHaveLength(1000);
    r.close();
  });
});

describe('Slack import', () => {
  let dir: string;
  let importId: string;

  it('previews without writing anything', async () => {
    dir = path.join(work, 'slack');
    slackExport(dir);
    const before = await db().selectFrom('users').select('id').execute();
    const { id, preview } = await analyzeArchive(srv.ctx, {
      archivePath: dir,
      fileName: 'slack',
      actorId: ownerId,
      keepArchive: false,
    });
    importId = id;
    expect(preview.source).toBe('slack');
    expect(preview.channels.map((c) => [c.name, c.kind, c.messages])).toEqual([
      ['engineering', 'public', 5],
      ['leadership', 'private', 1],
      ['olive, bob', 'dm', 1],
    ]);
    expect(preview.users.find((u) => u.id === 'U1')!.match).toBe('existing');
    expect(preview.users.find((u) => u.id === 'U2')!.match).toBe('new');
    expect((await db().selectFrom('users').select('id').execute()).length).toBe(before.length);
  });

  it('refuses private conversations without acknowledgement', async () => {
    await expect(
      startImport(srv.ctx, importId, { ...NONE, includeDirect: true }, { id: ownerId }, dir),
    ).rejects.toThrow(/lawful basis/);
  });

  it('imports public channels with authors, threads, reactions and history marked read', async () => {
    const r = await startImport(srv.ctx, importId, NONE, { id: ownerId }, dir);
    expect(r.channels.map((c) => c.name)).toEqual(['engineering']);
    expect(r.users).toEqual({ created: 2, matched: 1, bots: 1 });
    const ch = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'engineering')
      .executeTakeFirstOrThrow();
    expect(ch.description).toBe('Builds');
    const msgs = await messagesIn(ch.id);
    expect(msgs.map((m) => m.body)).toEqual([
      'Hello @owner, **ship it** & `a *b*`',
      'On it',
      'edited note',
      'Deployed v1',
      'spec attached\n📎 [spec.pdf](https://acme.slack.test/files/F1)',
    ]);
    expect(msgs[0]!.created_at).toBe('2023-03-01T10:00:00.000Z');
    expect(msgs[0]!.reply_count).toBe(1);
    expect(msgs[1]!.thread_root_id).toBe(msgs[0]!.id);
    expect(msgs[2]!.edited_at).toBe('2023-03-01T11:01:00.000Z');
    expect(msgs[3]!.kind).toBe('bot');
    expect(msgs[3]!.as_name).toBe('deploybot');
    const reactions = await db()
      .selectFrom('reactions')
      .selectAll()
      .where('message_id', '=', msgs[0]!.id)
      .execute();
    expect(reactions.map((x) => x.emoji)).toEqual(['🎉', '🎉']);
    // Imported people are inactive members, so history stays attached to them.
    const bob = await db()
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'bob@acme.test')
      .executeTakeFirstOrThrow();
    expect(bob.deactivated_at).not.toBeNull();
    expect(bob.password_hash).toBeNull();
    expect(bob.title).toBe('Engineer');
    const members = await db()
      .selectFrom('channel_members')
      .selectAll()
      .where('channel_id', '=', ch.id)
      .execute();
    expect(members).toHaveLength(3);
    expect(new Set(members.map((m) => m.last_read_message_id))).toEqual(new Set([msgs[4]!.id]));
    // No notifications for history.
    expect((await db().selectFrom('notifications').selectAll().execute()).length).toBe(0);
    // Private conversations were left out.
    expect(
      await db()
        .selectFrom('channels')
        .select('id')
        .where('name', '=', 'leadership')
        .executeTakeFirst(),
    ).toBeUndefined();
    const audit = await db()
      .selectFrom('audit_log')
      .select('action')
      .where('target_id', '=', importId)
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'migration.uploaded',
      'migration.started',
      'migration.completed',
    ]);
  });

  it('is safe to re-run and only adds new messages', async () => {
    slackExport(dir, [
      { type: 'message', user: 'U2', text: 'A later message', ts: ts('2023-03-02T09:00:00Z') },
    ]);
    const { id, preview } = await analyzeArchive(srv.ctx, {
      archivePath: dir,
      fileName: 'slack',
      actorId: ownerId,
      keepArchive: false,
    });
    expect(preview.channels[0]!.alreadyImported).toBe(5);
    const r = await startImport(srv.ctx, id, NONE, { id: ownerId }, dir);
    expect(r.totals).toMatchObject({ messages: 1, skippedExisting: 5 });
    const ch = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'engineering')
      .executeTakeFirstOrThrow();
    expect((await messagesIn(ch.id)).length).toBe(6);
    // Undoing the second run removes only what it added.
    await undo(srv.ctx, id, { id: ownerId });
    expect((await messagesIn(ch.id)).length).toBe(5);
  });

  it('lets people claim their account with an email-bound invite, and not otherwise', async () => {
    const people = await owner.get('/admin/imports/people');
    expect(people.body.people.map((p: any) => p.email)).toEqual(['bob@acme.test']); // carol had left
    const generic = await owner.post('/invites', { role: 'member', channelIds: [] });
    const anon = new Client(srv);
    const steal = await anon.post('/auth/register', {
      inviteCode: generic.body.code,
      email: 'bob@acme.test',
      username: 'bobby',
      displayName: 'Bob',
      password: 'correct-horse-battery',
    });
    expect(steal.status).toBe(409);
    const inv = await owner.post('/admin/imports/people/invite', {});
    expect(inv.body.invites).toHaveLength(1);
    const code = inv.body.invites[0].link.split('/join/')[1];
    const bob = new Client(srv);
    const r = await bob.post('/auth/register', {
      inviteCode: code,
      email: 'bob@acme.test',
      username: 'bobby',
      displayName: 'Bob B',
      password: 'correct-horse-battery',
    });
    expect(r.status).toBe(200);
    const me = await db()
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'bob@acme.test')
      .executeTakeFirstOrThrow();
    expect(me.deactivated_at).toBeNull();
    expect(me.username).toBe('bobby');
    const ch = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'engineering')
      .executeTakeFirstOrThrow();
    const hist = await bob.get(`/channels/${ch.id}/messages`);
    expect(hist.status).toBe(200);
    expect(hist.body.messages.some((m: any) => m.body === 'On it')).toBe(false); // replies live in threads
    expect(
      hist.body.messages.some((m: any) => m.userId === me.id && m.body.startsWith('Hello')),
    ).toBe(true);
    expect((await owner.get('/admin/imports/people')).body.people).toEqual([]);
  });

  it('undoes an import but keeps claimed accounts', async () => {
    const counts = await undo(srv.ctx, importId, { id: ownerId });
    expect(counts.channels).toBe(1);
    expect(
      await db()
        .selectFrom('channels')
        .select('id')
        .where('name', '=', 'engineering')
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await db()
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'bob@acme.test')
        .executeTakeFirst(),
    ).toBeDefined();
    expect(
      await db()
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'carol@acme.test')
        .executeTakeFirst(),
    ).toBeUndefined();
    const row = await db()
      .selectFrom('imports')
      .selectAll()
      .where('id', '=', importId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('undone');
  });

  it('imports private channels and DMs when acknowledged, through the API', async () => {
    const zip = path.join(work, 'slack.zip');
    const z = new ZipWriter(zip);
    const walk = (d: string, base = ''): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [`${base}${e.name}`],
      );
    for (const f of walk(dir)) await z.add(`export/${f}`, readFileSync(path.join(dir, f)));
    await z.close();
    const boundary = '----ocpcmig';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="export.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      ),
      readFileSync(zip),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await owner.req('POST', '/admin/imports', payload, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    expect(up.status).toBe(200);
    expect(up.body.status).toBe('ready');
    expect(up.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const denied = await owner.post(`/admin/imports/${up.body.id}/start`, {
      includeDirect: true,
      includePrivate: true,
    });
    expect(denied.status).toBe(400);
    const member = await invite(owner, srv, 'mallory');
    expect((await member.client.get('/admin/imports')).status).toBe(403);
    const start = await owner.post(`/admin/imports/${up.body.id}/start`, {
      includeDirect: true,
      includePrivate: true,
      acknowledgePrivate: true,
      since: '2023-01-01',
    });
    expect(start.status).toBe(200);
    let status = '';
    for (let i = 0; i < 200 && status !== 'completed' && status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = (await owner.get(`/admin/imports/${up.body.id}`)).body.status;
    }
    expect(status).toBe('completed');
    const lead = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'leadership')
      .executeTakeFirstOrThrow();
    expect(lead.kind).toBe('private');
    const dm = await db()
      .selectFrom('channels')
      .selectAll()
      .where('kind', '=', 'dm')
      .executeTakeFirstOrThrow();
    expect((await messagesIn(dm.id)).map((m) => m.body)).toEqual(['Private hello']);
    const report = await owner.get(`/admin/imports/${up.body.id}/report`);
    expect(report.body.import.report.channels).toHaveLength(3);
    expect(report.body.auditTrail.map((a: any) => a.action)).toContain('migration.started');
    const del = await owner.del(`/admin/imports/${up.body.id}/archive`);
    expect(del.status).toBe(204);
    expect((await owner.get(`/admin/imports/${up.body.id}`)).body.hasArchive).toBe(false);
  });
});

describe('merging', () => {
  it('adds history to an existing channel of the same type, or makes a renamed copy', async () => {
    const dir = path.join(work, 'merge');
    mkdirSync(path.join(dir, 'random'), { recursive: true });
    writeFileSync(
      path.join(dir, 'users.json'),
      JSON.stringify([{ id: 'U7', name: 'zed', profile: { email: 'zed@acme.test' } }]),
    );
    writeFileSync(
      path.join(dir, 'channels.json'),
      JSON.stringify([{ id: 'C7', name: 'random', members: ['U7'] }]),
    );
    writeFileSync(
      path.join(dir, 'random', '2022-01-01.json'),
      JSON.stringify([
        { type: 'message', user: 'U7', text: 'old banter', ts: ts('2022-01-01T10:00:00Z') },
      ]),
    );
    const random = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'random')
      .executeTakeFirstOrThrow();
    const a = await analyzeArchive(srv.ctx, {
      archivePath: dir,
      fileName: 'm',
      actorId: ownerId,
      keepArchive: false,
    });
    await startImport(srv.ctx, a.id, NONE, { id: ownerId }, dir);
    expect((await messagesIn(random.id)).some((m) => m.body === 'old banter')).toBe(true);
    const zed = await db()
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'zed@acme.test')
      .executeTakeFirstOrThrow();
    expect(
      await db()
        .selectFrom('channel_members')
        .select('user_id')
        .where('channel_id', '=', random.id)
        .where('user_id', '=', zed.id)
        .executeTakeFirst(),
    ).toBeDefined();
    // Undo keeps the existing channel and removes only the imported messages.
    await undo(srv.ctx, a.id, { id: ownerId });
    expect(
      await db().selectFrom('channels').select('id').where('id', '=', random.id).executeTakeFirst(),
    ).toBeDefined();
    expect((await messagesIn(random.id)).some((m) => m.body === 'old banter')).toBe(false);

    const b = await analyzeArchive(srv.ctx, {
      archivePath: dir,
      fileName: 'm',
      actorId: ownerId,
      keepArchive: false,
    });
    await startImport(srv.ctx, b.id, { ...NONE, mergeExisting: false }, { id: ownerId }, dir);
    const copy = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'random-imported')
      .executeTakeFirstOrThrow();
    expect((await messagesIn(copy.id)).map((m) => m.body)).toEqual(['old banter']);
  });
});

describe('Teams', () => {
  const G = 'https://graph.microsoft.com/v1.0';
  const img = `${G}/teams/T1/channels/19%3Ac1/messages/m1/hostedContents/h1/$value`;

  function fakeGraph() {
    const calls: string[] = [];
    const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(v), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    let throttled = false;
    const routes: Record<string, () => Response> = {
      '/users?$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled&$top=999': () =>
        json({
          value: [
            { id: 'u-ann', displayName: 'Ann Admin', mail: 'ann@acme.test', jobTitle: 'CTO' },
            { id: 'u-dan', displayName: 'Dan Dev', userPrincipalName: 'dan@acme.test' },
          ],
        }),
      '/teams?$select=id,displayName,description,isArchived': () =>
        json({
          value: [
            { id: 'T1', displayName: 'Product', description: 'Product team' },
            { id: 'T2', displayName: 'Other' },
          ],
        }),
      '/teams/T1/members': () =>
        json({
          value: [
            { userId: 'u-ann', displayName: 'Ann Admin', email: 'ann@acme.test' },
            { userId: 'u-dan', displayName: 'Dan Dev', email: 'dan@acme.test' },
          ],
        }),
      '/teams/T1/channels': () =>
        json({
          value: [
            { id: '19:c1', displayName: 'General', membershipType: 'standard' },
            { id: '19:c2', displayName: 'Secret', membershipType: 'private' },
          ],
        }),
      '/teams/T1/channels/19%3Ac1/messages?$top=50&$expand=replies': () => {
        if (!throttled) {
          throttled = true;
          return json({}, 429, { 'retry-after': '1' });
        }
        return json({
          value: [
            {
              id: 'm1',
              messageType: 'message',
              createdDateTime: '2024-05-01T09:00:00Z',
              subject: 'Launch',
              from: { user: { id: 'u-ann', displayName: 'Ann Admin' } },
              body: {
                contentType: 'html',
                content: `<p>Ready, <at id="0">Dan Dev</at>?</p><img src="${img}">`,
              },
              mentions: [{ id: 0, mentionText: 'Dan Dev', mentioned: { user: { id: 'u-dan' } } }],
              reactions: [{ reactionType: 'like', user: { user: { id: 'u-dan' } } }],
              attachments: [
                {
                  contentType: 'reference',
                  contentUrl: 'https://acme.sharepoint.test/plan.docx',
                  name: 'plan.docx',
                },
              ],
              replies: [
                {
                  id: 'm2',
                  replyToId: 'm1',
                  messageType: 'message',
                  createdDateTime: '2024-05-01T09:05:00Z',
                  from: { user: { id: 'u-dan' } },
                  body: { contentType: 'html', content: '<p>Yes!</p>' },
                },
                {
                  id: 'm3',
                  replyToId: 'm1',
                  messageType: 'message',
                  createdDateTime: '2024-05-01T09:06:00Z',
                  deletedDateTime: '2024-05-01T09:07:00Z',
                  from: { user: { id: 'u-dan' } },
                  body: { contentType: 'html', content: '' },
                },
              ],
            },
            {
              id: 'm0',
              messageType: 'systemEventMessage',
              createdDateTime: '2024-04-01T00:00:00Z',
              body: { content: '<systemEventMessage/>' },
            },
          ],
          '@odata.nextLink': `${G}/teams/T1/channels/19%3Ac1/messages?page=2`,
        });
      },
      '/teams/T1/channels/19%3Ac1/messages?page=2': () =>
        json({
          value: [
            {
              id: 'm4',
              messageType: 'message',
              createdDateTime: '2024-05-02T10:00:00Z',
              from: { application: { displayName: 'Build Bot' } },
              body: { contentType: 'text', content: 'build green' },
              replies: [],
            },
          ],
        }),
      '/teams/T1/channels/19%3Ac1/messages/m1/hostedContents/h1/$value': () =>
        new Response(Buffer.from('PNGDATA'), { headers: { 'content-type': 'image/png' } }),
      '/users/u-ann/chats?$select=id,topic,chatType': () =>
        json({ value: [{ id: 'chat1', chatType: 'oneOnOne' }] }),
      '/users/u-dan/chats?$select=id,topic,chatType': () =>
        json({ value: [{ id: 'chat1', chatType: 'oneOnOne' }] }),
      '/chats/chat1/members': () =>
        json({
          value: [
            { userId: 'u-ann', displayName: 'Ann Admin' },
            { userId: 'u-dan', displayName: 'Dan Dev' },
          ],
        }),
      '/chats/chat1/messages?$top=50': () =>
        json({
          value: [
            {
              id: 'x1',
              messageType: 'message',
              createdDateTime: '2024-05-03T10:00:00Z',
              from: { user: { id: 'u-dan' } },
              body: { contentType: 'html', content: 'Lunch?' },
              reactions: [{ reactionType: '🍕', user: { user: { id: 'u-ann' } } }],
            },
          ],
        }),
    };
    const fetch: typeof globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/')) {
        expect(String(init?.body)).toContain('grant_type=client_credentials');
        return json({ access_token: 'tok', expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      const route = routes[url.replace(G, '')];
      return route ? route() : json({ error: { message: `no route ${url}` } }, 404);
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }

  it('collects through Microsoft Graph and imports the archive', async () => {
    const g = fakeGraph();
    const out = path.join(work, 'teams.zip');
    const res = await collectTeams({
      out,
      tenantId: 'tenant-1',
      clientId: 'app',
      clientSecret: 'secret',
      teams: ['product'],
      includeChats: true,
      fetch: g.fetch,
      sleep: async () => {},
      log: () => {},
    });
    expect(res.warnings).toEqual([]);
    expect(res).toMatchObject({ teams: 1, messages: 6, files: 1 });
    // Private channel skipped unless asked; other team never touched.
    expect(g.calls.some((c) => c.includes('19%3Ac2'))).toBe(false);
    expect(g.calls.some((c) => c.includes('/teams/T2'))).toBe(false);
    const zip = openZip(out);
    const manifest = JSON.parse(
      zip.entries
        .find((e) => e.name === TEAMS_MANIFEST)!
        .read()
        .toString(),
    );
    expect(manifest.tenantId).toBe('tenant-1');
    expect(Object.keys(manifest.files)).toContain('users.json');
    zip.close();

    const src = await openSource(out);
    expect(src.kind).toBe('teams');
    expect(src.channels.map((c) => [c.name, c.kind])).toEqual([
      ['Product', 'public'],
      ['Ann Admin, Dan Dev', 'dm'],
    ]);
    src.close();

    const { id, preview } = await analyzeArchive(srv.ctx, {
      archivePath: out,
      fileName: 'teams.zip',
      actorId: ownerId,
      keepArchive: false,
    });
    expect(preview.totals).toMatchObject({ messages: 4, newUsers: 2 });
    const r = await startImport(
      srv.ctx,
      id,
      { includePrivate: false, includeDirect: true, acknowledgePrivate: true, files: true },
      { id: ownerId },
      out,
    );
    expect(r.totals).toMatchObject({ messages: 4, files: 1 });
    const ch = await db()
      .selectFrom('channels')
      .selectAll()
      .where('name', '=', 'product')
      .executeTakeFirstOrThrow();
    expect(ch.description).toBe('Product team');
    const msgs = await messagesIn(ch.id);
    const ann = await db()
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'ann@acme.test')
      .executeTakeFirstOrThrow();
    const dan = await db()
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'dan@acme.test')
      .executeTakeFirstOrThrow();
    expect(msgs.map((m) => m.body)).toEqual([
      `**Launch**\nReady, @${dan.username}?\n📎 [plan.docx](https://acme.sharepoint.test/plan.docx)`,
      'Yes!',
      'build green',
    ]);
    expect(msgs[0]!.user_id).toBe(ann.id);
    expect(msgs[1]!.thread_root_id).toBe(msgs[0]!.id);
    expect(msgs[2]!.as_name).toBe('Build Bot');
    const file = await db()
      .selectFrom('files')
      .selectAll()
      .where('message_id', '=', msgs[0]!.id)
      .executeTakeFirstOrThrow();
    expect(file.mime).toBe('image/png');
    expect(Number(file.size)).toBe(7);
    const dm = await db()
      .selectFrom('channels')
      .selectAll()
      .where('kind', '=', 'dm')
      .where('dm_key', 'like', `%${dan.id}%`)
      .executeTakeFirstOrThrow();
    const dmMsgs = await messagesIn(dm.id);
    expect(dmMsgs.map((m) => m.body)).toEqual(['Lunch?']);
    const pizza = await db()
      .selectFrom('reactions')
      .selectAll()
      .where('message_id', '=', dmMsgs[0]!.id)
      .execute();
    expect(pizza.map((p) => p.emoji)).toEqual(['🍕']);
  });

  it('never sends credentials outside Microsoft Graph', async () => {
    const out = path.join(work, 'evil.zip');
    const fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/teams?$select=id,displayName,description,isArchived'))
        return new Response(
          JSON.stringify({ value: [], '@odata.nextLink': 'https://evil.test/steal' }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as typeof globalThis.fetch;
    await expect(collectTeams({ out, token: 'tok', fetch, log: () => {} })).rejects.toThrow(
      /Refusing to send credentials/,
    );
  });
});
