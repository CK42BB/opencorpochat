// SPDX-License-Identifier: AGPL-3.0-only
// `ocpc seed-demo`: fills an empty instance with a fictional company ("Brightfield Studio")
// so people can explore the product, and so docs screenshots look realistic.
// Every person, company and conversation here is invented.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../../context.js';
import type { ChannelsTable } from '../../db/schema.js';
import { hashPassword, randomToken } from '../../lib/crypto.js';
import { ulid } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { addMembers, createChannel } from '../channels/service.js';
import { createMessage } from '../messages/service.js';
import { insertUser } from '../users/service.js';

export const DEMO_EMAIL = 'demo@brightfield.example';

interface Person {
  key: string;
  name: string;
  title: string;
  role?: 'owner' | 'admin' | 'member' | 'guest';
  tz: string;
  status?: [string, string];
  pronouns?: string;
}

const PEOPLE: Person[] = [
  {
    key: 'demo',
    name: 'Jordan Avery',
    title: 'Founder & CEO',
    role: 'owner',
    tz: 'America/New_York',
    pronouns: 'they/them',
  },
  {
    key: 'maya',
    name: 'Maya Chen',
    title: 'Design Lead',
    role: 'admin',
    tz: 'America/Los_Angeles',
    status: ['🎨', 'Design review until 3pm'],
  },
  {
    key: 'sam',
    name: 'Sam Okafor',
    title: 'Engineering Lead',
    role: 'admin',
    tz: 'Europe/London',
    status: ['🏡', 'Working remotely'],
  },
  { key: 'priya', name: 'Priya Raman', title: 'Product Manager', tz: 'America/Chicago' },
  {
    key: 'leo',
    name: 'Leo Martins',
    title: 'Frontend Engineer',
    tz: 'Europe/Lisbon',
    status: ['🎧', 'Heads down'],
  },
  { key: 'ines', name: 'Inés García', title: 'Backend Engineer', tz: 'Europe/Madrid' },
  { key: 'noah', name: 'Noah Kim', title: 'Brand Designer', tz: 'Asia/Seoul' },
  {
    key: 'ava',
    name: 'Ava Thompson',
    title: 'Marketing Manager',
    tz: 'America/New_York',
    status: ['🚀', 'Launch week!'],
  },
  {
    key: 'theo',
    name: 'Theo Nguyen',
    title: 'Operations',
    tz: 'Australia/Sydney',
    status: ['🌴', 'On vacation'],
  },
  { key: 'zara', name: 'Zara Ali', title: 'Customer Success', tz: 'America/Denver' },
  { key: 'ben', name: 'Ben Fischer', title: 'DevOps Engineer', tz: 'Europe/Berlin' },
  {
    key: 'lucy',
    name: 'Lucy Park',
    title: 'Illustrator (contractor)',
    role: 'guest',
    tz: 'America/Toronto',
  },
];

type Script = {
  by: string; // person key, or 'bot:<Name>'
  ago: number; // minutes ago
  text: string;
  react?: Record<string, string[]>;
  thread?: Omit<Script, 'thread'>[];
  pin?: boolean;
  file?: string; // file name in assets/demo
  poll?: { question: string; options: string[]; votes: Record<string, number> };
};

interface ChannelSpec {
  name: string;
  kind: 'public' | 'private';
  topic: string;
  description?: string;
  isDefault?: boolean;
  isReadonly?: boolean;
  members: string[] | 'all';
  messages: Script[];
}

const STAFF = PEOPLE.filter((p) => p.role !== 'guest').map((p) => p.key);
const H = 60;
const D = 24 * H;

const CHANNELS: ChannelSpec[] = [
  {
    name: 'announcements',
    kind: 'public',
    topic: 'Official updates from the leadership team',
    isDefault: true,
    isReadonly: true,
    members: 'all',
    messages: [
      {
        by: 'demo',
        ago: 3 * D,
        pin: true,
        text: "🎉 **Welcome to our new home for team chat!**\n\nWe're now on OpenCorpoChat — self-hosted, so our conversations stay ours. A few tips:\n- Use **threads** to keep channels tidy\n- Press **Ctrl/⌘ + K** to jump anywhere\n- Set your status and notification schedule in Settings\n\nQuestions? Ask in #general.",
        react: {
          '🎉': ['maya', 'sam', 'priya', 'leo', 'ava', 'zara', 'ben'],
          '🙌': ['ines', 'noah', 'theo'],
        },
      },
      {
        by: 'demo',
        ago: 6 * H,
        text: '**Aurora launch is locked for October 21.** Huge thanks to everyone who pushed the website over the line this sprint. Details in #marketing 🚀',
        react: { '🚀': ['ava', 'maya', 'leo', 'priya', 'sam'], '❤️': ['zara', 'noah'] },
      },
    ],
  },
  {
    name: 'general',
    kind: 'public',
    topic: 'Company-wide news and questions',
    isDefault: true,
    members: 'all',
    messages: [
      {
        by: 'theo',
        ago: 1 * D + 2 * H,
        text: 'Reminder: the office is closed Monday for the holiday. Enjoy the long weekend! 🌴',
        react: { '🙌': ['maya', 'leo', 'ava', 'zara', 'ben'] },
      },
      {
        by: 'demo',
        ago: 4 * H,
        text: '',
        poll: {
          question: 'Team offsite in November — where should we go?',
          options: ['🏔️ Mountain cabin', '🏖️ Beach house', '🍜 City food tour'],
          votes: { maya: 0, sam: 0, priya: 1, leo: 2, ines: 0, noah: 2, ava: 1, zara: 0, ben: 0 },
        },
      },
      {
        by: 'zara',
        ago: 90,
        text: 'Harbor Coffee just sent this after the rebrand handoff: _"Your team made the whole process painless. Best agency experience we\'ve had."_ ❤️',
        react: {
          '❤️': ['demo', 'maya', 'noah', 'lucy', 'priya', 'ava', 'sam'],
          '🥳': ['leo', 'ines'],
        },
      },
      {
        by: 'priya',
        ago: 35,
        text: 'Sprint review is moved to **Thursday 2pm** so the design crit can happen first. Calendar invite updated 📅',
      },
    ],
  },
  {
    name: 'design',
    kind: 'public',
    topic: 'Design system, reviews and inspiration',
    members: ['demo', 'maya', 'noah', 'priya', 'leo', 'ava', 'lucy'],
    messages: [
      {
        by: 'noah',
        ago: 26 * H,
        text: 'Design system **v3.2** is published to the shared library:\n- 48 new icons with a consistent 1.5px stroke\n- Dark-mode variants for every component\n- New spacing tokens (`space-7` and `space-9`)',
        react: { '🔥': ['maya', 'leo'], '👏': ['priya'] },
      },
      {
        by: 'maya',
        ago: 3 * H,
        file: 'aurora-homepage-v2.jpg',
        text: "Here is the v2 homepage hero for **Aurora**. Thoughts before Thursday's review? @noah @priya",
        react: { '😍': ['noah', 'ava', 'demo'], '👀': ['leo', 'priya'] },
        thread: [
          {
            by: 'noah',
            ago: 170,
            text: 'Love the gradient. Could we try the headline at 56px so it breathes a bit more?',
          },
          {
            by: 'priya',
            ago: 160,
            text: 'This is great. Can we make the primary CTA a little more prominent on mobile?',
          },
          {
            by: 'maya',
            ago: 150,
            text: 'Good calls, both of you — pushing an update this afternoon ✍️',
          },
          {
            by: 'demo',
            ago: 140,
            text: '👏 Looks fantastic, team. Ship it once the CTA tweak is in.',
          },
        ],
      },
      {
        by: 'lucy',
        ago: 70,
        text: 'Uploaded the final spot illustrations for the pricing page. Let me know if any need color tweaks!',
        react: { '✨': ['maya', 'noah'] },
      },
      {
        by: 'maya',
        ago: 18,
        text: '@jordan can you sign off on the new color tokens by end of day? 🙏',
      },
    ],
  },
  {
    name: 'engineering',
    kind: 'public',
    topic: 'Builds, releases and code reviews',
    members: ['demo', 'sam', 'leo', 'ines', 'ben', 'priya'],
    messages: [
      {
        by: 'bot:Deploy Bot',
        ago: 5 * H,
        text: '✅ **Build #1284 passed** on `main` · 4m 12s · 1,206 tests',
      },
      {
        by: 'sam',
        ago: 4 * H + 30,
        text: "Heads-up: upgrading the staging database at 3pm. Expect ~5 minutes of downtime. I'll post here when it's back.",
        react: { '👍': ['ines', 'leo', 'ben'] },
      },
      {
        by: 'ines',
        ago: 150,
        text: 'Found the slow query! This index took the inbox from **1.8s to 40ms** 🔥\n```sql\nCREATE INDEX messages_channel_idx\n  ON messages (channel_id, created_at DESC);\n```',
        react: { '🔥': ['sam', 'leo', 'ben', 'demo'], '💯': ['priya', 'sam'] },
        thread: [
          { by: 'sam', ago: 140, text: 'Nice find. Ship it 🚢' },
          {
            by: 'ben',
            ago: 130,
            text: 'Added to the migration checklist so we run it during the next maintenance window.',
          },
          { by: 'ines', ago: 125, text: 'Merged ✅' },
        ],
      },
      {
        by: 'bot:Deploy Bot',
        ago: 45,
        text: '🚀 **Deployed v2.8.0 to production** · 12 changes · rolled out in 3m 08s · no errors',
      },
      { by: 'leo', ago: 12, text: 'Anyone up for a quick huddle to pair on the checkout bug? 🎧' },
      { by: 'ben', ago: 6, text: '@leo I can join in 5 — grabbing coffee ☕' },
    ],
  },
  {
    name: 'marketing',
    kind: 'public',
    topic: 'Launch planning for the Aurora website',
    members: ['demo', 'ava', 'priya', 'noah', 'maya', 'zara'],
    messages: [
      {
        by: 'ava',
        ago: 7 * H,
        text: "Launch checklist for **Oct 21**:\n1. ✅ Final copy approved\n2. ✅ Social graphics\n3. ⏳ Press kit\n4. ⏳ Customer email (draft in progress)\n\n@zara can you share two customer quotes we're allowed to use?",
      },
      {
        by: 'zara',
        ago: 6 * H,
        text: 'On it — Harbor Coffee and Fieldnote both said yes. Sending them over this afternoon.',
      },
      {
        by: 'noah',
        ago: 2 * H,
        text: 'Social graphics are in the shared drive (12 sizes). The 1:1 version tested best last time.',
        react: { '🙌': ['ava'] },
      },
    ],
  },
  {
    name: 'random',
    kind: 'public',
    topic: 'Water-cooler chat, pets and lunch plans 🌮',
    isDefault: true,
    members: 'all',
    messages: [
      {
        by: 'leo',
        ago: 28 * H,
        text: 'Who took my lunch from the fridge 😤 (it was tacos)',
        react: { '😂': ['maya', 'sam', 'ava', 'ines', 'zara', 'theo'] },
      },
      {
        by: 'theo',
        ago: 27 * H,
        text: 'In better news, the new espresso machine arrives tomorrow ☕',
        react: { '☕': ['ben', 'sam', 'leo'], '🎉': ['priya'] },
      },
      {
        by: 'ava',
        ago: 50,
        text: 'Pet photo Friday starts in 10 minutes. You know what to do 🐶🐱',
      },
    ],
  },
  {
    name: 'client-harbor',
    kind: 'private',
    topic: 'Harbor Coffee rebrand — client project',
    members: ['demo', 'maya', 'zara', 'noah', 'lucy'],
    messages: [
      {
        by: 'zara',
        ago: 2 * D,
        text: 'Kickoff notes are pinned. Next check-in with Harbor is Wednesday.',
        pin: true,
      },
      {
        by: 'lucy',
        ago: 30 * H,
        text: 'Final mascot illustrations attached in the drive — three poses plus the badge version.',
      },
      {
        by: 'maya',
        ago: 5 * H,
        text: 'Final logo files delivered 🎉 Great work everyone.',
        react: { '🎉': ['zara', 'noah', 'lucy', 'demo'] },
      },
    ],
  },
];

const DMS: { with: string; messages: Script[]; unread?: boolean }[] = [
  {
    with: 'maya',
    messages: [
      {
        by: 'maya',
        ago: 3 * H + 10,
        text: 'Do you have 10 minutes after lunch to look at the pitch deck?',
      },
      { by: 'demo', ago: 3 * H + 5, text: 'Sure — ping me at 1:30 and we can hop on a call.' },
      { by: 'maya', ago: 3 * H, text: '👍 Perfect, thanks!' },
    ],
  },
  {
    with: 'sam',
    unread: true,
    messages: [
      {
        by: 'sam',
        ago: 15,
        text: 'Quick question about next quarter’s hosting budget — got 15 minutes tomorrow?',
      },
    ],
  },
];

function assetDir(ctx: Ctx) {
  const candidates = [
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../assets/demo'),
    path.resolve(process.cwd(), 'assets/demo'),
    ...(ctx.config.webDir ? [path.join(ctx.config.webDir, 'demo')] : []),
  ];
  return candidates.find((d) => existsSync(d)) ?? null;
}

export async function seedDemo(ctx: Ctx, opts: { force?: boolean; password?: string } = {}) {
  const count = Number(
    (
      await ctx.db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst()
    )?.n ?? 0,
  );
  if (count > 0 && !opts.force) {
    throw new Error(
      'This instance already has users. seed-demo only runs on an empty instance (use --force to add the demo data anyway).',
    );
  }
  if (count > 0) {
    const taken = await ctx.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', DEMO_EMAIL)
      .executeTakeFirst();
    if (taken) throw new Error('Demo data has already been added to this instance.');
  }
  const password = opts.password ?? `demo-${randomToken(6)}`;
  const hash = await hashPassword(password);
  const ids: Record<string, string> = {};
  const now = Date.now();
  const at = (minutesAgo: number) => now - minutesAgo * 60_000;

  for (const p of PEOPLE) {
    const username = p.key === 'demo' ? 'jordan' : p.key;
    const u = await insertUser(ctx, {
      email: p.key === 'demo' ? DEMO_EMAIL : `${username}@brightfield.example`,
      username,
      displayName: p.name,
      role: p.role ?? 'member',
      passwordHash: hash,
    });
    ids[p.key] = u.id;
    await ctx.db
      .updateTable('users')
      .set({
        full_name: p.name,
        title: p.title,
        timezone: p.tz,
        pronouns: p.pronouns ?? '',
        status_emoji: p.status?.[0] ?? '',
        status_text: p.status?.[1] ?? '',
        dnd_until: p.key === 'theo' ? new Date(now + 3 * 24 * 3600_000).toISOString() : null,
        created_at: new Date(at(30 * D)).toISOString(),
      })
      .where('id', '=', u.id)
      .execute();
  }
  if (count === 0) await ctx.settings.update({ name: 'Brightfield Studio', setupComplete: true });

  // Groups.
  for (const [handle, name, members] of [
    ['design', 'Design team', ['maya', 'noah', 'lucy']],
    ['engineering', 'Engineering team', ['sam', 'leo', 'ines', 'ben']],
  ] as const) {
    const gid = ulid();
    await ctx.db
      .insertInto('user_groups')
      .values({
        id: gid,
        handle,
        name,
        description: '',
        created_by: ids.demo!,
        created_at: nowIso(),
      })
      .execute();
    await ctx.db
      .insertInto('user_group_members')
      .values(members.map((m) => ({ group_id: gid, user_id: ids[m]! })))
      .execute();
  }

  const assets = assetDir(ctx);
  const channelRows: Record<string, ChannelsTable> = {};

  const post = async (channel: ChannelsTable, s: Script, threadRootId: string | null = null) => {
    const isBot = s.by.startsWith('bot:');
    const userId = isBot ? null : ids[s.by]!;
    const ms = at(s.ago);
    let fileIds: string[] | undefined;
    if (s.file && assets && existsSync(path.join(assets, s.file)) && userId) {
      const fid = ulid(ms);
      const key = `${fid.slice(0, 2)}/${fid}`;
      const full = path.join(assets, s.file);
      await ctx.storage.put(key, createReadStream(full), statSync(full).size, 'image/jpeg');
      await ctx.db
        .insertInto('files')
        .values({
          id: fid,
          uploader_id: userId,
          purpose: 'attachment',
          channel_id: null,
          message_id: null,
          name: s.file,
          mime: 'image/jpeg',
          size: statSync(full).size,
          storage_key: key,
          width: 1536,
          height: 1024,
          created_at: new Date(ms).toISOString(),
        })
        .execute();
      fileIds = [fid];
    }
    const row = await createMessage(ctx, {
      id: ulid(ms),
      channel,
      userId,
      kind: isBot ? 'bot' : 'user',
      asName: isBot ? s.by.slice(4) : null,
      body: s.text,
      threadRootId,
      createdAt: new Date(ms).toISOString(),
      fileIds,
      poll: s.poll
        ? { question: s.poll.question, options: s.poll.options, multiple: false, anonymous: false }
        : undefined,
      skipNotify: true,
    });
    for (const [emoji, who] of Object.entries(s.react ?? {})) {
      await ctx.db
        .insertInto('reactions')
        .values(
          who.map((w, i) => ({
            message_id: row.id,
            user_id: ids[w]!,
            emoji,
            created_at: new Date(ms + (i + 1) * 30_000).toISOString(),
          })),
        )
        .execute();
    }
    if (s.pin)
      await ctx.db
        .insertInto('pins')
        .values({
          channel_id: channel.id,
          message_id: row.id,
          pinned_by: ids.demo!,
          created_at: new Date(ms).toISOString(),
        })
        .execute();
    if (s.poll) {
      for (const [who, opt] of Object.entries(s.poll.votes)) {
        await ctx.db
          .insertInto('poll_votes')
          .values({ message_id: row.id, option_id: String(opt + 1), user_id: ids[who]! })
          .execute();
      }
    }
    for (const r of s.thread ?? []) await post(channel, r, row.id);
    return row;
  };

  for (const spec of CHANNELS) {
    const ch = await createChannel(ctx, {
      name: spec.name,
      kind: spec.kind,
      topic: spec.topic,
      description: spec.description ?? '',
      isDefault: spec.isDefault,
      isReadonly: spec.isReadonly,
      createdBy: ids.demo!,
    });
    const created = new Date(at(30 * D)).toISOString();
    await ctx.db
      .updateTable('channels')
      .set({ created_at: created })
      .where('id', '=', ch.id)
      .execute();
    const members = (spec.members === 'all' ? STAFF : spec.members)
      .map((k) => ids[k]!)
      .filter((id) => id !== ids.demo);
    await addMembers(ctx, ch, members, ids.demo!, { silent: true });
    await ctx.db
      .updateTable('channel_members')
      .set({ joined_at: created, last_read_message_id: null })
      .where('channel_id', '=', ch.id)
      .execute();
    channelRows[spec.name] = ch;
    for (const m of spec.messages) await post(ch, m);
  }

  for (const dm of DMS) {
    const ids2 = [ids.demo!, ids[dm.with]!].sort();
    const ch: ChannelsTable = {
      id: ulid(at(10 * D)),
      kind: 'dm',
      name: '',
      topic: '',
      description: '',
      created_by: ids.demo!,
      is_default: 0,
      is_readonly: 0,
      dm_key: ids2.join(':'),
      retention_days: null,
      archived_at: null,
      created_at: new Date(at(10 * D)).toISOString(),
      last_message_at: null,
    };
    await ctx.db.insertInto('channels').values(ch).execute();
    await addMembers(ctx, ch, ids2, ids.demo!, { silent: true });
    await ctx.db
      .updateTable('channel_members')
      .set({ last_read_message_id: null })
      .where('channel_id', '=', ch.id)
      .execute();
    channelRows[`dm-${dm.with}`] = ch;
    for (const m of dm.messages) await post(ch, m);
  }

  // Everyone has read everything, except a few realistic unreads for the demo account.
  const unreadFor: Record<string, number> = { design: 1, engineering: 2, 'dm-sam': 1 };
  for (const [name, ch] of Object.entries(channelRows)) {
    const latest = await ctx.db
      .selectFrom('messages')
      .select('id')
      .where('channel_id', '=', ch.id)
      .where('thread_root_id', 'is', null)
      .orderBy('id', 'desc')
      .limit((unreadFor[name] ?? 0) + 1)
      .execute();
    const allRead = latest[0]?.id ?? null;
    const demoRead = latest[latest.length - 1]?.id ?? null;
    await ctx.db
      .updateTable('channel_members')
      .set({ last_read_message_id: allRead })
      .where('channel_id', '=', ch.id)
      .where('user_id', '!=', ids.demo!)
      .execute();
    await ctx.db
      .updateTable('channel_members')
      .set({
        last_read_message_id: unreadFor[name]
          ? latest.length > unreadFor[name]!
            ? demoRead
            : null
          : allRead,
      })
      .where('channel_id', '=', ch.id)
      .where('user_id', '=', ids.demo!)
      .execute();
  }
  // Star a couple of channels for the demo account.
  for (const n of ['design', 'client-harbor']) {
    await ctx.db
      .updateTable('channel_members')
      .set({ starred: 1 })
      .where('channel_id', '=', channelRows[n]!.id)
      .where('user_id', '=', ids.demo!)
      .execute();
  }
  // The mention of @demo in #design shows up in Activity.
  const mention = await ctx.db
    .selectFrom('messages')
    .select(['id', 'channel_id', 'user_id'])
    .where('channel_id', '=', channelRows.design!.id)
    .where('body', 'like', '%sign off%')
    .executeTakeFirst();
  if (mention) {
    await ctx.db
      .insertInto('notifications')
      .values({
        id: ulid(),
        user_id: ids.demo!,
        kind: 'mention',
        channel_id: mention.channel_id,
        message_id: mention.id,
        actor_id: mention.user_id,
        text: 'can you sign off on the new color tokens by end of day? 🙏',
        read_at: null,
        emailed_at: null,
        created_at: nowIso(),
      })
      .execute();
  }
  return { email: DEMO_EMAIL, password, people: PEOPLE.length, channels: CHANNELS.length };
}
