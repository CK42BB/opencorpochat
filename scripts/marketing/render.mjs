// SPDX-License-Identifier: AGPL-3.0-only
// Renders marketing images from HTML: AI background art (scripts/marketing/generate-art.mjs)
// + real product screenshots (pnpm screenshots) + typography. Output: docs/images/marketing/*.png
// Usage: pnpm marketing
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'docs/images/marketing');
mkdirSync(OUT, { recursive: true });
const img = (rel) => {
  const p = path.join(ROOT, rel);
  const mime = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
};
const shot = (n) => img(`docs/images/screenshots/${n}.png`);
const art = (n) => img(`docs/images/marketing/art/${n}.jpg`);
const logo = img('apps/web/public/icon.svg').replace('image/jpeg', 'image/svg+xml');

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; overflow: hidden; }
  .canvas { position: relative; overflow: hidden; color: #fff; }
  .bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .scrim { position: absolute; inset: 0; }
  .frame { position: absolute; border-radius: 14px; overflow: hidden; background: #fff;
           box-shadow: 0 40px 120px rgba(5, 3, 30, .55), 0 0 0 1px rgba(255,255,255,.12); }
  .frame .bar { height: 30px; background: #f1f1f6; display: flex; align-items: center; gap: 7px; padding: 0 12px; border-bottom: 1px solid #e3e3ea; }
  .frame .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d9d9e3; display: block; }
  .frame .bar span { margin-left: 14px; flex: 1; height: 18px; border-radius: 9px; background: #e6e6ef; max-width: 340px; }
  .frame img { display: block; width: 100%; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: -.01em; }
  .brand img { border-radius: 9px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2); font-weight: 600; letter-spacing: .02em; backdrop-filter: blur(8px); }
  h1, h2 { letter-spacing: -.035em; line-height: 1.02; font-weight: 800; }
  .grad { background: linear-gradient(90deg, #c9c2ff, #8fe3ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: rgba(255,255,255,.78); line-height: 1.45; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { padding: 8px 14px; border-radius: 10px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); font-weight: 600; }
  ul.points { list-style: none; padding: 0; display: grid; gap: 14px; }
  ul.points li { display: flex; gap: 12px; align-items: flex-start; color: rgba(255,255,255,.9); line-height: 1.35; }
  ul.points li::before { content: ''; flex: 0 0 22px; height: 22px; border-radius: 50%; margin-top: 1px;
    background: #4a3aff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L20 7'/%3E%3C/svg%3E") center/14px no-repeat; }
`;

const frame = (src, style, { bar = true } = {}) =>
  `<div class="frame" style="${style}">${bar ? '<div class="bar"><i></i><i></i><i></i><span></span></div>' : ''}<img src="${src}"></div>`;

const pages = {
  hero: {
    w: 1600,
    h: 900,
    html: `
      <div class="canvas" style="width:1600px;height:900px">
        <div class="bg" style="background-image:url(${art('bg-hero')})"></div>
        <div class="scrim" style="background:linear-gradient(90deg, rgba(14,11,40,.92) 0%, rgba(14,11,40,.6) 45%, rgba(14,11,40,0) 75%)"></div>
        <div style="position:absolute;left:96px;top:110px;width:620px">
          <div class="brand" style="font-size:26px;margin-bottom:56px"><img src="${logo}" width="44" height="44">OpenCorpoChat</div>
          <div class="eyebrow" style="font-size:15px;margin-bottom:26px">✦ Free &amp; open source · AGPL-3.0</div>
          <h1 style="font-size:84px;margin-bottom:26px">Team chat<br><span class="grad">you own.</span></h1>
          <p class="sub" style="font-size:24px;margin-bottom:38px">Channels, threads, calls, search and SSO for teams up to 200 people. Self-hosted in one container. No per-seat fees.</p>
          <div class="chips" style="font-size:16px">
            <span class="chip">💬 Threads</span><span class="chip">📞 Calls</span><span class="chip">🔎 Search</span><span class="chip">🤖 Bots</span><span class="chip">🔐 SSO &amp; 2FA</span>
          </div>
        </div>
        ${frame(shot('messaging'), 'left:790px;top:140px;width:980px;transform:perspective(2200px) rotateY(-14deg) rotateX(4deg);transform-origin:left center')}
        ${frame(shot('calls'), 'left:1080px;top:560px;width:430px;border-radius:14px', { bar: false })}
      </div>`,
  },
  'social-preview': {
    w: 1280,
    h: 640,
    html: `
      <div class="canvas" style="width:1280px;height:640px">
        <div class="bg" style="background-image:url(${art('bg-hero')})"></div>
        <div class="scrim" style="background:linear-gradient(90deg, rgba(14,11,40,.94) 0%, rgba(14,11,40,.55) 55%, rgba(14,11,40,.1) 100%)"></div>
        <div style="position:absolute;left:72px;top:72px;width:560px">
          <div class="brand" style="font-size:24px;margin-bottom:40px"><img src="${logo}" width="40" height="40">OpenCorpoChat</div>
          <h1 style="font-size:66px;margin-bottom:22px">Team chat<br><span class="grad">you own.</span></h1>
          <p class="sub" style="font-size:21px;margin-bottom:30px">Open-source, self-hosted chat, calls and search for teams up to 200. No per-seat fees.</p>
          <div class="chips" style="font-size:15px"><span class="chip">AGPL-3.0</span><span class="chip">One container</span><span class="chip">SQLite or Postgres</span></div>
        </div>
        ${frame(shot('threads'), 'left:680px;top:96px;width:780px;transform:perspective(2000px) rotateY(-12deg);transform-origin:left center')}
      </div>`,
  },
};

const FEATURES = [
  {
    key: 'messaging',
    bg: 'bg-light',
    dark: false,
    eyebrow: 'Messaging & threads',
    title: 'Conversations that<br>stay organized.',
    points: [
      'Public & private channels, DMs and group DMs',
      'Threads, reactions, mentions, pins and polls',
      'Markdown, code blocks, files and link previews',
    ],
    shot: 'threads',
  },
  {
    key: 'calls',
    bg: 'bg-calls',
    dark: true,
    eyebrow: 'Voice, video & screen share',
    title: 'Hop on a call<br>without leaving chat.',
    points: [
      '1:1 calls and channel huddles in the browser',
      'Screen sharing, device picker, speaker highlight',
      'Built-in STUN; scale up with TURN or LiveKit',
    ],
    shot: 'calls',
  },
  {
    key: 'search',
    bg: 'bg-light',
    dark: false,
    eyebrow: 'Search',
    title: 'Find anything<br>anyone ever said.',
    points: [
      'Full-text search across everything you can access',
      'Filters: in:#channel, from:@person, has:file, dates',
      'Ctrl/⌘ K quick switcher for channels and people',
    ],
    shot: 'search',
  },
  {
    key: 'integrations',
    bg: 'bg-integrations',
    dark: true,
    eyebrow: 'Bots, webhooks & API',
    title: 'Plug in your tools.<br>Automate the rest.',
    points: [
      'Incoming & signed outgoing webhooks',
      'Bot accounts, scoped tokens and slash commands',
      'Documented REST + WebSocket API (OpenAPI 3.1)',
    ],
    shot: 'integrations',
  },
  {
    key: 'admin',
    bg: 'bg-security',
    dark: true,
    eyebrow: 'Admin, security & compliance',
    title: 'Enterprise controls.<br>Small-team price: $0.',
    points: [
      'SSO (OpenID Connect), 2FA, guests and roles',
      'Audit log, retention, export and data erasure',
      'Your server, your data. No telemetry.',
    ],
    shot: 'admin',
  },
];

for (const f of FEATURES) {
  const textColor = f.dark ? '#fff' : '#17142e';
  const subColor = f.dark ? 'rgba(255,255,255,.85)' : '#3b3858';
  pages[`feature-${f.key}`] = {
    w: 1200,
    h: 675,
    html: `
      <div class="canvas" style="width:1200px;height:675px;color:${textColor}">
        <div class="bg" style="background-image:url(${art(f.bg)})"></div>
        <div class="scrim" style="background:${f.dark ? 'linear-gradient(90deg, rgba(10,8,32,.88) 0%, rgba(10,8,32,.55) 50%, rgba(10,8,32,.15) 100%)' : 'linear-gradient(90deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.4) 55%, rgba(255,255,255,0) 100%)'}"></div>
        <div style="position:absolute;left:64px;top:70px;width:440px">
          <div class="brand" style="font-size:19px;margin-bottom:34px;color:${textColor}"><img src="${logo}" width="34" height="34">OpenCorpoChat</div>
          <div class="eyebrow" style="font-size:13px;margin-bottom:20px;${f.dark ? '' : 'background:rgba(74,58,255,.1);border-color:rgba(74,58,255,.25);color:#4a3aff'}">${f.eyebrow}</div>
          <h2 style="font-size:48px;margin-bottom:30px">${f.title}</h2>
          <ul class="points" style="font-size:18px">${f.points.map((p) => `<li style="color:${subColor}">${p}</li>`).join('')}</ul>
        </div>
        ${frame(shot(f.shot), 'left:540px;top:110px;width:720px;transform:perspective(2200px) rotateY(-7deg);transform-origin:left center')}
      </div>`,
  };
}

pages['cost'] = {
  w: 1200,
  h: 675,
  html: `
    <div class="canvas" style="width:1200px;height:675px">
      <div class="bg" style="background-image:url(${art('bg-hero')});transform:scaleX(-1)"></div>
      <div class="scrim" style="background:rgba(12,9,36,.55)"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px">
        <div class="brand" style="font-size:20px;margin-bottom:36px"><img src="${logo}" width="36" height="36">OpenCorpoChat</div>
        <h2 style="font-size:120px;margin-bottom:12px"><span class="grad">$0</span> per seat.</h2>
        <p class="sub" style="font-size:28px;max-width:820px;margin-bottom:36px">Every feature for every person — threads, calls, search, SSO, audit log. Run it on a small VPS or the server in your closet.</p>
        <div class="chips" style="font-size:17px;justify-content:center"><span class="chip">No user limits</span><span class="chip">No history limits</span><span class="chip">No telemetry</span><span class="chip">Export anytime</span></div>
      </div>
    </div>`,
};

const browser = await chromium.launch({ channel: 'chromium' });
for (const [name, p] of Object.entries(pages)) {
  const page = await browser.newPage({
    viewport: { width: p.w, height: p.h },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<!doctype html><html><head><style>${BASE_CSS}</style></head><body>${p.html}</body></html>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.close();
  console.log(`✓ ${name}.png`);
}
await browser.close();
