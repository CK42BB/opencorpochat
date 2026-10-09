// SPDX-License-Identifier: AGPL-3.0-only
// Request-body schemas. The server validates with these; clients may use them for forms.
import { z } from 'zod';

// The escaped '-' keeps this valid as an HTML pattern attribute (compiled with the `v` flag).
// eslint-disable-next-line no-useless-escape
export const USERNAME_RE = /^[a-z0-9][a-z0-9._\-]{1,31}$/;
export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const EMOJI_NAME_RE = /^[a-z0-9_+-]{1,64}$/;

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, 'Usernames are 2–32 characters: lowercase letters, numbers, . _ -');
export const password = z.string().min(10, 'Passwords must be at least 10 characters').max(256);
export const email = z.string().trim().toLowerCase().email().max(254);
export const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\s+/g, '-'))
  .pipe(z.string().regex(CHANNEL_NAME_RE, 'Channel names: lowercase letters, numbers, - and _'));
export const id = z.string().min(1).max(64);
export const messageBody = z.string().max(40_000);

export const SetupInput = z.object({
  orgName: z.string().trim().min(1).max(80),
  email,
  username,
  displayName: z.string().trim().min(1).max(80),
  password,
});

export const LoginInput = z.object({
  login: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
  totp: z.string().trim().max(32).optional(),
});

export const RegisterInput = z.object({
  inviteCode: z.string().min(1).max(128),
  email,
  username,
  displayName: z.string().trim().min(1).max(80),
  password,
});

export const ChangePasswordInput = z.object({
  currentPassword: z.string().max(256).optional(),
  newPassword: password,
});

export const TotpEnableInput = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().max(12),
});
export const TotpDisableInput = z.object({ code: z.string().max(32) });

export const UpdateProfileInput = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    fullName: z.string().trim().max(120),
    title: z.string().trim().max(120),
    pronouns: z.string().trim().max(40),
    timezone: z.string().trim().max(64),
    phone: z.string().trim().max(40),
    avatarFileId: z.string().max(64).nullable(),
  })
  .partial();

export const UpdateStatusInput = z.object({
  emoji: z.string().max(64).default(''),
  text: z.string().max(100).default(''),
  expiresAt: z.string().datetime().nullable().default(null),
});

export const UpdateDndInput = z.object({ until: z.string().datetime().nullable() });

export const PreferencesInput = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    density: z.enum(['comfortable', 'compact']),
    enterToSend: z.boolean(),
    emailNotifications: z.boolean(),
    emailDelayMinutes: z.number().int().min(1).max(1440),
    keywords: z.array(z.string().trim().min(1).max(50)).max(50),
    notifySchedule: z.object({
      enabled: z.boolean(),
      start: z.string().regex(/^\d\d:\d\d$/),
      end: z.string().regex(/^\d\d:\d\d$/),
      days: z.array(z.number().int().min(0).max(6)),
    }),
    sidebarSections: z
      .array(
        z.object({
          id: z.string().max(40),
          name: z.string().trim().min(1).max(40),
          channelIds: z.array(id).max(500),
        }),
      )
      .max(30),
  })
  .partial();

export const CreateChannelInput = z.object({
  name: channelName,
  kind: z.enum(['public', 'private']).default('public'),
  topic: z.string().max(250).default(''),
  description: z.string().max(1000).default(''),
  isReadonly: z.boolean().default(false),
  memberIds: z.array(id).max(500).default([]),
});

export const UpdateChannelInput = z
  .object({
    name: channelName,
    topic: z.string().max(250),
    description: z.string().max(1000),
    isReadonly: z.boolean(),
    isDefault: z.boolean(),
    kind: z.enum(['public', 'private']),
  })
  .partial();

export const OpenDmInput = z.object({ userIds: z.array(id).min(1).max(8) });

export const AddMembersInput = z.object({ userIds: z.array(id).min(1).max(500) });

export const UpdateMembershipInput = z
  .object({
    notifyLevel: z.enum(['all', 'mentions', 'none']),
    muted: z.boolean(),
    starred: z.boolean(),
  })
  .partial();

export const MarkReadInput = z.object({ messageId: id.nullable() });

export const PollInput = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
});

export const PostMessageInput = z.object({
  body: messageBody,
  threadRootId: id.nullable().optional(),
  alsoInChannel: z.boolean().optional(),
  fileIds: z.array(id).max(20).optional(),
  clientId: z.string().max(64).optional(),
  poll: PollInput.optional(),
});

export const EditMessageInput = z.object({ body: messageBody.min(1) });

export const ReactionInput = z.object({ emoji: z.string().min(1).max(64) });

export const ForwardMessageInput = z.object({ channelId: id, comment: messageBody.default('') });

export const VoteInput = z.object({ optionIds: z.array(z.string().max(16)).max(10) });

export const ScheduleMessageInput = z.object({
  channelId: id,
  threadRootId: id.nullable().optional(),
  body: messageBody.min(1),
  sendAt: z.string().datetime(),
});

export const ReminderInput = z.object({
  messageId: id.nullable().optional(),
  text: z.string().max(500).default(''),
  remindAt: z.string().datetime(),
});

export const CreateInviteInput = z.object({
  role: z.enum(['admin', 'member', 'guest']).default('member'),
  email: email.optional(),
  maxUses: z.number().int().min(1).max(10_000).nullable().default(null),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullable()
    .default(168),
  channelIds: z.array(id).max(100).default([]),
});

export const AdminUpdateUserInput = z
  .object({
    role: z.enum(['owner', 'admin', 'member', 'guest']),
    deactivated: z.boolean(),
    displayName: z.string().trim().min(1).max(80),
    username,
    email,
  })
  .partial();

export const OrgSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    iconFileId: z.string().max(64).nullable(),
    allowSignupDomains: z.array(z.string().trim().toLowerCase().max(253)).max(50),
    require2fa: z.boolean(),
    ssoOnly: z.boolean(),
    guestsEnabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(36500).nullable(),
    linkPreviews: z.boolean(),
    readReceipts: z.boolean(),
    maxUploadMb: z.number().int().min(1).max(10_000),
    allowedMimePrefixes: z.array(z.string().max(100)).max(100),
    defaultChannelIds: z.array(id).max(50),
    messageEditWindowMinutes: z.number().int().min(1).max(525600).nullable(),
  })
  .partial();

export const UserGroupInput = z.object({
  handle: username,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(''),
  memberIds: z.array(id).max(500).default([]),
});

export const CustomEmojiInput = z.object({
  name: z.string().trim().toLowerCase().regex(EMOJI_NAME_RE),
  fileId: id,
});

export const API_SCOPES = ['read', 'write', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const CreateTokenInput = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(['read', 'write']),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
});

export const CreateBotInput = z.object({
  username,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(''),
});

export const CreateWebhookInput = z.object({
  kind: z.enum(['incoming', 'outgoing']),
  name: z.string().trim().min(1).max(80),
  channelId: id,
  url: z.string().url().max(2000).optional(),
  triggerWords: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

export const IncomingWebhookPayload = z.object({
  text: z.string().max(40_000).optional(),
  username: z.string().max(80).optional(),
  // Optional "attachments"-style fallback text, flattened to markdown.
  attachments: z
    .array(
      z.object({
        fallback: z.string().max(4000).optional(),
        pretext: z.string().max(4000).optional(),
        title: z.string().max(400).optional(),
        title_link: z.string().max(2000).optional(),
        text: z.string().max(8000).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const CreateSlashCommandInput = z.object({
  command: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  description: z.string().max(200).default(''),
  usageHint: z.string().max(100).default(''),
  url: z.string().url().max(2000),
});

export const RunSlashCommandInput = z.object({
  channelId: id,
  threadRootId: id.nullable().optional(),
  text: z.string().max(4000),
});

export const PushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export type SetupInput = z.infer<typeof SetupInput>;
export type LoginInput = z.infer<typeof LoginInput>;
export type RegisterInput = z.infer<typeof RegisterInput>;
export type CreateChannelInput = z.input<typeof CreateChannelInput>;
export type UpdateChannelInput = z.infer<typeof UpdateChannelInput>;
export type PostMessageInput = z.input<typeof PostMessageInput>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;
export type PreferencesInput = z.infer<typeof PreferencesInput>;
export type CreateInviteInput = z.input<typeof CreateInviteInput>;
export type OrgSettingsInput = z.infer<typeof OrgSettingsInput>;
export type CreateWebhookInput = z.input<typeof CreateWebhookInput>;
export type CreateSlashCommandInput = z.input<typeof CreateSlashCommandInput>;
export type CreateTokenInput = z.input<typeof CreateTokenInput>;
export type UserGroupInput = z.input<typeof UserGroupInput>;
export type PollInput = z.input<typeof PollInput>;
