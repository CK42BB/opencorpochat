// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, invite, setupOrg, startTestServer, type TestServer } from './test/helpers.js';
import { totpCode } from './lib/crypto.js';

let srv: TestServer;
let owner: Client;
let alice: Client;
let aliceId: string;
let bob: Client;
let bobId: string;
let general: any;

beforeAll(async () => {
  srv = await startTestServer();
  owner = await setupOrg(srv);
  ({ client: alice, me: { id: aliceId } } = await invite(owner, srv, 'alice'));
  ({ client: bob, me: { id: bobId } } = await invite(owner, srv, 'bob'));
  const boot = await owner.get('/bootstrap');
  general = boot.body.channels.find((c: any) => c.name === 'general');
});
afterAll(async () => srv?.close());

describe('setup & auth', () => {
  it('reports setup complete and refuses a second setup', async () => {
    const info = await new Client(srv).get('/info');
    expect(info.body.setupRequired).toBe(false);
    expect(info.body.orgName).toBe('Acme');
    const again = await new Client(srv).post('/setup', { orgName: 'x', email: 'x@x.io', username: 'xx', displayName: 'x', password: 'correct-horse-battery' });
    expect(again.status).toBe(409);
  });

  it('new members join the default channels', async () => {
    const boot = await alice.get('/bootstrap');
    expect(boot.body.channels.map((c: any) => c.name).sort()).toEqual(['general', 'random']);
    expect(boot.body.users.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects bad passwords and requires auth', async () => {
    const c = new Client(srv);
    expect((await c.post('/auth/login', { login: 'alice', password: 'wrong-password' })).status).toBe(401);
    expect((await c.get('/bootstrap')).status).toBe(401);
  });

  it('enforces the CSRF header for cookie sessions', async () => {
    const r = await alice.req('POST', '/channels', { name: 'nocsrf' }, { 'x-ocpc-csrf': '' });
    expect(r.status).toBe(403);
  });

  it('supports TOTP two-factor login', async () => {
    const { client: carol } = await invite(owner, srv, 'carol');
    const setup = await carol.post('/auth/totp/setup');
    const enable = await carol.post('/auth/totp/enable', { secret: setup.body.secret, code: totpCode(setup.body.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);
    const fresh = new Client(srv);
    const noCode = await fresh.post('/auth/login', { login: 'carol', password: 'correct-horse-battery' });
    expect(noCode.body.error).toBe('totp_required');
    const ok = await fresh.post('/auth/login', { login: 'carol', password: 'correct-horse-battery', totp: totpCode(setup.body.secret) });
    expect(ok.status).toBe(200);
    // Recovery codes work exactly once.
    const code = enable.body.recoveryCodes[0];
    expect((await new Client(srv).post('/auth/login', { login: 'carol', password: 'correct-horse-battery', totp: code })).status).toBe(200);
    expect((await new Client(srv).post('/auth/login', { login: 'carol', password: 'correct-horse-battery', totp: code })).status).toBe(401);
  });
});

describe('messaging', () => {
  it('posts, mentions, unread and mention counts', async () => {
    const r = await alice.post(`/channels/${general.id}/messages`, { body: 'Hello @bob :wave: see https://example.invalid' });
    expect(r.status).toBe(200);
    expect(r.body.body).toBe('Hello @bob 👋 see https://example.invalid');
    const boot = await bob.get('/bootstrap');
    const g = boot.body.channels.find((c: any) => c.id === general.id);
    expect(g.unreadCount).toBeGreaterThanOrEqual(1);
    expect(g.mentionCount).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    const notes = await bob.get('/notifications');
    expect(notes.body.some((n: any) => n.kind === 'mention' && n.messageId === r.body.id)).toBe(true);
    await bob.post(`/channels/${general.id}/read`, { messageId: r.body.id });
    const after = (await bob.get('/bootstrap')).body.channels.find((c: any) => c.id === general.id);
    expect(after.unreadCount).toBe(0);
    expect(after.mentionCount).toBe(0);
  });

  it('threads, reactions, pins, saves, edits and deletes', async () => {
    const root = (await alice.post(`/channels/${general.id}/messages`, { body: 'Thread root' })).body;
    const reply = await bob.post(`/channels/${general.id}/messages`, { body: 'A reply', threadRootId: root.id });
    expect(reply.status).toBe(200);
    const thread = await alice.get(`/messages/${root.id}/thread`);
    expect(thread.body.root.replyCount).toBe(1);
    expect(thread.body.replies[0].body).toBe('A reply');
    // Replies don't show in the channel list unless also sent to channel.
    const list = await alice.get(`/channels/${general.id}/messages`);
    expect(list.body.messages.some((m: any) => m.id === reply.body.id)).toBe(false);
    // Alice follows her thread and sees it in /threads.
    const threads = await alice.get('/threads');
    expect(threads.body[0].root.id).toBe(root.id);
    expect(threads.body[0].unread).toBe(true);

    const react = await bob.post(`/messages/${root.id}/reactions`, { emoji: '🎉' });
    expect(react.body).toEqual([{ emoji: '🎉', count: 1, userIds: [bobId] }]);
    await bob.del(`/messages/${root.id}/reactions/${encodeURIComponent('🎉')}`);
    expect((await alice.get(`/messages/${root.id}`)).body.reactions).toEqual([]);

    await alice.post(`/messages/${root.id}/pin`);
    expect((await bob.get(`/channels/${general.id}/pins`)).body[0].id).toBe(root.id);
    await bob.post(`/messages/${root.id}/save`);
    expect((await bob.get('/saved')).body[0].id).toBe(root.id);

    expect((await bob.patch(`/messages/${root.id}`, { body: 'hijack' })).status).toBe(403);
    const edited = await alice.patch(`/messages/${root.id}`, { body: 'Thread root (edited)' });
    expect(edited.body.editedAt).toBeTruthy();

    expect((await bob.del(`/messages/${root.id}`)).status).toBe(403);
    expect((await owner.del(`/messages/${reply.body.id}`)).status).toBe(204);
    const afterDel = await alice.get(`/messages/${root.id}/thread`);
    expect(afterDel.body.root.replyCount).toBe(0);
    expect(afterDel.body.replies[0].deleted).toBe(true);
  });

  it('DMs and group DMs are reused and private', async () => {
    const dm1 = await alice.post('/dms', { userIds: [bobId] });
    const dm2 = await bob.post('/dms', { userIds: [aliceId] });
    expect(dm1.body.id).toBe(dm2.body.id);
    expect(dm1.body.kind).toBe('dm');
    await alice.post(`/channels/${dm1.body.id}/messages`, { body: 'secret' });
    const ownerView = await owner.get(`/channels/${dm1.body.id}/messages`);
    expect(ownerView.status).toBe(404);
    const bobBoot = await bob.get('/bootstrap');
    const dm = bobBoot.body.channels.find((c: any) => c.id === dm1.body.id);
    expect(dm.mentionCount).toBe(1);
  });

  it('private channels are invisible to non-members', async () => {
    const ch = await alice.post('/channels', { name: 'secret-plans', kind: 'private' });
    expect(ch.status).toBe(200);
    const dir = await bob.get('/channels');
    expect(dir.body.some((c: any) => c.name === 'secret-plans')).toBe(false);
    expect((await bob.get(`/channels/${ch.body.id}`)).status).toBe(404);
    expect((await bob.post(`/channels/${ch.body.id}/join`)).status).toBe(404);
    await alice.post(`/channels/${ch.body.id}/members`, { userIds: [bobId] });
    expect((await bob.get(`/channels/${ch.body.id}`)).status).toBe(200);
  });

  it('announcement channels restrict posting to admins', async () => {
    const ch = await owner.post('/channels', { name: 'announcements', isReadonly: true });
    await alice.post(`/channels/${ch.body.id}/join`);
    expect((await alice.post(`/channels/${ch.body.id}/messages`, { body: 'hi' })).status).toBe(403);
    expect((await owner.post(`/channels/${ch.body.id}/messages`, { body: 'Company update' })).status).toBe(200);
  });

  it('polls', async () => {
    const m = await alice.post(`/channels/${general.id}/messages`, { body: '', poll: { question: 'Lunch?', options: ['Pizza', 'Tacos'] } });
    expect(m.body.poll.options).toHaveLength(2);
    await bob.post(`/messages/${m.body.id}/vote`, { optionIds: ['2'] });
    const after = await alice.get(`/messages/${m.body.id}`);
    expect(after.body.poll.options[1].voterIds).toEqual([bobId]);
  });
});

describe('search', () => {
  it('finds messages with text and filters, respecting access', async () => {
    await alice.post(`/channels/${general.id}/messages`, { body: 'The quarterly budget review is Friday' });
    const priv = await alice.post('/channels', { name: 'budget-private', kind: 'private' });
    await alice.post(`/channels/${priv.body.id}/messages`, { body: 'confidential budget numbers' });
    const r = await bob.get(`/search?q=${encodeURIComponent('budget')}`);
    expect(r.body.messages.map((m: any) => m.body)).toEqual(['The quarterly budget review is Friday']);
    const prefix = await alice.get(`/search?q=${encodeURIComponent('quarter')}`);
    expect(prefix.body.messages.length).toBe(1);
    const filtered = await alice.get(`/search?q=${encodeURIComponent('budget from:@alice in:#budget-private')}`);
    expect(filtered.body.messages.map((m: any) => m.body)).toEqual(['confidential budget numbers']);
  });
});

describe('files', () => {
  it('uploads, attaches and enforces access', async () => {
    const boundary = '----ocpc';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello file\r\n--${boundary}--\r\n`;
    const up = await alice.req('POST', '/files', payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(200);
    expect(up.body.size).toBe(10);
    // Not visible to others until attached.
    expect((await bob.get(`/files/${up.body.id}/notes.txt`)).status).toBe(404);
    const priv = await alice.post('/channels', { name: 'files-private', kind: 'private' });
    const msg = await alice.post(`/channels/${priv.body.id}/messages`, { body: 'see attached', fileIds: [up.body.id] });
    expect(msg.body.files[0].name).toBe('notes.txt');
    const dl = await alice.get(`/files/${up.body.id}/notes.txt`);
    expect(dl.raw.body).toBe('hello file');
    expect(dl.raw.headers['x-content-type-options']).toBe('nosniff');
    expect((await bob.get(`/files/${up.body.id}/notes.txt`)).status).toBe(404);
  });
});

describe('guests', () => {
  it('only see channels they are invited to', async () => {
    const ch = await owner.post('/channels', { name: 'client-project', kind: 'private' });
    const { client: guest } = await invite(owner, srv, 'gary', 'guest', [ch.body.id]);
    const boot = await guest.get('/bootstrap');
    expect(boot.body.channels.map((c: any) => c.name)).toEqual(['client-project']);
    expect((await guest.get(`/channels/${general.id}/messages`)).status).toBe(404);
    expect((await guest.get('/channels')).body).toEqual([]);
    expect((await guest.post('/channels', { name: 'guest-made' })).status).toBe(403);
    // Guests can only see people they share a channel with.
    expect(boot.body.users.map((u: any) => u.username).sort()).toEqual(['gary', 'owner']);
  });
});

describe('integrations', () => {
  it('incoming webhooks post into a channel', async () => {
    const hook = await alice.post('/webhooks', { kind: 'incoming', name: 'CI', channelId: general.id });
    const url = new URL(hook.body.postUrl);
    const res = await srv.app.inject({ method: 'POST', url: url.pathname, payload: { text: 'Build passed ✅', username: 'CI Bot' } });
    expect(res.statusCode).toBe(200);
    const list = await alice.get(`/channels/${general.id}/messages?limit=1`);
    expect(list.body.messages[0].body).toBe('Build passed ✅');
    expect(list.body.messages[0].asName).toBe('CI Bot');
    const bad = await srv.app.inject({ method: 'POST', url: url.pathname.replace(/[^/]+$/, 'wrong'), payload: { text: 'x' } });
    expect(bad.statusCode).toBe(401);
  });

  it('bearer tokens with scopes', async () => {
    const t = await alice.post('/tokens', { name: 'script', scopes: ['read'] });
    const auth = { authorization: `Bearer ${t.body.token}` };
    const anon = new Client(srv);
    expect((await anon.req('GET', '/me', undefined, auth)).body.username).toBe('alice');
    const write = await anon.req('POST', `/channels/${general.id}/messages`, { body: 'x' }, auth);
    expect(write.status).toBe(403);
  });

  it('bots can be created and post with their token', async () => {
    const r = await owner.post('/bots', { username: 'deploybot', displayName: 'Deploy Bot' });
    expect(r.status).toBe(200);
    await owner.post(`/channels/${general.id}/members`, { userIds: [r.body.bot.id] });
    const anon = new Client(srv);
    const post = await anon.req('POST', `/channels/${general.id}/messages`, { body: 'Deployed v1.2' }, { authorization: `Bearer ${r.body.token.token}` });
    expect(post.status).toBe(200);
    expect(post.body.kind).toBe('bot');
  });

  it('slash commands: /remind, /status, unknown', async () => {
    const r = await alice.post('/commands/run', { channelId: general.id, text: '/remind me in 10m to stretch' });
    expect(r.body.ephemeral).toMatch(/stretch/);
    expect((await alice.get('/reminders')).body[0].text).toBe('stretch');
    await alice.post('/commands/run', { channelId: general.id, text: '/status :coffee: Brewing' });
    expect((await alice.get('/me')).body.statusEmoji).toBe('☕');
    expect((await alice.post('/commands/run', { channelId: general.id, text: '/nope' })).status).toBe(404);
  });
});

describe('admin', () => {
  it('members cannot reach admin endpoints', async () => {
    expect((await alice.get('/admin/users')).status).toBe(403);
    expect((await alice.patch('/admin/settings', { name: 'x' })).status).toBe(403);
  });

  it('deactivation signs the user out', async () => {
    const { client: dave, me } = await invite(owner, srv, 'dave');
    expect((await dave.get('/me')).status).toBe(200);
    await owner.patch(`/admin/users/${me.id}`, { deactivated: true });
    expect((await dave.get('/me')).status).toBe(401);
  });

  it('exports NDJSON and records an audit trail', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/api/v1/admin/export', headers: { cookie: owner.cookie } });
    const lines = res.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].type).toBe('meta');
    expect(lines.some((l: any) => l.type === 'message')).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/password_hash|scrypt\$/);
    const audit = await owner.get('/admin/audit');
    expect(audit.body.some((a: any) => a.action === 'org.exported')).toBe(true);
  });

  it('serves an OpenAPI document', async () => {
    const r = await new Client(srv).get('/openapi.json');
    expect(r.body.openapi).toBe('3.1.0');
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(60);
  });
});

describe('realtime', () => {
  it('delivers message events over WebSocket', async () => {
    const ws = await srv.app.injectWS('/api/v1/ws', { headers: { cookie: bob.cookie } });
    const events: any[] = [];
    const got = new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const e = JSON.parse(data.toString());
        events.push(e);
        if (e.type === 'message.created' && e.data.message.body === 'realtime!') resolve();
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    await alice.post(`/channels/${general.id}/messages`, { body: 'realtime!' });
    await got;
    expect(events.every((e) => typeof e.seq === 'number')).toBe(true);
    ws.terminate();
  });
});
