import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, seedForRound, effectiveRpm, phaseForRpm, simulatorRpm, WheelConnection, POLL_MS } from '../src/wheel.ts';

const status = (rpmMilli = 60000, round: string | number = '253') => ({
  measurement: { rpmMilli, freshness: 'online' },
  oracle: { latestClosure: { lastRound: round } },
  builder: { anchor: { settledThroughRound: '252' } },
});

test('the real status schema converts milli-RPM and uses the latest reported round', () => {
  assert.deepEqual(parseStatus(status(12345)), { rpm: 12.345, round: '253', seed: 37749, observedAt: null });
  const data = status();
  data.builder.anchor.settledThroughRound = '255';
  assert.equal(parseStatus(data).round, '255');
  assert.equal(parseStatus({ measurement: { rpmMilli: 0 }, builder: { anchor: { settledThroughRound: '0' } } }).seed, 14242);
});

test('track seeds retain precision for rounds larger than a JavaScript safe integer', () => {
  const round = '9007199254740993123456789';
  assert.equal(seedForRound(round), Number((BigInt(round) * 7919n + 4242n) % 90000n) + 10000);
  assert.equal(seedForRound('253'), 37749);
  assert.equal(seedForRound('000253'), 37749);
});

test('missing, malformed and stale live readings fail instead of inventing a live zero', () => {
  for (const bad of [{}, { measurement: {} }, status(NaN), status(-1), status(Infinity), status(10, 'fake'), status(10, 9007199254740992)]) {
    // Remove the valid settled fallback for malformed round tests.
    if ('builder' in bad) delete (bad as Record<string, unknown>).builder;
    assert.throws(() => parseStatus(bad));
  }
  assert.throws(() => parseStatus({ ...status(), measurement: { rpmMilli: 1, freshness: 'stale' } }));
  assert.throws(() => parseStatus({ ...status(), measurement: { rpmMilli: 1, observedAt: '2026-01-01T00:00:00Z', staleAfterSeconds: 120 } }, Date.parse('2026-01-01T00:03:00Z')));
  assert.throws(() => parseStatus({ ...status(), measurement: { rpmMilli: 1, observedAt: 'not-a-date' } }));
});

test('the exact phase boundary is 2 RPM and only effective tempo is capped', () => {
  assert.equal(phaseForRpm(0), 'NAP');
  assert.equal(phaseForRpm(2), 'NAP');
  assert.equal(phaseForRpm(2.001), 'RUN');
  assert.equal(effectiveRpm(189), 120);
  assert.equal(parseStatus(status(189000)).rpm, 189);
});

test('SIM has RUN and NAP and a reproducible 36-second cycle', () => {
  assert.equal(phaseForRpm(simulatorRpm(0)), 'RUN');
  assert.equal(phaseForRpm(simulatorRpm(25)), 'NAP');
  assert.equal(phaseForRpm(simulatorRpm(34)), 'RUN');
  assert.equal(simulatorRpm(5), simulatorRpm(41));
});

test('three consecutive failures switch to explicitly simulated data; a success resets failures', async t => {
  let shouldFail = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (shouldFail) throw new Error('offline');
    return new Response(JSON.stringify(status()), { status: 200 });
  });
  const connection = new WheelConnection();
  await connection.poll();
  await connection.poll();
  assert.equal(connection.state.mode, 'live');
  assert.equal(connection.state.failures, 2);
  shouldFail = false;
  await connection.poll();
  assert.equal(connection.state.failures, 0);
  assert.equal(connection.state.status, 'live');
  shouldFail = true;
  await connection.poll(); await connection.poll(); await connection.poll();
  assert.equal(connection.state.mode, 'sim');
  assert.equal(connection.state.automatic, true);
  assert.equal(connection.state.failures, 3);
  assert.equal(POLL_MS, 5000);
  connection.stop();
});

test('an in-flight live response cannot override a manual SIM selection', async t => {
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { respond = resolve; }));
  const connection = new WheelConnection();
  const request = connection.poll();
  connection.setMode('sim');
  respond(new Response(JSON.stringify(status())));
  await request;
  assert.equal(connection.state.mode, 'sim');
  assert.equal(connection.state.sample, null);
  assert.equal(connection.state.automatic, false);
  connection.stop();
});

test('HTTP errors and malformed JSON count toward the same automatic fallback', async t => {
  const replies = [new Response('', { status: 503 }), new Response('not json'), new Response('{}')];
  t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
  const connection = new WheelConnection();
  await connection.poll(); await connection.poll(); await connection.poll();
  assert.equal(connection.state.status, 'sim');
  connection.stop();
});
