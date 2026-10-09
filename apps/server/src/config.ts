// SPDX-License-Identifier: AGPL-3.0-only
// Environment configuration, validated at boot. See docs/admin-guide.md for the reference.
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');
const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  OCPC_PUBLIC_URL: opt,
  OCPC_DATA_DIR: z.string().default('./data'),
  DATABASE_URL: opt,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  OCPC_SECRET: opt,
  OCPC_SOURCE_URL: z.string().default('https://github.com/opencorpochat/opencorpochat'),
  OCPC_LOG_LEVEL: z.string().default('info'),
  OCPC_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(100),
  OCPC_TRUST_PROXY: bool,
  OCPC_WEB_DIR: opt,
  OCPC_WEB_DIST: opt,

  S3_ENDPOINT: opt,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: opt,
  S3_ACCESS_KEY_ID: opt,
  S3_SECRET_ACCESS_KEY: opt,
  S3_FORCE_PATH_STYLE: bool,

  SMTP_URL: opt,
  SMTP_FROM: opt,

  OIDC_ISSUER: opt,
  OIDC_CLIENT_ID: opt,
  OIDC_CLIENT_SECRET: opt,
  OIDC_BUTTON_LABEL: z.string().default('Sign in with SSO'),
  OIDC_AUTO_CREATE: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  OIDC_ALLOWED_DOMAINS: list,

  TURN_URLS: list,
  TURN_SECRET: opt,
  STUN_URLS: list,

  LIVEKIT_URL: opt,
  LIVEKIT_API_KEY: opt,
  LIVEKIT_API_SECRET: opt,

  VAPID_PUBLIC_KEY: opt,
  VAPID_PRIVATE_KEY: opt,
  VAPID_SUBJECT: opt,
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  env: Env;
  production: boolean;
  port: number;
  host: string;
  publicUrl: string;
  secureCookies: boolean;
  dataDir: string;
  filesDir: string;
  database: { kind: 'sqlite'; file: string } | { kind: 'postgres'; url: string; poolMax: number };
  secret: string;
  sourceUrl: string;
  logLevel: string;
  maxUploadMb: number;
  trustProxy: boolean;
  webDir: string | null;
  s3: null | {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
  };
  smtp: null | { url: string; from: string };
  oidc: null | {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    label: string;
    autoCreate: boolean;
    allowedDomains: string[];
  };
  turn: { urls: string[]; secret?: string; stunUrls: string[] };
  livekit: null | { url: string; apiKey: string; apiSecret: string };
  vapid: { publicKey: string; privateKey: string; subject: string };
}

/** Generate a P-256 VAPID key pair (base64url, uncompressed public key) without external deps. */
export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

/** Read a value persisted in the data dir, or create it once. */
function persisted(dataDir: string, name: string, make: () => string): string {
  const file = path.join(dataDir, name);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const v = make();
  writeFileSync(file, v + '\n', { mode: 0o600 });
  return v;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env, overrides: Partial<Env> = {}): Config {
  const parsed = EnvSchema.safeParse({ ...source, ...overrides });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.OCPC_DATA_DIR);
  mkdirSync(dataDir, { recursive: true });
  const filesDir = path.join(dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  const publicUrl = (env.OCPC_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '');
  if (production && !env.OCPC_PUBLIC_URL) {
    console.warn('[ocpc] OCPC_PUBLIC_URL is not set; links in emails and SSO redirects will use ' + publicUrl);
  }

  const dbUrl = env.DATABASE_URL;
  const database: Config['database'] =
    dbUrl && /^postgres(ql)?:\/\//.test(dbUrl)
      ? { kind: 'postgres', url: dbUrl, poolMax: env.DATABASE_POOL_MAX }
      : { kind: 'sqlite', file: dbUrl ? dbUrl.replace(/^sqlite:(\/\/)?/, '') : path.join(dataDir, 'ocpc.db') };

  const secret = env.OCPC_SECRET ?? persisted(dataDir, 'secret.key', () => randomBytes(32).toString('base64url'));

  // VAPID keys for Web Push: from env, or generated once and persisted in the data dir.
  let vapid: Config['vapid'];
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: '' };
  } else {
    const keys = JSON.parse(persisted(dataDir, 'vapid.json', () => JSON.stringify(generateVapidKeys())));
    vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: '' };
  }
  vapid.subject = env.VAPID_SUBJECT ?? (publicUrl.startsWith('https://') ? publicUrl : 'mailto:admin@localhost');

  const webDirCandidates = [
    env.OCPC_WEB_DIST,
    env.OCPC_WEB_DIR,
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist'),
  ].filter(Boolean) as string[];
  const webDir = webDirCandidates.find((d) => existsSync(path.join(d, 'index.html'))) ?? null;

  return {
    env,
    production,
    port: env.PORT,
    host: env.HOST,
    publicUrl,
    secureCookies: publicUrl.startsWith('https://'),
    dataDir,
    filesDir,
    database,
    secret,
    sourceUrl: env.OCPC_SOURCE_URL,
    logLevel: env.OCPC_LOG_LEVEL,
    maxUploadMb: env.OCPC_MAX_UPLOAD_MB,
    trustProxy: env.OCPC_TRUST_PROXY,
    webDir,
    s3: env.S3_BUCKET
      ? {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        }
      : null,
    smtp: env.SMTP_URL ? { url: env.SMTP_URL, from: env.SMTP_FROM ?? `OpenCorpoChat <no-reply@${new URL(publicUrl).hostname}>` } : null,
    oidc:
      env.OIDC_ISSUER && env.OIDC_CLIENT_ID
        ? {
            issuer: env.OIDC_ISSUER.replace(/\/+$/, ''),
            clientId: env.OIDC_CLIENT_ID,
            clientSecret: env.OIDC_CLIENT_SECRET,
            label: env.OIDC_BUTTON_LABEL,
            autoCreate: env.OIDC_AUTO_CREATE,
            allowedDomains: env.OIDC_ALLOWED_DOMAINS.map((d) => d.toLowerCase()),
          }
        : null,
    turn: { urls: env.TURN_URLS, secret: env.TURN_SECRET, stunUrls: env.STUN_URLS },
    livekit:
      env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
        ? { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET }
        : null,
    vapid,
  };
}
