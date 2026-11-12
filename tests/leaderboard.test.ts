import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_KIND, BOARD_TAG } from '../src/chain/config.ts';
import { buildScoreEvent, buildSignInMessage, eventId, fetchBoard, type NostrEvent } from '../src/chain/leaderboard.ts';
import { schnorrPublicKey, schnorrSign } from '../src/chain/secp256k1.ts';

const secret = '11'.repeat(32);
const pubkey = schnorrPublicKey(secret);
const address = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';
const signIn = {
  address, pubkey, message: buildSignInMessage(address, pubkey, '2026-11-12T00:00:00.000Z'),
  // Offline signature from the public web3.js documentation wallet, never a funded key.
  signature: '0x6cfb974671631560686729b6f743629443e7319babca7c77c5c4fca67859f01d7b93ace9a4561169bee584bf342ceeaf9a4afa54899cda77a2b5cf61ff6e25831c',
};

function scoreEvent(score: number, created_at: number): NostrEvent {
  const unsigned = {
    pubkey, created_at, kind: BOARD_KIND,
    // Legacy per-run events must remain readable after upgrading to best-only events.
    tags: [['d', `${BOARD_TAG}:${address.toLowerCase()}:${created_at}`], ['t', BOARD_TAG]],
    content: JSON.stringify({ address, score, round: '253', playedAt: created_at * 1000, signIn }),
  };
  const id = eventId(unsigned);
  return { ...unsigned, id, sig: schnorrSign(id, secret, '00'.repeat(32)) };
}

test('an old best survives a relay page cap, including overlapping timestamp boundaries', async t => {
  const events = [scoreEvent(9000, 100), scoreEvent(100, 101), scoreEvent(200, 102), scoreEvent(300, 102), scoreEvent(400, 103)];
  const original = globalThis.WebSocket;
  const filters: { until?: number; limit: number }[] = [];
  class Relay {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror = null;
    onclose = null;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    close() {}
    send(raw: string) {
      const [type, sub, filter] = JSON.parse(raw);
      if (type !== 'REQ') return;
      filters.push(filter);
      const page = events.filter(e => filter.until === undefined || e.created_at <= filter.until)
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, Math.min(filter.limit, 2));
      queueMicrotask(() => {
        for (const e of page) this.onmessage?.({ data: JSON.stringify(['EVENT', sub, e]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', sub]) });
      });
    }
  }
  globalThis.WebSocket = Relay as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  const board = await fetchBoard(['wss://test.invalid']);
  assert.equal(board.relaysAnswered, 1);
  assert.equal(board.rows[0]?.score, 9000, 'best must not fall back to the newest page');
  assert.equal(board.rows[0]?.playedAt, 100_000);
  assert.ok(filters.length > 1, 'a relay cap below the requested limit still needs pagination');
});

test('best-score events share one addressable key for a wallet and browser key', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => secret } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const run = { score: 100, round: '253', seed: 37749, distance: 1000, cheese: 1, perfects: 1 };
  const first = buildScoreEvent(signIn, run);
  const next = buildScoreEvent(signIn, { ...run, score: 200 });
  const key = `${BOARD_TAG}:${address.toLowerCase()}`;
  assert.deepEqual(first.tags.find(t => t[0] === 'd'), ['d', key]);
  assert.deepEqual(next.tags.find(t => t[0] === 'd'), ['d', key]);
});
