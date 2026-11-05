import './styles.css';
import { Runner, RUN_SECONDS } from './game.ts';
import { Renderer } from './render.ts';
import { WheelConnection } from './wheel.ts';
import { GameAudio } from './audio.ts';
import { readBest, saveBest } from './storage.ts';
import { icon } from './icons.ts';
import type { WheelState } from './wheel.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

const ui = {
  source: element('source-label'), rpm: element('rpm'), phase: element('phase'),
  signal: element('signal-dot'), connection: element('connection-message'),
  live: element<HTMLButtonElement>('live-button'), sim: element<HTMLButtonElement>('sim-button'),
  score: element('score'), cheese: element('cheese-count'), combo: element('combo'), timer: element('timer'),
  best: element('best'), bestLabel: element('best-label'), storage: element('storage-note'),
  round: element('round'), roundLabel: element('round-label'), seed: element('seed'),
  scene: element('scene'), canvas: element<HTMLCanvasElement>('game-canvas'),
  overlay: element('game-overlay'), title: element('overlay-title'), copy: element('overlay-copy'),
  note: element('overlay-note'), result: element('result-stats'),
  start: element<HTMLButtonElement>('start-button'), startLabel: element('start-label'),
  pause: element<HTMLButtonElement>('pause-button'), restart: element<HTMLButtonElement>('restart-button'),
  jump: element<HTMLButtonElement>('jump-button'), duck: element<HTMLButtonElement>('duck-button'),
  message: element('game-message'), beatLight: element('beat-light'), beatLabel: element('beat-label'),
  help: element<HTMLButtonElement>('help-button'), dialog: element<HTMLDialogElement>('help-dialog'),
  sound: element<HTMLButtonElement>('sound-button'), announcer: element('announcer'),
};

ui.sound.innerHTML = icon('mute');
ui.pause.innerHTML = icon('pause');
ui.restart.innerHTML = icon('restart');
element('jump-icon').innerHTML = icon('up');
element('duck-icon').innerHTML = icon('down');
element('start-icon').innerHTML = icon('arrow');
element('best-icon').innerHTML = icon('trophy');
element('close-help').innerHTML = icon('close');
ui.help.setAttribute('aria-label', 'How to play');
ui.scene.tabIndex = -1;

const runner = new Runner();
const renderer = new Renderer(ui.canvas);
const connection = new WheelConnection();
const audio = new GameAudio();
const stored = readBest();
const bestScores = stored.scores;
let storageAvailable = stored.available;
let feed: WheelState = connection.state;
let lastFrame = performance.now();
let lastHud = 0;
let lastStatus = '';
let newRecord = false;
let lastAnnouncement = '';
const format = (value: number) => Math.floor(value).toLocaleString('en-US');
const setText = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

function announce(message: string): void {
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  ui.announcer.textContent = message;
}

function storageNote(): void {
  setText(ui.storage, storageAvailable
    ? 'Free to play · Best saved on this device'
    : 'Free to play · Storage unavailable; best kept for this visit');
}

function renderFeed(): void {
  const sim = feed.mode === 'sim';
  ui.live.setAttribute('aria-pressed', String(!sim));
  ui.sim.setAttribute('aria-pressed', String(sim));
  ui.signal.dataset.source = sim ? 'sim' : feed.status === 'live' ? 'live' : 'waiting';
  ui.connection.dataset.sim = String(sim);
  setText(ui.source, sim ? 'Simulated wheel' : feed.status === 'live' ? 'Live wheel' : feed.sample ? 'Last reading' : 'Connecting');
  let message = '';
  if (sim) message = `SIM — simulated wheel, not live${feed.automatic ? ' · 3 readings failed' : ''}`;
  else if (feed.status === 'retrying') message = `Wheel unavailable · retry ${feed.failures}/3. SIM is ready to play.`;
  else if (feed.status === 'connecting') message = 'Connecting to Squeektoshi’s wheel…';
  else message = runner.state.phase === 'NAP' ? 'The wheel is resting. Dream Cheese is out.' : 'Squeektoshi’s real wheel is setting the pace.';
  setText(ui.connection, message);
  renderHud();
  renderOverlay();
  renderer.draw(runner.state);
}

function renderHud(): void {
  const s = runner.state;
  const available = feed.mode === 'sim' || feed.sample !== null;
  setText(ui.rpm, available ? s.rpm.toFixed(1) : '–');
  setText(ui.phase, available ? s.phase : 'Waiting');
  ui.phase.dataset.phase = available ? s.phase : '';
  setText(ui.score, format(s.score));
  ui.score.style.fontSize = s.score >= 10000 ? 'var(--text-body)' : '';
  setText(ui.cheese, String(s.cheese));
  setText(ui.combo, `×${s.combo}`);
  const seconds = Math.max(0, Math.ceil(RUN_SECONDS - s.elapsed));
  setText(ui.timer, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  const recordMode = s.mixedSources ? 'sim' : feed.mode;
  setText(ui.best, format(bestScores[recordMode]));
  setText(ui.bestLabel, recordMode === 'sim' ? 'SIM best' : 'Live best');
  if (feed.mode === 'sim') {
    ui.roundLabel.innerHTML = 'Practice track <strong>SIM</strong>';
  } else {
    // The round is validated as digits before it can reach the DOM.
    ui.roundLabel.innerHTML = `SqueekCore round <strong>${feed.sample?.round ?? '–'}</strong>`;
  }
  setText(ui.seed, available ? String(s.seed) : '–');
  setText(ui.message, s.status === 'running' && s.messageTime > 0 ? s.message : '');
  ui.beatLight.dataset.beat = String(s.status === 'running' && s.beatFlash);
  setText(ui.beatLabel, s.status === 'running'
    ? s.phase === 'NAP' ? 'NAP · Obstacles frozen · Catch Dream Cheese' : s.beatFlash ? 'On the beat · Perfect window' : `${Math.min(120, s.rpm).toFixed(0)} beats/min · Catch the flash`
    : 'The wheel sets the pace');
  const playing = s.status === 'running' && !runner.waitingForData;
  ui.jump.disabled = !playing;
  ui.duck.disabled = !playing;
  ui.duck.dataset.active = String(s.duck);
  ui.jump.dataset.active = String(s.playerY > 0.5);
}

function renderOverlay(): void {
  const s = runner.state;
  const waiting = s.status === 'running' && runner.waitingForData;
  const key = `${s.status}:${waiting}:${runner.waitingForData}`;
  ui.scene.dataset.state = waiting ? 'paused' : s.status;
  ui.overlay.hidden = s.status === 'running' && !waiting;
  ui.pause.disabled = s.status === 'ready' || s.status === 'finished';
  ui.restart.disabled = s.status === 'ready' || runner.waitingForData;
  ui.pause.innerHTML = icon(s.status === 'paused' ? 'play' : 'pause');
  ui.pause.setAttribute('aria-label', s.status === 'paused' ? 'Resume run' : 'Pause run');
  ui.pause.title = s.status === 'paused' ? 'Resume run (P)' : 'Pause run (P)';
  document.querySelector<HTMLElement>('.scoreboard')!.dataset.active = String(s.status !== 'ready');
  if (key === lastStatus) return;
  lastStatus = key;
  ui.result.hidden = s.status !== 'finished';
  ui.start.disabled = runner.waitingForData && !waiting;
  if (waiting) {
    setText(ui.title, 'Finding the wheel');
    setText(ui.copy, 'Your run is held while the live wheel reconnects.');
    setText(ui.startLabel, 'Continue in SIM');
    setText(ui.note, 'Or wait for a fresh live reading.');
  } else if (s.status === 'ready') {
    ui.title.innerHTML = 'Sync or <span>Sleep.</span>';
    ui.copy.innerHTML = 'A rhythm runner powered by<br class="desktop-break" /> Squeektoshi’s real wheel.';
    setText(ui.startLabel, runner.waitingForData ? 'Connecting to wheel…' : 'Start 90-second run');
    setText(ui.note, '90 seconds. Find your rhythm.');
  } else if (s.status === 'paused') {
    setText(ui.title, 'Take a breather.');
    setText(ui.copy, 'Your run is paused. Pick up where you left off.');
    setText(ui.startLabel, runner.waitingForData ? 'Waiting for wheel…' : 'Resume run');
    setText(ui.note, 'The live wheel keeps turning while you pause.');
  } else if (s.status === 'finished') {
    setText(ui.title, newRecord ? 'A new personal best.' : 'Run complete.');
    setText(ui.copy, `${format(s.score)} points. ${s.mixedSources || s.mode === 'sim' ? 'SIM practice' : 'Live wheel'} run.`);
    ui.result.innerHTML = `<span><strong>${format(s.distance)}m</strong>Distance</span><span><strong>${s.cheese}</strong>Cheese</span><span><strong>${s.perfects}</strong>Perfects</span>`;
    setText(ui.startLabel, 'Play again');
    setText(ui.note, `Best combo ×${s.bestCombo} · ${s.bumps} ${s.bumps === 1 ? 'bump' : 'bumps'}`);
  }
}

function startRun(restart = false): void {
  if (runner.state.status === 'running' && runner.waitingForData && !restart) {
    connection.setMode('sim');
    lastFrame = performance.now();
    ui.scene.focus({ preventScroll: true });
    announce('Run continued in SIM practice.');
    return;
  }
  if (restart) runner.state.status = 'ready';
  if (!runner.start()) return;
  newRecord = false;
  lastFrame = performance.now();
  lastStatus = '';
  renderOverlay();
  renderHud();
  ui.scene.focus({ preventScroll: true });
  announce('Run started. Jump hurdles, duck under branches, and catch cheese on the beat.');
}

function pauseRun(): void {
  runner.pause();
  renderOverlay();
  renderHud();
  renderer.draw(runner.state);
  announce('Run paused. Select Resume run to continue.');
}

function togglePause(): void {
  if (runner.state.status === 'running') pauseRun();
  else if (runner.state.status === 'paused') startRun();
}

runner.onEvent = event => {
  audio.play(event.type);
  if (event.type === 'finish') {
    const s = runner.state;
    const mode = s.mixedSources ? 'sim' : s.mode;
    newRecord = s.score > bestScores[mode];
    if (newRecord) {
      bestScores[mode] = s.score;
      storageAvailable = saveBest(bestScores);
      storageNote();
    }
    lastStatus = '';
    renderOverlay();
    renderHud();
    ui.start.focus({ preventScroll: true });
    announce(`Run complete. ${s.score} points, ${s.cheese} cheese, ${s.perfects} Perfect Squeeks.`);
  } else if (event.type !== 'beat' && event.type !== 'cheese') announce(runner.state.message);
};

connection.subscribe(state => {
  feed = state;
  runner.configure(state.mode, state.sample);
  renderFeed();
});

ui.start.addEventListener('click', () => startRun());
ui.pause.addEventListener('click', togglePause);
ui.restart.addEventListener('click', () => startRun(true));
ui.live.addEventListener('click', () => connection.setMode('live'));
ui.sim.addEventListener('click', () => connection.setMode('sim'));
ui.jump.addEventListener('click', () => runner.jump());
ui.duck.addEventListener('click', () => runner.duck());

// Pointer capture avoids stuck controls if a finger ends outside its button.
for (const [button, action] of [[ui.jump, 'jump'], [ui.duck, 'duck']] as const) {
  button.addEventListener('pointerdown', e => {
    if (button.disabled || e.button !== 0) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    if (action === 'jump') runner.jump(); else runner.duck(true);
  });
  button.addEventListener('pointerup', () => { if (action === 'duck') runner.releaseDuck(); });
  button.addEventListener('pointercancel', () => runner.releaseControls());
  button.addEventListener('lostpointercapture', () => { if (action === 'duck') runner.releaseDuck(); });
}

let gesture: { x: number; y: number; id: number; ducked: boolean } | null = null;
ui.canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || runner.state.status !== 'running') return;
  e.preventDefault();
  ui.canvas.setPointerCapture(e.pointerId);
  gesture = { x: e.clientX, y: e.clientY, id: e.pointerId, ducked: false };
  // A mouse click can jump immediately. Touch waits for release to distinguish a downward swipe.
  if (e.pointerType === 'mouse') runner.jump();
});
ui.canvas.addEventListener('pointermove', e => {
  if (!gesture || gesture.id !== e.pointerId || gesture.ducked) return;
  if (e.clientY - gesture.y > 28 && e.clientY - gesture.y > Math.abs(e.clientX - gesture.x)) {
    gesture.ducked = true;
    runner.duck();
  }
});
ui.canvas.addEventListener('pointerup', e => {
  if (gesture?.id === e.pointerId && !gesture.ducked && e.pointerType !== 'mouse') runner.jump();
  gesture = null;
});
ui.canvas.addEventListener('pointercancel', () => { gesture = null; runner.releaseControls(); });

document.addEventListener('keydown', e => {
  if (ui.dialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (e.code === 'Space' && !(e.target instanceof HTMLElement && e.target.closest('button, a'))) {
    e.preventDefault();
    if (e.repeat) return;
    if (runner.state.status === 'running') runner.jump();
    else if (runner.state.status === 'ready' || runner.state.status === 'paused') startRun();
  } else if (e.code === 'ArrowDown' && runner.state.status === 'running') {
    e.preventDefault();
    if (!e.repeat) runner.duck(true);
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.repeat) return;
    e.preventDefault(); togglePause();
  }
});
document.addEventListener('keyup', e => { if (e.code === 'ArrowDown') runner.releaseDuck(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && runner.state.status === 'running') pauseRun();
  if (document.hidden) runner.releaseControls();
});

ui.help.addEventListener('click', () => {
  if (runner.state.status === 'running') pauseRun();
  ui.dialog.showModal();
  element<HTMLButtonElement>('close-help').focus();
});
const closeHelp = () => ui.dialog.close();
element('close-help').addEventListener('click', closeHelp);
element('help-done').addEventListener('click', closeHelp);
ui.dialog.addEventListener('click', e => {
  if (e.target !== ui.dialog) return;
  const box = ui.dialog.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) closeHelp();
});
ui.dialog.addEventListener('close', () => ui.help.focus());
ui.dialog.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const controls = [...ui.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')]
    .filter(control => control.checkVisibility());
  const first = controls[0], last = controls.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
});
ui.sound.addEventListener('click', async () => {
  const enabled = await audio.toggle();
  ui.sound.setAttribute('aria-pressed', String(enabled));
  ui.sound.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
  ui.sound.title = enabled ? 'Mute sound' : 'Enable sound';
  ui.sound.innerHTML = icon(enabled ? 'sound' : 'mute');
  announce(enabled ? 'Sound on.' : 'Sound off.');
});

new ResizeObserver(() => { renderer.resize(); renderer.draw(runner.state); }).observe(ui.scene);
function frame(now: number): void {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (runner.state.status === 'running') {
    // A long main-thread stall should never cost the player an unseen obstacle.
    if (dt > 0.5) pauseRun();
    else {
      runner.step(dt);
      renderer.draw(runner.state);
      if (now - lastHud > 70) { renderHud(); lastHud = now; }
    }
  }
  requestAnimationFrame(frame);
}
storageNote();
renderer.draw(runner.state);
connection.start();
requestAnimationFrame(frame);
addEventListener('pagehide', () => connection.stop());
addEventListener('pageshow', e => { if (e.persisted) connection.start(); });
