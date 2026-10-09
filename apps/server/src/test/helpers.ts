// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../config.js';

export interface TestServer extends BuiltApp {
  dir: string;
  close(): Promise<void>;
}

export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ocpc-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    OCPC_DATA_DIR: dir,
    OCPC_PUBLIC_URL: 'http://localhost:8080',
    OCPC_LOG_LEVEL: 'silent',
    // Allow running the suite against Postgres in CI.
    ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
    ...(process.env.DATABASE_POOL_MAX ? { DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX } : {}),
    ...env,
  });
  const built = await buildApp(config, { scheduler: false, logger: false });
  await built.app.ready();
  return {
    ...built,
    dir,
    async close() {
      await built.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A tiny API client with cookie session handling for app.inject. */
export class Client {
  cookie = '';
  constructor(private srv: TestServer) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.srv.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'x-ocpc-csrf': '1' } : {}),
        ...headers,
      },
    });
    const set = res.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of cookies) {
      const [pair] = c.split(';');
      if (pair?.startsWith('ocpc_session=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, body: json, raw: res };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export async function setupOrg(srv: TestServer) {
  const owner = new Client(srv);
  const r = await owner.post('/setup', {
    orgName: 'Acme',
    email: 'owner@acme.test',
    username: 'owner',
    displayName: 'Olive Owner',
    password: 'correct-horse-battery',
  });
  if (r.status !== 200) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  return owner;
}

export async function invite(owner: Client, srv: TestServer, username: string, role = 'member', channelIds: string[] = []) {
  const inv = await owner.post('/invites', { role, channelIds });
  if (inv.status !== 200) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`);
  const c = new Client(srv);
  const r = await c.post('/auth/register', {
    inviteCode: inv.body.code,
    email: `${username}@acme.test`,
    username,
    displayName: username[0]!.toUpperCase() + username.slice(1),
    password: 'correct-horse-battery',
  });
  if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return { client: c, me: r.body.me };
}
