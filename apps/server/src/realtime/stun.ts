// SPDX-License-Identifier: AGPL-3.0-only
// Minimal built-in STUN server (RFC 8489 Binding requests only) so WebRTC calls can discover
// public addresses without relying on any third-party STUN service. It answers each
// Binding request with an XOR-MAPPED-ADDRESS. It is NOT a TURN relay: very restrictive
// networks still need TURN (see docs/admin-guide.md).
import dgram from 'node:dgram';
import net from 'node:net';

const MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;
const SOFTWARE = 0x8022;

/** Build a Binding success response for a request, or null if the packet isn't a STUN Binding request. */
export function stunResponse(msg: Buffer, address: string, port: number): Buffer | null {
  if (msg.length < 20 || (msg[0]! & 0xc0) !== 0) return null;
  if (msg.readUInt16BE(0) !== BINDING_REQUEST || msg.readUInt32BE(4) !== MAGIC) return null;
  if (msg.readUInt16BE(2) + 20 !== msg.length) return null;
  const txId = msg.subarray(8, 20);

  const v4 = net.isIPv4(address)
    ? address
    : address.startsWith('::ffff:')
      ? address.slice(7)
      : null;
  let attr: Buffer;
  if (v4) {
    attr = Buffer.alloc(12);
    attr.writeUInt16BE(XOR_MAPPED_ADDRESS, 0);
    attr.writeUInt16BE(8, 2);
    attr.writeUInt8(0x01, 5); // family IPv4
    attr.writeUInt16BE(port ^ (MAGIC >>> 16), 6);
    const ip = v4.split('.').reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);
    attr.writeUInt32BE((ip ^ MAGIC) >>> 0, 8);
  } else {
    attr = Buffer.alloc(24);
    attr.writeUInt16BE(XOR_MAPPED_ADDRESS, 0);
    attr.writeUInt16BE(20, 2);
    attr.writeUInt8(0x02, 5); // family IPv6
    attr.writeUInt16BE(port ^ (MAGIC >>> 16), 6);
    const ip = ipv6Bytes(address);
    const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), txId]);
    for (let i = 0; i < 16; i++) attr[8 + i] = ip[i]! ^ key[i]!;
  }
  const sw = Buffer.from('OpenCorpoChat');
  const swAttr = Buffer.alloc(4 + Math.ceil(sw.length / 4) * 4);
  swAttr.writeUInt16BE(SOFTWARE, 0);
  swAttr.writeUInt16BE(sw.length, 2);
  sw.copy(swAttr, 4);

  const header = Buffer.alloc(20);
  header.writeUInt16BE(BINDING_SUCCESS, 0);
  header.writeUInt16BE(attr.length + swAttr.length, 2);
  header.writeUInt32BE(MAGIC, 4);
  txId.copy(header, 8);
  return Buffer.concat([header, attr, swAttr]);
}

function ipv6Bytes(addr: string): Buffer {
  const [head = '', tail = ''] = addr.split('%')[0]!.split('::');
  const parse = (s: string) => (s ? s.split(':').map((h) => parseInt(h, 16)) : []);
  const h = parse(head);
  const t = parse(tail);
  const groups = [...h, ...Array(8 - h.length - t.length).fill(0), ...t];
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(g & 0xffff, i * 2));
  return out;
}

export function startStunServer(port: number, host: string, log: (msg: string) => void) {
  const socket = dgram.createSocket({
    type: net.isIPv6(host) || host === '::' ? 'udp6' : 'udp4',
    reuseAddr: true,
  });
  socket.on('message', (msg, rinfo) => {
    const res = stunResponse(msg, rinfo.address, rinfo.port);
    if (res) socket.send(res, rinfo.port, rinfo.address);
  });
  socket.on('error', (err) => log(`STUN server error: ${err.message}`));
  socket.bind(port, host, () => log(`Built-in STUN server listening on udp/${port}`));
  return () => socket.close();
}
