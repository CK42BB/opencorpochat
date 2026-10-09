// SPDX-License-Identifier: AGPL-3.0-only
// Minimal receiver for OpenCorpoChat outgoing webhooks / slash commands.
// Usage: OCPC_SECRET=<signing secret> node examples/webhook-receiver.mjs
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const secret = process.env.OCPC_SECRET ?? '';

function verify(req, body) {
  const ts = req.headers['x-ocpc-timestamp'];
  const sig = String(req.headers['x-ocpc-signature'] ?? '');
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!verify(req, body)) {
        res.writeHead(401).end();
        return;
      }
      const payload = JSON.parse(body);
      // Slash command: reply only to the caller. Outgoing webhook: post a reply into the channel.
      const reply = payload.command
        ? { response_type: 'ephemeral', text: `You ran ${payload.command} with "${payload.text}"` }
        : { text: `Echo from bot: ${payload.text}` };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
    });
  })
  .listen(3001, () => console.log('listening on :3001'));
