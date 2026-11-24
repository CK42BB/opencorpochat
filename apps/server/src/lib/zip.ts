// SPDX-License-Identifier: AGPL-3.0-only
// Minimal ZIP reader and writer (stored/deflate entries) for import and export archives,
// without adding a dependency. Entries are read on demand from the file, so large
// archives are never loaded into memory at once. Archives up to 4 GB (no ZIP64).
import { closeSync, createWriteStream, openSync, readSync, fstatSync } from 'node:fs';
import { once } from 'node:events';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  size: number;
  read(): Buffer;
}

export interface ZipReader {
  entries: ZipEntry[];
  close(): void;
}

function readAt(fd: number, pos: number, len: number) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, pos + off);
    if (n === 0) throw new Error('Unexpected end of ZIP file');
    off += n;
  }
  return buf;
}

export function openZip(file: string): ZipReader {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65_557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP file');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff)
      throw new Error('ZIP64 archives are not supported; unzip it and import the folder instead');
    const cd = readAt(fd, cdOffset, cdSize);
    let p = 0;
    const entries: ZipEntry[] = [];
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const rawSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOff = cd.readUInt32LE(p + 42);
      // Bit 11 = UTF-8 names. Older tools use CP437, which matches UTF-8 for ASCII names.
      const name = cd
        .subarray(p + 46, p + 46 + nameLen)
        .toString(flags & 0x800 ? 'utf8' : 'latin1');
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      entries.push({
        name,
        size: rawSize,
        read() {
          const head = readAt(fd, localOff, 30);
          if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt ZIP entry');
          const start = localOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
          const data = readAt(fd, start, compSize);
          if (method === 0) return data;
          if (method === 8) return inflateRawSync(data);
          throw new Error(`Unsupported ZIP compression method ${method}`);
        },
      });
    }
    return { entries, close: () => closeSync(fd) };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

/** Write a ZIP file. Entries are added one at a time, so memory use stays small. */
export class ZipWriter {
  private out;
  private offset = 0;
  private central: Buffer[] = [];
  private count = 0;

  constructor(file: string) {
    this.out = createWriteStream(file, { flags: 'wx' });
  }

  private async write(b: Buffer) {
    this.offset += b.length;
    if (this.offset > 0xffffffff) throw new Error('Archive is larger than 4 GB');
    if (!this.out.write(b)) await once(this.out, 'drain');
  }

  async add(name: string, data: Buffer | string) {
    const raw = typeof data === 'string' ? Buffer.from(data) : data;
    const deflated = raw.length > 64 ? deflateRawSync(raw) : null;
    const useDeflate = !!deflated && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const nameBuf = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(0, 10); // DOS time/date (unused)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(this.offset, 42);
    this.central.push(cd, nameBuf);
    this.count++;
    if (this.count >= 0xffff) throw new Error('Too many files for a ZIP archive');
    await this.write(local);
    await this.write(nameBuf);
    await this.write(body);
  }

  async close() {
    const cdStart = this.offset;
    for (const b of this.central) await this.write(b);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.count, 8);
    eocd.writeUInt16LE(this.count, 10);
    eocd.writeUInt32LE(this.offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    await this.write(eocd);
    this.out.end();
    await once(this.out, 'finish');
  }
}
