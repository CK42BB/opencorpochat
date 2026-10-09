// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { chooseVersion, encodeQr, evalCodeword, formatBits, rsEncode, versionBits } from './qr';

describe('QR encoder', () => {
  it('chooses the smallest version for level M byte mode', () => {
    expect(chooseVersion(14)).toBe(1); // capacity 14 bytes
    expect(chooseVersion(15)).toBe(2);
    expect(chooseVersion(26)).toBe(2);
    expect(chooseVersion(27)).toBe(3);
    expect(chooseVersion(213)).toBe(10);
    expect(() => chooseVersion(214)).toThrow();
  });

  it('computes format information bits (level M)', () => {
    const s = (n: number) => n.toString(2).padStart(15, '0');
    expect(s(formatBits(0))).toBe('101010000010010');
    expect(s(formatBits(1))).toBe('101000100100101');
    expect(s(formatBits(5))).toBe('100000011001110');
  });

  it('computes version information bits', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });

  it('produces Reed–Solomon codewords that form a valid codeword polynomial', () => {
    // Well-known example: "HELLO WORLD" at 1-M.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    // Every root alpha^i of the generator must be a root of data||ec.
    const word = [...data, ...rsEncode(data, 10)];
    for (let i = 0; i < 10; i++) expect(evalCodeword(word, i)).toBe(0);
  });

  it('draws finder, timing and dark-module patterns', () => {
    const qr = encodeQr(
      'otpauth://totp/Acme:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme',
    );
    const n = qr.size;
    expect(n).toBe(qr.version * 4 + 17);
    const m = qr.modules;
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(m[oy! + y]![ox! + x]).toBe(d !== 2);
        }
      }
    }
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8]![8]).toBe(true);
    // Both copies of the format info decode to the same value.
    const bit = (x: number, y: number) => (m[y]![x] ? 1 : 0);
    let a = 0;
    let b = 0;
    const firstPos: [number, number][] = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8],
    ];
    firstPos.forEach(([x, y], i) => (a |= bit(x, y) << i));
    for (let i = 0; i < 8; i++) b |= bit(n - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) b |= bit(8, n - 15 + i) << i;
    expect(a).toBe(formatBits(qr.mask));
    expect(b).toBe(a);
  });

  it('encodes larger versions with version information', () => {
    const qr = encodeQr('x'.repeat(150));
    expect(qr.version).toBeGreaterThanOrEqual(7);
    expect(qr.size).toBe(qr.version * 4 + 17);
  });
});
