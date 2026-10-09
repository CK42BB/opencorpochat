// SPDX-License-Identifier: AGPL-3.0-only
// Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level M,
// versions 1–10. Written from the specification; no dependencies. Used to show
// two-factor authentication enrollment codes.

/** Per-version layout for level M: EC codewords per block and data codewords per block. */
interface VersionInfo {
  ecPerBlock: number;
  blocks: number[]; // data codewords in each block
}

const LEVEL_M: Record<number, VersionInfo> = {
  1: { ecPerBlock: 10, blocks: [16] },
  2: { ecPerBlock: 16, blocks: [28] },
  3: { ecPerBlock: 26, blocks: [44] },
  4: { ecPerBlock: 18, blocks: [32, 32] },
  5: { ecPerBlock: 24, blocks: [43, 43] },
  6: { ecPerBlock: 16, blocks: [27, 27, 27, 27] },
  7: { ecPerBlock: 18, blocks: [31, 31, 31, 31] },
  8: { ecPerBlock: 22, blocks: [38, 38, 39, 39] },
  9: { ecPerBlock: 22, blocks: [36, 36, 36, 37, 37] },
  10: { ecPerBlock: 26, blocks: [43, 43, 43, 43, 44] },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const REMAINDER_BITS: Record<number, number> = {
  1: 0,
  2: 7,
  3: 7,
  4: 7,
  5: 7,
  6: 7,
  7: 0,
  8: 0,
  9: 0,
  10: 0,
};

export const MAX_VERSION = 10;

const dataCapacity = (v: number) => LEVEL_M[v]!.blocks.reduce((a, b) => a + b, 0);
const countBits = (v: number) => (v <= 9 ? 8 : 16);

/** Smallest version whose capacity fits `byteLength` bytes in byte mode. */
export function chooseVersion(byteLength: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const bits = 4 + countBits(v) + byteLength * 8;
    if (bits <= dataCapacity(v) * 8) return v;
  }
  throw new Error('Data too long for QR versions 1–10');
}

// ---------- GF(256) arithmetic, primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D) ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

export function gfMul(a: number, b: number) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** Generator polynomial coefficients (highest degree first, leading 1 omitted). */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** Reed–Solomon error correction codewords for `data`. */
export function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const rem = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecCount; i++) rem[i] = rem[i]! ^ gfMul(gen[i]!, factor);
  }
  return rem;
}

/** 15-bit format information for level M and a mask (BCH(15,5), masked with 0x5412). */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

/** 18-bit version information (versions ≥ 7), BCH(18,6). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const info = LEVEL_M[version]!;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const len of info.blocks) {
    const block = data.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, info.ecPerBlock));
  }
  const out: number[] = [];
  const maxLen = Math.max(...info.blocks);
  for (let i = 0; i < maxLen; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < info.ecPerBlock; i++) for (const b of ecBlocks) out.push(b[i]!);
  return out;
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] — true is dark. */
  modules: boolean[][];
}

class Builder {
  size: number;
  modules: boolean[][];
  reserved: boolean[][];
  constructor(public version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.reserved = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.reserved[y]![x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    // Timing patterns.
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    // Finder patterns with separators.
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFn(x, y, d !== 2 && d !== 4);
        }
      }
    }
    // Alignment patterns (skip those overlapping finders).
    const pos = ALIGNMENT[this.version]!;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0)
        )
          continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++)
            this.setFn(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    // Reserve format areas (real bits drawn later), and version info.
    this.drawFormat(0);
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.setFn(a, b, dark);
        this.setFn(b, a, dark);
      }
    }
  }
  drawFormat(mask: number) {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true); // dark module
  }
  placeData(codewords: number[]) {
    const n = this.size;
    const bits: number[] = [];
    for (const c of codewords) for (let i = 7; i >= 0; i--) bits.push((c >>> i) & 1);
    for (let i = 0; i < REMAINDER_BITS[this.version]!; i++) bits.push(0);
    let k = 0;
    let upward = true;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < n; vert++) {
        const y = upward ? n - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (this.reserved[y]![x]) continue;
          this.modules[y]![x] = k < bits.length ? bits[k] === 1 : false;
          k++;
        }
      }
      upward = !upward;
    }
  }
  applyMask(mask: number) {
    const fn = MASKS[mask]!;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++)
        if (!this.reserved[y]![x] && fn(x, y)) this.modules[y]![x] = !this.modules[y]![x];
    }
  }
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    // Rule 1: runs of 5+ same-colour modules in rows/columns.
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          const cur = pass === 0 ? m[a]![b] : m[b]![a];
          const prev = pass === 0 ? m[a]![b - 1] : m[b - 1]![a];
          if (cur === prev) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
    }
    // Rule 2: 2x2 blocks.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }
    // Rule 3: finder-like patterns 1011101 with 4 light modules on a side.
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [...pat1].reverse();
    for (let a = 0; a < n; a++) {
      for (let b = 0; b <= n - 11; b++) {
        for (const pat of [pat1, pat2]) {
          let row = true;
          let col = true;
          for (let k = 0; k < 11; k++) {
            if (m[a]![b + k] !== pat[k]) row = false;
            if (m[b + k]![a] !== pat[k]) col = false;
          }
          if (row) score += 40;
          if (col) score += 40;
        }
      }
    }
    // Rule 4: dark/light balance.
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }
}

export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = interleave(encodeData(bytes, version), version);
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const b = new Builder(version);
    b.drawFunctionPatterns();
    b.placeData(codewords);
    b.applyMask(mask);
    b.drawFormat(mask);
    const score = b.penalty();
    if (!best || score < best.score) best = { mask, modules: b.modules, score };
  }
  return { version, size: version * 4 + 17, mask: best!.mask, modules: best!.modules };
}

/** SVG path data (one unit per module, offset by a 4-module quiet zone). */
export function qrSvgPath(qr: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++)
      if (qr.modules[y]![x]) parts.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
  }
  return parts.join('');
}

/** Test helper: evaluate a codeword polynomial at alpha^i (0 for valid RS codewords). */
export function evalCodeword(word: number[], i: number): number {
  let acc = 0;
  for (const c of word) acc = gfMul(acc, EXP[i]!) ^ c;
  return acc;
}
