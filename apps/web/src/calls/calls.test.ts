// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { CandidateQueue, isPolite } from './transport';
import { peersToOffer } from './mesh';

describe('perfect negotiation roles', () => {
  it('exactly one side of a pair is polite', () => {
    expect(isPolite('B', 'A')).toBe(true);
    expect(isPolite('A', 'B')).toBe(false);
  });
});

describe('CandidateQueue', () => {
  it('buffers until the remote description exists, then flushes in order', async () => {
    let remote = false;
    const added: string[] = [];
    const q = new CandidateQueue(
      () => remote,
      async (c) => void added.push(c.candidate ?? ''),
    );
    await q.push({ candidate: 'a' });
    await q.push({ candidate: 'b' });
    expect(added).toEqual([]);
    expect(q.size).toBe(2);
    remote = true;
    await q.flush();
    await q.push({ candidate: 'c' });
    expect(added).toEqual(['a', 'b', 'c']);
  });
});

describe('peersToOffer', () => {
  it('excludes our own connection', () => {
    const call = {
      id: 'x',
      channelId: 'c',
      startedBy: 'u1',
      startedAt: '',
      participants: [
        {
          userId: 'u1',
          connectionId: 'c1',
          joinedAt: '',
          audio: true,
          video: false,
          screen: false,
        },
        {
          userId: 'u2',
          connectionId: 'c2',
          joinedAt: '',
          audio: true,
          video: false,
          screen: false,
        },
      ],
    };
    expect(peersToOffer(call, 'c2').map((p) => p.connectionId)).toEqual(['c1']);
  });
});
