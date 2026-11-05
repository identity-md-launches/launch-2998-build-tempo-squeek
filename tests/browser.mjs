import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { preview } from './preview.mjs';

const require = createRequire(process.env.TEMPO_TEST_TOOLCHAIN
  ? resolve(process.env.TEMPO_TEST_TOOLCHAIN, 'package.json') : new URL('../package.json', import.meta.url));
const { chromium, webkit } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const API = 'https://api.squeekchain.com/v1/status';
const shots = 'test/scratch/browser/shots';
await mkdir(shots, { recursive: true });
const server = await preview();
const browser = await chromium.launch({ headless: true });
const results = [];
const limitations = [];
const allErrors = [];
const seed = round => Number((BigInt(round) * 7919n + 4242n) % 90000n) + 10000;
const payload = (rpm = 60, round = '253') => ({
  measurement: { rpmMilli: rpm * 1000, freshness: 'online' },
  oracle: { latestClosure: { lastRound: round } },
  builder: { anchor: { settledThroughRound: '252' } },
});
let activePage;

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, passed: true, durationMs: Date.now() - started, detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error.stack ?? String(error);
    results.push({ name, passed: false, durationMs: Date.now() - started, detail });
    console.error(`FAIL ${name}: ${error.message}`);
    await activePage?.screenshot({ path: `${shots}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}

async function pageFor({ width = 390, height = 844, clock = false, route, touch = false, reducedMotion = 'no-preference', init } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion });
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', e => allErrors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(server.url) && r.status() >= 400) allErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  if (clock) {
    const epoch = new Date();
    await page.clock.install({ time: epoch });
    await page.clock.pauseAt(new Date(epoch.getTime() + 1000));
  }
  await page.addInitScript(() => {
    window.__pollTimes = [];
    const original = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]) === 'https://api.squeekchain.com/v1/status') window.__pollTimes.push(performance.now());
      return original(...args);
    };
  });
  if (init) await page.addInitScript(init);
  await page.route(API, route ?? (r => r.fulfill({ json: payload() })));
  await page.goto(server.url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(60);
  if (clock) await page.clock.runFor(32);
  return { page, close: () => context.close() };
}

const text = (page, id) => page.locator(`#${id}`).textContent();
async function advance(page, ms) {
  // Yield between 1-second chunks so mocked network responses can settle before their timeouts.
  while (ms > 0) {
    const delta = Math.min(ms, 1000);
    await page.clock.runFor(delta);
    await page.waitForTimeout(10);
    ms -= delta;
  }
  await page.waitForTimeout(25);
}

try {
  await check('Responsive first screen and complete relative assets at 320, 390, 768 and 1440', async () => {
    const measurements = [];
    for (const width of [320, 390, 768, 1440]) {
      const { page, close } = await pageFor({ width, height: width === 320 ? 700 : width === 1440 ? 900 : 844 });
      assert.equal(await text(page, 'source-label'), 'Live wheel');
      assert.equal(await text(page, 'seed'), '37749');
      const boxes = await page.evaluate(() => {
        const button = document.querySelector('#start-button').getBoundingClientRect();
        return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, startBottom: button.bottom, viewportHeight: innerHeight,
          controls: [...document.querySelectorAll('button')].filter(e => e.checkVisibility() && !e.disabled).map(e => ({ label: e.getAttribute('aria-label') ?? e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })) };
      });
      assert.ok(boxes.scrollWidth <= boxes.width);
      assert.ok(boxes.startBottom <= boxes.viewportHeight);
      assert.ok(boxes.controls.every(c => c.width >= 44 && c.height >= 44));
      const og = await page.locator('meta[property="og:image"]').getAttribute('content');
      assert.equal((await page.request.get(new URL(og, server.url).href)).status(), 200);
      assert.ok(await page.evaluate(() => document.fonts.check('700 24px "Space Grotesk"')));
      await page.screenshot({ path: `${shots}/ready-${width}.png`, fullPage: true });
      measurements.push({ width, ...boxes });
      await close();
    }
    return measurements;
  });

  await check('Desktop keyboard, pointer, pause, restart, sound and modal focus', async () => {
    const { page, close } = await pageFor({ width: 1440, height: 900 });
    try {
      await page.getByRole('button', { name: 'Start 90-second run' }).click();
      await page.keyboard.press('Space');
      await page.waitForTimeout(120);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'jump');
      await page.waitForTimeout(750);
      await page.keyboard.down('ArrowDown');
      await page.waitForTimeout(120);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'duck');
      await page.keyboard.up('ArrowDown');
      await page.waitForTimeout(850);
      await page.locator('#game-canvas').click({ position: { x: 400, y: 100 } });
      await page.waitForTimeout(70);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'jump');
      await page.keyboard.press('KeyP');
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'paused');
      const paused = await text(page, 'timer');
      await page.waitForTimeout(250);
      assert.equal(await text(page, 'timer'), paused);
      await page.getByRole('button', { name: 'Resume run', exact: true }).last().click();
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'running');
      await page.getByRole('button', { name: 'How to play' }).click();
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'paused');
      assert.ok(await page.locator('#help-dialog').isVisible());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'close-help');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help-done');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help-button');
      await page.getByRole('button', { name: 'Enable sound' }).click();
      assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Mute sound' }).click();
      assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'false');
      await page.getByRole('button', { name: 'Restart run', exact: true }).click();
      assert.equal(await text(page, 'timer'), '1:30');
      await page.getByRole('button', { name: 'Pause run', exact: true }).click();
      for (let i = 0; i < 6 && await page.evaluate(() => document.activeElement.id) !== 'start-button'; i++) await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'start-button');
      assert.equal(await page.locator('#start-button').evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
      await page.screenshot({ path: `${shots}/keyboard-focus-1440.png` });
      return 'Space, Down, canvas click, P, pause/resume/restart, audio toggle, native modal focus trap and Escape focus return passed.';
    } finally { await close(); }
  });

  await check('Mobile tap, swipe down, dedicated controls and cancellation', async () => {
    const { page, close } = await pageFor({ touch: true });
    try {
      await page.getByRole('button', { name: 'Start 90-second run' }).tap();
      await page.locator('#game-canvas').tap({ position: { x: 150, y: 170 } });
      await page.waitForTimeout(90);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'jump');
      await page.waitForTimeout(800);
      await page.locator('#game-canvas').evaluate(canvas => {
        const box = canvas.getBoundingClientRect();
        // Use the native touch protocol below so pointer capture is tested, too.
        window.__swipeBox = { x: box.left + 160, y: box.top + 100 };
      });
      const point = await page.evaluate(() => window.__swipeBox);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 65 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(80);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'duck');
      await page.waitForTimeout(850);
      await page.getByRole('button', { name: /^Jump/ }).tap();
      await page.waitForTimeout(80);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'jump');
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: /^Duck/ }).tap();
      await page.waitForTimeout(80);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'duck');
      await page.screenshot({ path: `${shots}/touch-run-390.png` });
      await cdp.detach();
      return 'Real Chromium touch input dispatched through CDP; canvas tap/swipe and both 64px control buttons work.';
    } finally { await close(); }
  });

  await check('Live polling, RPM clamp, RUN/NAP transition, round change and 90-second finish', async () => {
    let data = payload(30);
    const { page, close } = await pageFor({ width: 1440, height: 900, clock: true, route: r => r.fulfill({ json: data }) });
    try {
      await page.locator('#start-button').click();
      await advance(page, 2300);
      assert.equal(await text(page, 'rpm'), '30.0');
      data = payload(180, '254');
      await advance(page, 3000);
      assert.equal(await text(page, 'rpm'), '180.0');
      assert.ok((await text(page, 'beat-label')).includes('120 beats/min') || (await text(page, 'beat-label')).includes('On the beat'));
      assert.equal(await text(page, 'seed'), String(seed(254)));
      await page.screenshot({ path: `${shots}/live-run-1440.png` });
      data = payload(2, '254');
      await advance(page, 5100);
      assert.equal(await text(page, 'phase'), 'NAP');
      assert.match(await text(page, 'beat-label'), /Obstacles frozen/);
      await advance(page, 4000);
      await page.screenshot({ path: `${shots}/live-nap-1440.png` });
      data = payload(70, '254');
      await advance(page, 5200);
      assert.equal(await text(page, 'phase'), 'RUN');
      await advance(page, 71_000);
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'finished');
      assert.equal(await text(page, 'timer'), '0:00');
      assert.match(await text(page, 'overlay-copy'), /Live wheel run/);
      const polls = await page.evaluate(() => window.__pollTimes);
      assert.ok(polls.length >= 18);
      assert.ok(polls.slice(1).every((value, i) => Math.abs(value - polls[i] - 5000) < 1));
      assert.ok(Number((await text(page, 'best')).replaceAll(',', '')) > 0);
      await page.screenshot({ path: `${shots}/live-finished-1440.png` });
      return { polls: polls.length, intervalsMs: polls.slice(1, 5).map((value, i) => value - polls[i]), end: await text(page, 'overlay-copy') };
    } finally { await close(); }
  });

  await check('Three failed requests trigger labelled SIM; full offline run, replay and saved best', async () => {
    const { page, close } = await pageFor({ clock: true, route: r => r.abort() });
    try {
      assert.match(await text(page, 'connection-message'), /retry 1\/3/);
      assert.equal(await text(page, 'rpm'), '–');
      await advance(page, 5050);
      assert.match(await text(page, 'connection-message'), /retry 2\/3/);
      assert.equal(await page.locator('#live-button').getAttribute('aria-pressed'), 'true');
      await advance(page, 5050);
      await page.locator('#sim-button[aria-pressed="true"]').waitFor({ timeout: 5000 });
      assert.match(await text(page, 'connection-message'), /^SIM — simulated wheel, not live · 3 readings failed$/);
      assert.equal(await page.locator('#sim-button').getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `${shots}/fallback-390.png` });
      await page.locator('#start-button').click();
      await advance(page, 25_100);
      assert.equal(await text(page, 'phase'), 'NAP');
      await page.screenshot({ path: `${shots}/dream-cheese-390.png` });
      await advance(page, 65_100);
      assert.equal(await text(page, 'timer'), '0:00');
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'finished');
      assert.match(await text(page, 'overlay-copy'), /SIM practice run/);
      const best = await text(page, 'best');
      assert.ok(Number(best.replaceAll(',', '')) > 0);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tempo-squeek.best.v1')));
      assert.equal(saved.live, 0);
      assert.equal(saved.sim, Number(best.replaceAll(',', '')));
      await page.screenshot({ path: `${shots}/sim-finished-390.png` });
      await page.reload(); await page.waitForTimeout(60);
      await page.getByRole('button', { name: 'SIM', exact: true }).click();
      assert.equal(await text(page, 'best'), best);
      await page.locator('#start-button').click();
      assert.equal(await text(page, 'score'), '0');
      assert.equal(await text(page, 'timer'), '1:30');
      return { offlineBest: best, storage: saved, fallbackAfter: '3 failures, approximately 10 seconds for immediate errors' };
    } finally { await close(); }
  });

  await check('Manual LIVE/SIM reconnect holds time and Continue in SIM preserves progress', async () => {
    let fail = true;
    const { page, close } = await pageFor({ clock: true, route: r => fail ? r.abort() : r.fulfill({ json: payload(80, '256') }) });
    try {
      await page.getByRole('button', { name: 'SIM', exact: true }).click();
      await page.locator('#start-button').click();
      await advance(page, 2500);
      const time = await text(page, 'timer');
      const score = await text(page, 'score');
      await page.getByRole('button', { name: 'LIVE', exact: true }).click();
      await advance(page, 200);
      assert.equal(await text(page, 'timer'), time);
      // The HUD refreshes at 70ms intervals; reconnect flushes its last pending display update.
      const heldScore = await text(page, 'score');
      assert.ok(Number(heldScore.replaceAll(',', '')) >= Number(score.replaceAll(',', '')));
      await advance(page, 300);
      assert.equal(await text(page, 'score'), heldScore);
      assert.match(await text(page, 'overlay-copy'), /held while/);
      await page.getByRole('button', { name: 'Continue in SIM' }).click();
      assert.equal(await text(page, 'timer'), time);
      assert.equal(await text(page, 'score'), heldScore);
      fail = false;
      await page.getByRole('button', { name: 'LIVE', exact: true }).click();
      await advance(page, 100);
      assert.equal(await text(page, 'source-label'), 'Live wheel');
      assert.equal(await text(page, 'rpm'), '80.0');
      assert.equal(await text(page, 'seed'), String(seed(256)));
      assert.equal(await text(page, 'best-label'), 'SIM best');
      return 'Manual reconnect uses a fresh response, preserves the active run, and keeps mixed-source results in practice records.';
    } finally { await close(); }
  });

  await check('Storage-denied mode still finishes and explains its in-memory record', async () => {
    const { page, close } = await pageFor({ clock: true, init: () => {
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    } });
    try {
      assert.match(await text(page, 'storage-note'), /Storage unavailable/);
      await page.getByRole('button', { name: 'SIM', exact: true }).click();
      await page.locator('#start-button').click();
      await advance(page, 90_100);
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'finished');
      assert.match(await text(page, 'storage-note'), /best kept for this visit/);
      return 'Unavailable localStorage does not block gameplay, completion or replay.';
    } finally { await close(); }
  });

  await check('Reduced motion, 200% text enlargement and automated accessibility', async () => {
    const { page, close } = await pageFor({ reducedMotion: 'reduce' });
    try {
      const ready = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(ready.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
      assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && a.playState === 'running').length), 0);
      await page.getByRole('button', { name: 'How to play' }).click();
      const help = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(help.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const overlap = await page.evaluate(() => {
        const action = document.querySelector('#start-button').getBoundingClientRect();
        const track = document.querySelector('.track-bar').getBoundingClientRect();
        const scene = document.querySelector('#scene').getBoundingClientRect();
        const note = document.querySelector('#overlay-note').getBoundingClientRect();
        return { actionBottom: action.bottom, trackTop: track.top, noteBottom: note.bottom, artTop: scene.top + scene.height * .82 - 72 * (scene.width / 650) };
      });
      assert.ok(overlap.actionBottom < overlap.trackTop, JSON.stringify(overlap));
      assert.ok(overlap.noteBottom < overlap.artTop, JSON.stringify(overlap));
      await page.screenshot({ path: `${shots}/text-200-percent-390.png`, fullPage: true });
      return { axeReadyViolations: 0, axeHelpViolations: 0, textEnlargement: '200%, distinct from native browser zoom', overlap };
    } finally { await close(); }
  });

  await check('Captured current public API payload and CORS response', async () => {
    const script = `import urllib.request,json\nr=urllib.request.urlopen(urllib.request.Request('${API}',headers={'Origin':'https://example.org'}),timeout=20)\nprint(json.dumps({'status':r.status,'cors':r.headers.get('access-control-allow-origin'),'body':json.load(r)}))`;
    let fetched;
    try { fetched = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8', timeout: 25000 })); }
    catch (error) { limitations.push(`Public API transport capture unavailable: ${error.message.split('\n')[0]}`); return 'External API capture unavailable; deterministic schema tests above still ran.'; }
    assert.equal(fetched.status, 200);
    assert.ok(fetched.cors === '*' || fetched.cors === 'https://example.org');
    const { page, close } = await pageFor({ route: r => r.fulfill({ json: fetched.body }) });
    try {
      assert.equal(await text(page, 'source-label'), 'Live wheel');
      const latest = fetched.body.oracle?.latestClosure?.lastRound ?? fetched.body.builder.anchor.settledThroughRound;
      assert.equal(await text(page, 'seed'), String(seed(latest)));
      await page.locator('#start-button').click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${shots}/captured-api-390.png` });
      return { http: fetched.status, cors: fetched.cors, rpmMilli: fetched.body.measurement.rpmMilli, round: latest, seed: seed(latest), observedAt: fetched.body.measurement.observedAt,
        method: 'Public response captured with Python HTTP client then fulfilled unchanged at the browser API route. Direct browser outbound transport is separately limited.' };
    } finally { await close(); }
  });

  await check('Browser page and local-resource errors', async () => {
    assert.deepEqual(allErrors, []);
    return 'No uncaught page errors or failed local production assets in the checked flows. Deliberately blocked API requests are expected.';
  });

  // Attempt WebKit separately: the assignment environment may not provide its native libraries.
  try {
    const safari = await webkit.launch({ headless: true });
    try {
      const page = await safari.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(API, r => r.fulfill({ json: payload() }));
      await page.goto(server.url);
      await page.getByRole('button', { name: 'Start 90-second run' }).click();
      await page.keyboard.press('Space');
      await page.waitForTimeout(120);
      assert.equal(await page.locator('#game-canvas').getAttribute('data-action'), 'jump');
      await page.screenshot({ path: `${shots}/webkit-run-390.png` });
      results.push({ name: 'WebKit primary interaction', passed: true });
    } finally { await safari.close(); }
  } catch (error) { limitations.push(`WebKit not performed: ${error.message.split('\n').slice(0, 3).join(' ')}`); }
} finally {
  await browser.close(); await server.close();
  await writeFile('test/scratch/browser/results.json', JSON.stringify({ results, limitations, allErrors }, null, 2));
}
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, limitations }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
