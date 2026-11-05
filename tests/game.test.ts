import test from 'node:test';
import assert from 'node:assert/strict';
import { Runner, trackSlot, speedForRpm, PLAYER_X, RUN_SECONDS, totalScore } from '../src/game.ts';
import { seedForRound } from '../src/wheel.ts';

function live(rpm = 60, round = '253') {
  const runner = new Runner();
  runner.configure('live', { rpm, round, seed: seedForRound(round), observedAt: null });
  runner.start();
  return runner;
}

test('the same round produces the same track independently of rendering and players', () => {
  for (let i = 0; i < 50; i++) assert.deepEqual(trackSlot(37749, i), trackSlot(seedForRound(253), i));
  assert.notDeepEqual(trackSlot(37749, 10), trackSlot(seedForRound(254), 10));
  const sixty = live(), thirty = live();
  for (let i = 0; i < 600; i++) sixty.step(1 / 60);
  for (let i = 0; i < 300; i++) thirty.step(1 / 30);
  assert.ok(Math.abs(sixty.state.course - thirty.state.course) < 0.001);
  assert.equal(sixty.state.score, thirty.state.score);
  assert.deepEqual(sixty.state.entities.map(e => e.id), thirty.state.entities.map(e => e.id));
});

test('speed and beat cadence follow real RPM and clamp effective tempo to 120', () => {
  const slow = live(30), fast = live(120), over = live(180);
  let slowBeats = 0, fastBeats = 0;
  slow.onEvent = e => { if (e.type === 'beat') slowBeats++; };
  fast.onEvent = e => { if (e.type === 'beat') fastBeats++; };
  slow.step(10.01); fast.step(10.01); over.step(10.01);
  assert.equal(slowBeats, 5); assert.equal(fastBeats, 20);
  assert.ok(fast.state.course > slow.state.course * 2);
  assert.ok(Math.abs(fast.state.course - over.state.course) < 0.001);
  assert.equal(over.state.rpm, 180);
  assert.equal(speedForRpm(2), 7);
});

test('jump and held/timed duck are real physics; pausing and resuming preserve a run', () => {
  const runner = live();
  assert.equal(runner.jump(), true);
  runner.step(0.2);
  assert.ok(runner.state.playerY > 70);
  assert.equal(runner.jump(), false);
  runner.step(0.7);
  assert.equal(runner.state.playerY, 0);
  runner.duck(true); runner.step(1);
  assert.equal(runner.state.duck, true);
  runner.releaseDuck(); runner.step(0.01);
  assert.equal(runner.state.duck, false);
  runner.duck(); runner.step(0.3); assert.equal(runner.state.duck, true);
  runner.step(0.6); assert.equal(runner.state.duck, false);
  runner.pause(); const elapsed = runner.state.elapsed;
  runner.step(5); assert.equal(runner.state.elapsed, elapsed);
  runner.start(); runner.step(0.1); assert.ok(runner.state.elapsed > elapsed);
});

test('NAP actually freezes obstacles and generates collectable Dream Cheese', () => {
  const runner = live(60);
  runner.step(2);
  const course = runner.state.course;
  const hazards = runner.state.entities.filter(e => e.kind === 'hurdle' || e.kind === 'arch').map(e => [e.id, e.x]);
  runner.configure('live', { rpm: 0, round: '253', seed: 37749, observedAt: null });
  runner.step(0.5);
  assert.equal(runner.state.phase, 'NAP');
  assert.equal(runner.state.course, course);
  assert.deepEqual(runner.state.entities.filter(e => e.kind === 'hurdle' || e.kind === 'arch').map(e => [e.id, e.x]), hazards);
  assert.ok(runner.state.entities.some(e => e.kind === 'dream'));
  runner.step(7);
  assert.ok(runner.state.cheese > 0);
  assert.equal(runner.state.perfects, 0);
  assert.equal(runner.state.beatFlash, false);
  runner.configure('live', { rpm: 60, round: '253', seed: 37749, observedAt: null });
  runner.step(0.1);
  assert.ok(runner.state.course > course);
  assert.ok(runner.state.entities.every(e => e.kind !== 'dream'));
});

test('a collected on-beat cheese gives a Perfect Squeek, bonus and combo +1', () => {
  const runner = live(60);
  runner.step(1.02);
  assert.equal(runner.state.beatFlash, true);
  runner.state.entities.push({ id: 'test-cheese', kind: 'cheese', x: runner.state.course + PLAYER_X + 15, y: 20, width: 24, height: 24, resolved: false });
  runner.step(0.01);
  assert.equal(runner.state.perfects, 1);
  assert.equal(runner.state.combo, 2);
  assert.equal(runner.state.cheesePoints, 100);
  assert.equal(runner.state.score, totalScore(runner.state));
});

test('ordinary cheese has no perfect bonus and a hurdle hit resets combo without ending early', () => {
  const runner = live(60);
  runner.state.entities = [{ id: 'ordinary', kind: 'cheese', x: PLAYER_X + 12, y: 20, width: 24, height: 24, resolved: false }];
  runner.step(0.01);
  assert.equal(runner.state.cheesePoints, 10);
  assert.equal(runner.state.perfects, 0);
  runner.state.combo = 4;
  runner.state.entities = [{ id: 'hit', kind: 'hurdle', x: runner.state.course + PLAYER_X + 12, y: 0, width: 42, height: 44, resolved: false }];
  runner.step(0.01);
  assert.equal(runner.state.combo, 1);
  assert.equal(runner.state.bumps, 1);
  assert.equal(runner.state.status, 'running');
});

test('jump clears a low obstacle and duck clears an overhead obstacle', () => {
  const jumper = live();
  jumper.jump(); jumper.step(0.3);
  jumper.state.entities = [{ id: 'low', kind: 'hurdle', x: jumper.state.course + PLAYER_X + 15, y: 0, width: 42, height: 44, resolved: false }];
  jumper.step(0.02); assert.equal(jumper.state.bumps, 0);
  const ducker = live();
  ducker.duck(true);
  ducker.state.entities = [{ id: 'high', kind: 'arch', x: PLAYER_X + 15, y: 34, width: 80, height: 76, resolved: false }];
  ducker.step(0.02); assert.equal(ducker.state.bumps, 0);
  ducker.releaseControls(); ducker.step(0.02); assert.equal(ducker.state.bumps, 1);
});

test('live and SIM each finish at exactly 90 active seconds, even after many collisions', () => {
  const real = live(120);
  const sim = new Runner(); sim.configure('sim', null); sim.start();
  for (const runner of [real, sim]) {
    let finishes = 0;
    runner.onEvent = e => { if (e.type === 'finish') finishes++; };
    runner.step(89.99); assert.equal(runner.state.status, 'running');
    runner.step(0.02);
    assert.equal(runner.state.status, 'finished');
    assert.equal(runner.state.elapsed, RUN_SECONDS);
    assert.equal(finishes, 1);
    assert.ok(runner.state.score > 0);
    runner.step(1); assert.equal(finishes, 1);
  }
});

test('round updates change the displayed seed and future slots without moving visible hazards', () => {
  const runner = live(); runner.step(2);
  const current = runner.state.entities.filter(e => e.x - runner.state.course < 1160);
  runner.configure('live', { rpm: 60, round: '254', seed: seedForRound(254), observedAt: null });
  assert.equal(runner.state.seed, seedForRound(254));
  assert.equal(runner.state.round, '254');
  assert.ok(current.every(e => runner.state.entities.includes(e)));
  runner.step(4);
  assert.ok(runner.state.entities.some(e => e.id.startsWith(`${seedForRound(254)}:`)));
});

test('unavailable live input never runs a disguised simulator; mixed runs count as practice', () => {
  const runner = new Runner();
  assert.equal(runner.start(), false);
  runner.step(5); assert.equal(runner.state.elapsed, 0);
  runner.configure('sim', null); runner.start(); runner.step(2);
  runner.configure('live', null); runner.step(5);
  assert.ok(Math.abs(runner.state.elapsed - 2) < 1e-8);
  assert.equal(runner.waitingForData, true);
  assert.equal(runner.state.mixedSources, true);
});
