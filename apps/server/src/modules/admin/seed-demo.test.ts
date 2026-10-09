// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, startTestServer, type TestServer } from '../../test/helpers.js';
import { DEMO_EMAIL, seedDemo } from './seed-demo.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => srv?.close());

describe('seed-demo', () => {
  it('creates a usable demo organization', async () => {
    const r = await seedDemo(srv.ctx, { password: 'demo-password-123' });
    expect(r.email).toBe(DEMO_EMAIL);
    const c = new Client(srv);
    expect(
      (await c.post('/auth/login', { login: DEMO_EMAIL, password: 'demo-password-123' })).status,
    ).toBe(200);
    const boot = await c.get('/bootstrap');
    expect(boot.body.users.length).toBe(12);
    const names = boot.body.channels
      .filter((ch: { name: string }) => ch.name)
      .map((ch: { name: string }) => ch.name);
    expect(names).toEqual(
      expect.arrayContaining(['general', 'design', 'engineering', 'client-harbor']),
    );
    const design = boot.body.channels.find((ch: { name: string }) => ch.name === 'design');
    expect(design.mentionCount).toBe(1);
    const msgs = await c.get(`/channels/${design.id}/messages`);
    expect(msgs.body.messages.some((m: { replyCount: number }) => m.replyCount === 4)).toBe(true);
    expect((await c.get('/search?q=index')).body.messages.length).toBeGreaterThan(0);
  });

  it('refuses to run twice', async () => {
    await expect(seedDemo(srv.ctx, { force: true })).rejects.toThrow(/already/);
    await expect(seedDemo(srv.ctx)).rejects.toThrow(/empty instance/);
  });
});
