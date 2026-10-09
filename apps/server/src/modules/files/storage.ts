// SPDX-License-Identifier: AGPL-3.0-only
// Blob storage: local disk by default, any S3-compatible service optionally.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Config } from '../../config.js';

export interface Storage {
  kind: 'local' | 's3';
  put(key: string, data: Readable, size: number, mime: string): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Local file path if available (used by backups). */
  localPath?(key: string): string;
}

class LocalStorage implements Storage {
  kind = 'local' as const;
  constructor(private root: string) {}

  localPath(key: string) {
    // Keys are generated server-side, but guard against traversal anyway.
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Readable) {
    const p = this.localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    try {
      await pipeline(data, createWriteStream(p, { flags: 'wx' }));
    } catch (err) {
      await rm(p, { force: true });
      throw err;
    }
  }

  async get(key: string, range?: { start: number; end: number }) {
    const p = this.localPath(key);
    await stat(p);
    return createReadStream(p, range);
  }

  async delete(key: string) {
    await rm(this.localPath(key), { force: true });
  }
}

class S3Storage implements Storage {
  kind = 's3' as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private s3: any;
  constructor(
    private cfg: NonNullable<Config['s3']>,
    private tmpDir: string,
  ) {}

  private async init() {
    if (this.client) return;
    try {
      this.s3 = await import('@aws-sdk/client-s3');
    } catch {
      throw new Error('S3 storage configured but @aws-sdk/client-s3 is not installed');
    }
    this.client = new this.s3.S3Client({
      region: this.cfg.region,
      endpoint: this.cfg.endpoint,
      forcePathStyle: this.cfg.forcePathStyle,
      credentials:
        this.cfg.accessKeyId && this.cfg.secretAccessKey
          ? { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, data: Readable, _size: number, mime: string) {
    await this.init();
    // S3 needs an exact Content-Length, so spool the upload to a temp file first.
    const tmp = path.join(this.tmpDir, key.replace(/[^\w.-]/g, '_'));
    await mkdir(this.tmpDir, { recursive: true });
    try {
      await pipeline(data, createWriteStream(tmp));
      const { size } = await stat(tmp);
      await this.client.send(
        new this.s3.PutObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          Body: createReadStream(tmp),
          ContentLength: size,
          ContentType: mime,
        }),
      );
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async get(key: string, range?: { start: number; end: number }) {
    await this.init();
    const out = await this.client.send(
      new this.s3.GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return out.Body as Readable;
  }

  async delete(key: string) {
    await this.init();
    await this.client.send(new this.s3.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export function createStorage(config: Config): Storage {
  return config.s3
    ? new S3Storage(config.s3, path.join(config.dataDir, 'tmp'))
    : new LocalStorage(config.filesDir);
}

/** Buffer → Readable helper. */
export const fromBuffer = (b: Buffer) => Readable.from(b);
