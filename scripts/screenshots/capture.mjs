// SPDX-License-Identifier: AGPL-3.0-only
// Captures the documentation screenshots from a real server seeded with demo data.
// Usage: pnpm build && pnpm screenshots   (writes docs/images/screenshots/*.png)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'docs/images/screenshots');
const PASSWORD = 'demo-password-123';
const SERVER = path.join(ROOT, 'apps/server/dist/index.js');
const CLI = path.join(ROOT, 'apps/server/dist/cli.js');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, { seed }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ocpc-shots-'));
  const env = {
    ...process.env,
    OCPC_DATA_DIR: dir,
    PORT: String(port),
    OCPC_PUBLIC_URL: `http://localhost:${port}`,
    OCPC_LOG_LEVEL: 'warn',
    OCPC_STUN_PORT: '0',
  };
  if (seed)
    execFileSync('node', [CLI, 'seed-demo', '--password', PASSWORD], { env, stdio: 'inherit' });
  const proc = spawn('node', [SERVER], { env, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/healthz`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return {
    url: `http://localhost:${port}`,
    stop: () => (proc.kill(), rmSync(dir, { recursive: true, force: true })),
  };
}

// Fake camera: each person's camera shows their (AI-generated, fictional) webcam photo.
// macOS headless Chromium can't do audio, so microphones are reported as missing.
const camInit = ({ img }) => {
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  class SilentAudioContext {
    currentTime = 0;
    state = 'running';
    destination = {};
    createOscillator() {
      return { connect() {}, start() {}, stop() {}, frequency: {} };
    }
    createGain() {
      return {
        connect() {
          return this;
        },
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
      };
    }
    createAnalyser() {
      return { connect() {}, disconnect() {}, fftSize: 0, getByteTimeDomainData() {} };
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  window.AudioContext = SilentAudioContext;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c?.audio) throw new DOMException('No microphone', 'NotFoundError');
    if (c?.video && img) {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const ctx = canvas.getContext('2d');
      const image = new Image();
      image.src = img;
      await image.decode();
      const draw = () => ctx.drawImage(image, 0, 0, 1280, 720);
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(15);
    }
    return realGum(c);
  };
};

const camData = (name) =>
  `data:image/jpeg;base64,${readFileSync(path.join(ROOT, `apps/server/assets/demo/cam-${name}.jpg`)).toString('base64')}`;

async function main() {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: [
      '--use-fake-ui-for-media-stream',
      '--allow-loopback-in-peer-connection',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });
  const shot = (page, name, opts = {}) =>
    page
      .screenshot({ path: path.join(OUT, `${name}.png`), ...opts })
      .then(() => console.log(`✓ ${name}.png`));

  // 1) First-run setup wizard on an empty server.
  {
    const s = await startServer(18_191, { seed: false });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(s.url);
    await page.getByLabel('Organization name').fill('Brightfield Studio');
    await page.getByLabel('Your name').fill('Jordan Avery');
    await page.getByLabel('Email').fill('jordan@brightfield.example');
    await shot(page, 'setup');
    await ctx.close();
    s.stop();
  }

  // 2) Everything else on a seeded server.
  const s = await startServer(18_192, { seed: true });
  const login = async (username, { cam, theme, viewport } = {}) => {
    const ctx = await browser.newContext({
      viewport: viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      permissions: ['camera', 'microphone'],
      baseURL: s.url,
    });
    await ctx.addInitScript(camInit, { img: cam ? camData(cam) : null });
    const r = await ctx.request.post('/api/v1/auth/login', {
      data: { login: username, password: PASSWORD },
      headers: { 'x-ocpc-csrf': '1' },
    });
    if (!r.ok()) throw new Error(`login ${username} failed`);
    if (theme)
      await ctx.request.patch('/api/v1/me/preferences', {
        data: { theme },
        headers: { 'x-ocpc-csrf': '1' },
      });
    const page = await ctx.newPage();
    return { ctx, page };
  };
  const channelId = async (page, name) =>
    page.evaluate(
      async (n) =>
        (await (await fetch('/api/v1/bootstrap')).json()).channels.find((c) => c.name === n).id,
      name,
    );

  // Teammates online (presence dots, typing, huddle).
  const mates = {};
  for (const [u, cam] of [
    ['maya', 'maya'],
    ['sam', 'sam'],
    ['leo', 'leo'],
    ['priya', 'priya'],
    ['ines'],
    ['noah'],
  ]) {
    mates[u] = await login(u, { cam });
    await mates[u].page.goto('/');
  }
  const me = await login('jordan');
  await me.page.goto('/');
  await me.page.waitForSelector('.sidebar-item');
  const design = await channelId(me.page, 'design');
  const engineering = await channelId(me.page, 'engineering');

  // Messaging: #design with an image, reactions, a thread summary, a mention and someone typing.
  await me.page.goto(`/c/${design}`);
  await me.page.waitForSelector('.attachment-image');
  await me.page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const noahPage = mates.noah.page;
  await noahPage.goto(`/c/${design}`);
  await noahPage
    .locator('.composer textarea')
    .first()
    .pressSequentially('Love it — one tiny note on the', { delay: 20 });
  await me.page.waitForSelector('.typing:has-text("typing")');
  await shot(me.page, 'messaging');

  // Threads: open the thread on Maya's design post.
  await me.page.locator('.thread-summary').first().click();
  await me.page.waitForSelector('.panel .msg-body');
  await sleep(400);
  await me.page.locator('.panel .panel-body').evaluate((el) => (el.scrollTop = 0));
  await shot(me.page, 'threads');

  // Search.
  await me.page.goto('/search?q=aurora');
  await me.page.waitForSelector('.list-card .msg-body');
  await shot(me.page, 'search');

  // Integrations: bot posts in #engineering + slash command autocomplete.
  await me.page.goto(`/c/${engineering}`);
  await me.page.waitForSelector('.msg-body');
  await me.page.locator('.main .composer textarea').fill('');
  await me.page.locator('.main .composer textarea').pressSequentially('/', { delay: 30 });
  await me.page.waitForSelector('.autocomplete-item');
  await shot(me.page, 'integrations');
  await me.page.keyboard.press('Escape');
  await me.page.locator('.main .composer textarea').fill('');

  // Calls: a huddle in #design with three cameras on.
  await mates.noah.page.locator('.composer textarea').first().fill('');
  for (const u of ['maya', 'leo', 'priya']) {
    const p = mates[u].page;
    await p.goto(`/c/${design}`);
    await p.waitForSelector('.channel-header');
    await p.getByRole('button', { name: 'Start a huddle' }).click();
    await p.waitForSelector('.call-window');
    await p.getByRole('button', { name: 'Turn camera on' }).click();
    await sleep(800);
  }
  await me.page.goto(`/c/${design}`);
  await me.page.getByRole('button', { name: 'Start a huddle' }).click();
  await me.page.waitForSelector('.call-window');
  await me.page.getByRole('button', { name: 'Expand call' }).click();
  await me.page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.call-tile video')].filter((v) => v.videoWidth > 0).length >=
        3,
      null,
      { timeout: 25_000 },
    )
    .catch(() => console.warn('! remote video did not connect; capturing anyway'));
  await me.page.waitForSelector('.toast', { state: 'detached', timeout: 15_000 }).catch(() => {});
  await sleep(500);
  await shot(me.page, 'calls');
  await me.page.getByRole('button', { name: 'Leave call' }).click();
  for (const u of ['maya', 'leo', 'priya'])
    await mates[u].page
      .getByRole('button', { name: 'Leave call' })
      .click()
      .catch(() => {});

  // Admin console overview.
  await me.page.goto('/admin/overview');
  await me.page.waitForSelector('.stat');
  await sleep(500);
  await shot(me.page, 'admin');

  // Security: two-factor setup with QR code.
  await me.page.goto('/settings/account');
  await me.page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await me.page.locator('svg path').first().waitFor();
  await sleep(500);
  await me.page
    .getByRole('heading', { name: 'Two-factor authentication' })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot(me.page, 'security');

  // Dark theme.
  const dark = await login('sam', { theme: 'dark' });
  await dark.page.goto(`/c/${engineering}`);
  await dark.page.waitForSelector('.msg-body pre');
  await sleep(500);
  await shot(dark.page, 'dark');

  // Mobile (phone width).
  const phone = await login('maya', { viewport: { width: 390, height: 844 } });
  await phone.page.goto('/');
  await phone.page.waitForSelector('.channel-header');
  await phone.page.goto(`/c/${await channelId(phone.page, 'general')}`);
  await phone.page.waitForSelector('.poll');
  await sleep(500);
  await shot(phone.page, 'mobile');

  await browser.close();
  s.stop();
}

const watchdog = setTimeout(() => {
  console.error('screenshots: timed out');
  process.exit(1);
}, 300_000);
watchdog.unref();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
