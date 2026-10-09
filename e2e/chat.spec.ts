// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'e2e-test-password';
// macOS headless Chromium has no working audio stack: AudioContext and microphone capture hang.
// There we simulate a machine without a microphone (the app joins calls listen-only) and
// verify signaling, ICE and video. On Linux (CI) the real fake-audio device is used.
const MAC = process.platform === 'darwin';
const NO_AUDIO_STUB = () => {
  const node = () => ({
    connect: () => node(),
    disconnect() {},
    start() {},
    stop() {},
    frequency: { value: 0 },
    gain: {
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    },
    fftSize: 0,
    getByteTimeDomainData() {},
    getByteFrequencyData() {},
  });
  class FakeAudioContext {
    currentTime = 0;
    destination = node();
    state = 'running';
    createOscillator = node;
    createGain = node;
    createAnalyser = node;
    createMediaStreamSource = node;
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) =>
    c && c.audio ? Promise.reject(new DOMException('No microphone', 'NotFoundError')) : gum(c);
};

let pageSeq = 0;
async function newUserPage(browser: Browser) {
  const label = `p${++pageSeq}`;
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  if (MAC) await ctx.addInitScript(NO_AUDIO_STUB);
  const page = await ctx.newPage();
  if (process.env.E2E_DEBUG) {
    page.on('console', (m) => console.log('PAGE', label, Date.now() % 100000, m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  }
  return page;
}

test.describe.serial('two people chatting', () => {
  let owner: Page;
  let member: Page;

  test('owner completes first-run setup', async ({ browser }) => {
    owner = await newUserPage(browser);
    await owner.goto('/');
    await owner.getByLabel('Organization name').fill('E2E Corp');
    await owner.getByLabel('Your name').fill('Olivia Owner');
    await owner.getByLabel('Email').fill('olivia@e2e.test');
    await owner.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await owner.getByLabel('Confirm password').fill(PASSWORD);
    await owner.getByRole('button', { name: 'Create organization' }).click();
    await expect(owner.getByRole('heading', { name: 'general' }).first()).toBeVisible();
  });

  test('member joins through an invite link', async ({ browser }) => {
    const invite = await owner.evaluate(async () => {
      const r = await fetch('/api/v1/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ocpc-csrf': '1' },
        body: '{}',
      });
      return (await r.json()).link as string;
    });
    member = await newUserPage(browser);
    await member.goto(new URL(invite).pathname);
    await expect(member.getByRole('heading', { name: 'Join E2E Corp' })).toBeVisible();
    await member.getByLabel('Your name').fill('Max Member');
    await member.getByLabel('Email').fill('max@e2e.test');
    await member.getByLabel('Password').fill(PASSWORD);
    await member.getByRole('button', { name: 'Join' }).click();
    await expect(member.getByRole('link', { name: 'general', exact: true })).toBeVisible();
  });

  test('messages, mentions and reactions arrive in realtime', async () => {
    await member.getByRole('link', { name: 'general', exact: true }).click();
    const composer = owner.getByRole('textbox', { name: 'Message #general' });
    await composer.fill('Hello @max welcome aboard!');
    await composer.press('Enter');
    const msg = member.locator('.msg-body', { hasText: 'welcome aboard' });
    await expect(msg).toBeVisible();
    await expect(msg.locator('.mention-me')).toHaveText('@Max Member');

    await msg.hover();
    await member.getByRole('button', { name: 'React with 👍' }).first().click();
    await expect(owner.locator('.reaction', { hasText: '👍' })).toContainText('1');
  });

  test('threads and unread badges', async () => {
    // Member replies in a thread; owner sees the reply count update live.
    await member.locator('.msg', { hasText: 'welcome aboard' }).hover();
    await member.getByRole('button', { name: 'Reply in thread' }).first().click();
    const reply = member.getByRole('textbox', { name: 'Reply…' });
    await reply.fill('Thanks, glad to be here');
    await reply.press('Enter');
    await expect(owner.locator('.thread-summary')).toContainText('1 reply');

    // A DM from owner shows a mention badge for the member while they are elsewhere.
    await member.getByRole('link', { name: 'random', exact: true }).click();
    await owner.evaluate(async () => {
      const users = await (await fetch('/api/v1/users')).json();
      const max = users.find((u: { username: string }) => u.username === 'max');
      const headers = { 'content-type': 'application/json', 'x-ocpc-csrf': '1' };
      const dm = await (
        await fetch('/api/v1/dms', {
          method: 'POST',
          headers,
          body: JSON.stringify({ userIds: [max.id] }),
        })
      ).json();
      await fetch(`/api/v1/channels/${dm.id}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: 'psst, a DM' }),
      });
    });
    await expect(
      member.locator('.sidebar-item', { hasText: 'Olivia Owner' }).locator('.badge'),
    ).toHaveText('1');
  });

  test('search finds messages', async () => {
    await member.goto('/search?q=aboard');
    await expect(
      member.locator('.list-card .msg-body', { hasText: 'welcome aboard' }),
    ).toBeVisible();
  });

  test('a 1:1 call: ringing, signaling, ICE and media', async () => {
    await member.locator('.sidebar-item', { hasText: 'Olivia Owner' }).click();
    await member.getByRole('button', { name: 'Start a call' }).click();
    // The owner gets an incoming-call prompt and accepts it.
    await owner.getByRole('button', { name: 'Accept call' }).click();

    // Signaling completes on both sides: offer/answer applied, remote tracks negotiated,
    // and ICE candidates exchanged through the server.
    type Dbg = {
      peers:
        | { signaling: string; remoteTracks: string[]; candidates: string[]; connection: string }[]
        | null;
    };
    const dbg = (p: Page) =>
      p.evaluate(() =>
        (globalThis as unknown as { ocpcCallDebug: () => Promise<unknown> }).ocpcCallDebug(),
      ) as Promise<Dbg>;
    for (const p of [owner, member]) {
      await expect(p.locator('.call-window')).toBeVisible();
      await expect(p.locator('.call-window .call-tile')).toHaveCount(2);
      await expect
        .poll(
          async () => {
            const peer = (await dbg(p)).peers?.[0];
            return (
              !!peer &&
              peer.signaling === 'stable' &&
              peer.remoteTracks.length >= 1 &&
              peer.candidates.some((c) => c.startsWith('R:'))
            );
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    }

    // macOS blocks inbound UDP to the unsigned headless browser binary, so the media path
    // itself is only asserted where it can work (Linux CI).
    if (!MAC) {
      for (const p of [owner, member]) {
        await expect(p.locator('.call-window .call-head')).not.toContainText('Connecting', {
          timeout: 20_000,
        });
      }
      await member.getByRole('button', { name: 'Turn camera on' }).click();
      await expect
        .poll(
          () =>
            owner.evaluate(() =>
              [...document.querySelectorAll<HTMLVideoElement>('.call-tile video')].some((v) => {
                const s = v.srcObject as MediaStream | null;
                return (
                  !!s &&
                  s.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) &&
                  v.videoWidth > 0
                );
              }),
            ),
          { timeout: 20_000 },
        )
        .toBe(true);
      await expect
        .poll(() =>
          owner.evaluate(() =>
            [...document.querySelectorAll<HTMLMediaElement>('audio, video')].some((el) => {
              const s = el.srcObject as MediaStream | null;
              return !!s && s.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);
            }),
          ),
        )
        .toBe(true);
    }

    // One person leaves: the other sees them go, stays in the call, then hangs up too.
    await member.getByRole('button', { name: 'Leave call' }).click();
    await expect(member.locator('.call-window')).toBeHidden();
    await expect(owner.locator('.call-window .call-tile')).toHaveCount(1);
    await owner.getByRole('button', { name: 'Leave call' }).click();
    await expect(owner.locator('.call-window')).toBeHidden();
    // When the last person leaves, the server ends the call and posts a summary in the DM.
    // (Skipped on macOS: its headless media stack stalls the page during WebRTC teardown.)
    if (MAC) return;
    const dmId = new URL(member.url()).pathname.split('/').pop();
    await expect
      .poll(async () => {
        const r = await member.context().request.get(`/api/v1/channels/${dmId}/messages?limit=5`);
        const { messages } = (await r.json()) as { messages: { body: string }[] };
        return messages.some((m) => m.body.includes('Call ended'));
      })
      .toBe(true);
  });
});
