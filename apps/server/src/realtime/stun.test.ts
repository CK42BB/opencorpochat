// SPDX-License-Identifier: AGPL-3.0-only
import dgram from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { startStunServer, stunResponse } from './stun.js';

function bindingRequest() {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(0x0001, 0);
  b.writeUInt32BE(0x2112a442, 4);
  for (let i = 8; i < 20; i++) b[i] = i;
  return b;
}

function decodeXorMapped(res: Buffer) {
  let off = 20;
  while (off < res.length) {
    const type = res.readUInt16BE(off);
    const len = res.readUInt16BE(off + 2);
    if (type === 0x0020) {
      const port = res.readUInt16BE(off + 6) ^ 0x2112;
      const ip = (res.readUInt32BE(off + 8) ^ 0x2112a442) >>> 0;
      return { port, ip: [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.') };
    }
    off += 4 + Math.ceil(len / 4) * 4;
  }
  return null;
}

describe('built-in STUN server', () => {
  it('encodes XOR-MAPPED-ADDRESS for IPv4', () => {
    const res = stunResponse(bindingRequest(), '203.0.113.7', 54321)!;
    expect(res.readUInt16BE(0)).toBe(0x0101);
    expect(res.subarray(8, 20)).toEqual(bindingRequest().subarray(8, 20));
    expect(decodeXorMapped(res)).toEqual({ ip: '203.0.113.7', port: 54321 });
  });

  it('ignores non-STUN packets', () => {
    expect(stunResponse(Buffer.from('hello world, not stun'), '1.2.3.4', 1)).toBeNull();
  });

  it('answers over UDP', async () => {
    const stop = startStunServer(0, '127.0.0.1', () => {});
    // Find the bound port by binding our own server on an ephemeral port instead.
    stop();
    const server = dgram.createSocket('udp4');
    await new Promise<void>((r) => server.bind(0, '127.0.0.1', r));
    const port = server.address().port;
    server.close();
    const stop2 = startStunServer(port, '127.0.0.1', () => {});
    await new Promise((r) => setTimeout(r, 50));
    const client = dgram.createSocket('udp4');
    const reply = await new Promise<Buffer>((resolve) => {
      client.on('message', resolve);
      client.send(bindingRequest(), port, '127.0.0.1');
    });
    const mapped = decodeXorMapped(reply)!;
    expect(mapped.ip).toBe('127.0.0.1');
    expect(mapped.port).toBe(client.address().port);
    client.close();
    stop2();
  });
});
