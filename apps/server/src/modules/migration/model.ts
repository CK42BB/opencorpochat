// SPDX-License-Identifier: AGPL-3.0-only
// The neutral data model every migration source is converted into. Source readers
// (slack.ts, teams.ts) only parse their archive format; the engine (engine.ts) does all
// the writing, so every source gets the same preview, privacy rules, audit and undo.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { openZip } from '../../lib/zip.js';

export type SourceKind = 'slack' | 'teams';
export type SourceChannelKind = 'public' | 'private' | 'dm' | 'group_dm';

export interface SourceUser {
  /** Stable id in the source system. */
  id: string;
  email?: string;
  username: string;
  displayName: string;
  title?: string;
  isBot?: boolean;
  /** The account was removed or disabled in the source system. */
  deleted?: boolean;
}

export interface SourceChannel {
  id: string;
  name: string;
  kind: SourceChannelKind;
  topic?: string;
  description?: string;
  /** Source user ids. */
  memberIds: string[];
  archived?: boolean;
  /** Grouping shown in the preview, e.g. the team a channel belongs to. */
  group?: string;
}

export interface SourceFile {
  id: string;
  name: string;
  mime?: string;
  size?: number;
  /** Contents bundled in the archive. */
  read?: () => Buffer;
  /** Contents that must be downloaded (only from hosts the source allows). */
  url?: string;
  /** Link shown in the message when the contents are not imported. */
  link?: string;
}

export interface SourceMessage {
  /** Unique within the source (not just within the channel). */
  id: string;
  /** Source user id of the author, if the author is a person. */
  userId?: string;
  /** Display name for bots, integrations and unknown authors. */
  authorName?: string;
  /** Markdown. User mentions are written as <@sourceUserId> and resolved on import. */
  text: string;
  createdAt: string;
  editedAt?: string;
  /** Source id of the thread root, for replies. */
  threadId?: string;
  alsoInChannel?: boolean;
  reactions: { emoji: string; userIds: string[] }[];
  files: SourceFile[];
}

export interface MigrationSource {
  kind: SourceKind;
  /** Human-readable description, e.g. the workspace or tenant. */
  label: string;
  users: SourceUser[];
  channels: SourceChannel[];
  /** Messages of one channel in chronological order (thread roots before their replies). */
  messages(channelId: string): Iterable<SourceMessage>;
  /** Hosts files may be downloaded from (for SourceFile.url). */
  downloadHosts: string[];
  warnings: string[];
  close(): void;
}

/** Read-only access to an archive, whether it is a ZIP file or an unzipped folder. */
export interface Archive {
  files: string[];
  has(name: string): boolean;
  read(name: string): Buffer;
  text(name: string): string;
  json<T>(name: string): T;
  close(): void;
}

export function openArchive(input: string): Archive {
  if (!existsSync(input)) throw new Error(`Not found: ${input}`);
  let read: (name: string) => Buffer;
  let files: string[];
  let close = () => {};
  if (statSync(input).isDirectory()) {
    const root = path.resolve(input);
    const walk = (dir: string, base = ''): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p, `${base}${f}/`) : [`${base}${f}`];
      });
    files = walk(root);
    read = (name) => {
      const p = path.resolve(root, name);
      if (!p.startsWith(root + path.sep)) throw new Error('Invalid path in archive');
      return readFileSync(p);
    };
  } else {
    const zip = openZip(input);
    const map = new Map(zip.entries.map((e) => [e.name, e]));
    files = [...map.keys()];
    read = (name) => {
      const e = map.get(name);
      if (!e) throw new Error(`Missing file in archive: ${name}`);
      return e.read();
    };
    close = () => zip.close();
  }
  const set = new Set(files);
  return {
    files,
    has: (n) => set.has(n),
    read,
    text: (n) => read(n).toString('utf8'),
    json: <T>(n: string) =>
      JSON.parse(
        read(n)
          .toString('utf8')
          .replace(/^\uFEFF/, ''),
      ) as T,
    close,
  };
}

/** SHA-256 of an archive. For a folder: a hash over every file's path and contents, in order. */
export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  if (statSync(file).isDirectory()) {
    const walk = (dir: string, base = ''): string[] =>
      readdirSync(dir)
        .sort()
        .flatMap((f) =>
          statSync(path.join(dir, f)).isDirectory()
            ? walk(path.join(dir, f), `${base}${f}/`)
            : [`${base}${f}`],
        );
    for (const f of walk(file)) {
      h.update(`${f}\0`);
      h.update(await sha256File(path.join(file, f)));
    }
    return h.digest('hex');
  }
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** Total size in bytes of a file or folder. */
export function archiveSize(file: string): number {
  const st = statSync(file);
  if (!st.isDirectory()) return st.size;
  return readdirSync(file).reduce((n, f) => n + archiveSize(path.join(file, f)), 0);
}

/** Decide which reader handles an archive by looking at its contents. */
export function detectSource(a: Archive): SourceKind | null {
  if (a.files.some((f) => /(^|\/)ocpc-teams-manifest\.json$/.test(f))) return 'teams';
  if (
    a.files.some((f) => /(^|\/)users\.json$/.test(f)) &&
    a.files.some((f) => /(^|\/)channels\.json$/.test(f))
  )
    return 'slack';
  return null;
}

export async function openSource(input: string, kind?: SourceKind): Promise<MigrationSource> {
  const archive = openArchive(input);
  try {
    const detected = kind ?? detectSource(archive);
    if (detected === 'slack') return (await import('./slack.js')).readSlack(archive);
    if (detected === 'teams') return (await import('./teams.js')).readTeams(archive);
  } catch (err) {
    archive.close();
    throw err;
  }
  archive.close();
  throw new Error(
    'Unrecognized archive. Expected a Slack-format workspace export, or a Microsoft Teams archive made with "ocpc collect-teams".',
  );
}
