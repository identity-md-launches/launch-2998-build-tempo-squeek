import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, sha256, toHex, utf8 } from '../src/chain/hash.ts';
import { checksumAddress, recoverPersonalSigner, schnorrPublicKey, schnorrSign, schnorrVerify } from '../src/chain/secp256k1.ts';
import { CHECKPOINT_SELECTOR, checkReadiness, decodeCheckpointStatus, decodeMiningState, describeRevert, selector } from '../src/chain/mining.ts';
import { SQUEEK_CORE, SQUEEK_MINING } from '../src/chain/config.ts';
import { aggregateBoard, buildSignInMessage, parseScoreEvent, eventId, type NostrEvent } from '../src/chain/leaderboard.ts';

test('keccak256 and sha256 match published vectors', () => {
  assert.equal(toHex(keccak256(new Uint8Array())), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(toHex(keccak256(utf8('abc'))), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(toHex(keccak256(new Uint8Array(200).fill(7))).length, 64);
  assert.equal(toHex(sha256(utf8('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('function selectors match cast sig output', () => {
  assert.equal(selector('checkpoint()'), '0xc2c4c5c1');
  assert.equal(CHECKPOINT_SELECTOR, '0xc2c4c5c1');
  assert.equal(selector('checkpointStatus()'), '0x001c856f');
  assert.equal(selector('state()'), '0xc19d93fb');
});

test('personal_sign recovery matches a signature produced by cast wallet sign', () => {
  // Public documentation key used only as a fixed test vector.
  const message = 'Tempo Squeek sign-in\nLine two';
  const signature = '0x620b4493c0ee70468263867c9424f6a52e9b9be4a0a4493d607cebbd605ada2b70d75fa5ffd77e95b184f7ca40d283d5ca9aba1887d92dc7766d5eaa03fae0df1b';
  assert.equal(recoverPersonalSigner(message, signature), '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
  assert.notEqual(recoverPersonalSigner(`${message}!`, signature), '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
  assert.equal(recoverPersonalSigner(message, '0x1234'), null);
  assert.equal(checksumAddress('0x2c7536e3605d9c16a7a3d7b1898e529396a65c23'), '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
});

test('BIP340 Schnorr matches the official vectors', () => {
  const zero = '0'.repeat(64);
  assert.equal(schnorrPublicKey('0'.repeat(63) + '3').toUpperCase(), 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9');
  assert.equal(schnorrSign(zero, '0'.repeat(63) + '3', zero).toUpperCase(),
    'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0');
  const sk = 'B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF';
  const msg = '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89';
  const sig = schnorrSign(msg, sk, '0'.repeat(63) + '1');
  assert.equal(sig.toUpperCase(), '6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A');
  assert.ok(schnorrVerify(msg, schnorrPublicKey(sk), sig));
  assert.ok(!schnorrVerify(msg.replace('2', '3'), schnorrPublicKey(sk), sig));
});

test('mining reads decode and reverts read in plain English', () => {
  const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
  const status = decodeCheckpointStatus(`0x${word(0)}${word(1188)}${word(1)}`);
  assert.deepEqual(status, { corePaused: false, nextRound: 1188n, roundSettled: true });
  const state = decodeMiningState(`0x${word(5)}${word(1187)}${word(17)}${word(0)}${word(6493)}${word(0)}${word(1)}${word(1)}${word(0)}${word(1)}`);
  assert.equal(state.processedThroughRound, 1187n);
  assert.equal(state.startRound, 17n);
  assert.equal(state.paused, false);
  assert.match(describeRevert('0x4cb3183d'), /paused/i);
  assert.match(describeRevert({ code: 4001 }), /rejected/i);
});

test('checkpoint readiness reads the deployed Core.state() ABI before simulating checkpoint()', async t => {
  const word = (n: number) => BigInt(n).toString(16).padStart(64, '0');
  const encode = (ns: number[]) => `0x${ns.map(word).join('')}`;
  const calls: { to: string; data: string; from?: string }[] = [];
  let settledThrough = 1190;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const call = body.params[0];
    calls.push(call);
    let result: string;
    if (call.to === SQUEEK_CORE && call.data === '0xc19d93fb') result = encode([settledThrough, 59890, 6493456710641, 6493, 456710641, 9912, 1003, 0]);
    else if (call.to === SQUEEK_MINING && call.data === '0xc19d93fb') result = encode([5, 1187, 17, 0, 6493, 0, 1, 1, 0, 1]);
    else if (call.to === SQUEEK_MINING && call.data === '0x001c856f') result = encode([0, 1188, 1]);
    else if (call.to === SQUEEK_MINING && call.data === '0xc2c4c5c1') result = '0x';
    else return Response.json({ error: { code: 3, message: 'execution reverted', data: '0x' } });
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  });
  const from = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';
  const ready = await checkReadiness('1188', from);
  assert.equal(ready.ok, true);
  if (ready.ok) assert.equal(ready.settledThrough, 1190n);
  assert.ok(calls.some(c => c.to === SQUEEK_MINING && c.data === '0xc2c4c5c1' && c.from === from));
  calls.length = 0;
  settledThrough = 1187;
  const waiting = await checkReadiness('1188', from);
  assert.equal(waiting.ok, false);
  if (!waiting.ok) assert.match(waiting.reason, /has not settled/);
  assert.equal(calls.some(c => c.data === '0xc2c4c5c1'), false, 'unsettled runs must not be simulated or sent');
});

test('score events need a valid wallet sign-in bound to the publishing key', () => {
  const walletKey = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
  assert.ok(walletKey); // signature below was produced from this documentation key with cast
  const message = 'Tempo Squeek sign-in\nLine two';
  const event: NostrEvent = {
    id: '', pubkey: schnorrPublicKey('11'.repeat(32)), created_at: 1794447636, kind: 30078,
    tags: [['d', 'x'], ['t', 'tempo-squeek-board-v1']],
    content: JSON.stringify({ v: 1, address: '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23', score: 1234, round: '1187', seed: 1, playedAt: 1794447636000,
      signIn: { message, signature: '0x620b4493c0ee70468263867c9424f6a52e9b9be4a0a4493d607cebbd605ada2b70d75fa5ffd77e95b184f7ca40d283d5ca9aba1887d92dc7766d5eaa03fae0df1b' } }),
    sig: '',
  };
  // The fixed message does not name this event's key, so it must be refused.
  event.id = eventId(event);
  event.sig = schnorrSign(event.id, '11'.repeat(32), '00'.repeat(32));
  assert.equal(parseScoreEvent(event), null);
  const built = buildSignInMessage('0x2c7536E3605D9C16a7a3D7b1898e529396a65c23', event.pubkey, '2026-11-12T00:00:00.000Z');
  assert.match(built, /free/i);
  assert.match(built, new RegExp(event.pubkey));
  const board = aggregateBoard([
    { address: '0xA', score: 10, round: '1', playedAt: 1, id: 'a' },
    { address: '0xA', score: 30, round: '2', playedAt: 2, id: 'b' },
    { address: '0xB', score: 20, round: '3', playedAt: 3, id: 'c' },
  ]);
  assert.deepEqual(board.map(r => [r.address, r.score, r.round]), [['0xA', 30, '2'], ['0xB', 20, '3']]);
});
