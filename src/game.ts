import { effectiveRpm, phaseForRpm, SIM_SEED, simulatorRpm } from './wheel.ts';
import type { Mode, Phase, WheelSample } from './wheel.ts';

export const RUN_SECONDS = 90;
export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 400;
export const GROUND = 316;
export const PLAYER_X = 160;
export const PLAYER_WIDTH = 46;
export const PERFECT_WINDOW_SECONDS = 0.12;
const GRAVITY = 1650;
const JUMP_VELOCITY = 660;
const SLOT_GAP = 440;

export type RunStatus = 'ready' | 'running' | 'paused' | 'finished';
export type EntityKind = 'hurdle' | 'arch' | 'cheese' | 'dream';

export interface Entity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  width: number;
  height: number;
  resolved: boolean;
}

export interface GameEvent {
  type: 'beat' | 'perfect' | 'cheese' | 'dream' | 'hit' | 'phase' | 'finish';
  points?: number;
}

export interface GameState {
  status: RunStatus;
  elapsed: number;
  distance: number;
  distancePoints: number;
  cheesePoints: number;
  score: number;
  cheese: number;
  perfects: number;
  combo: number;
  bestCombo: number;
  bumps: number;
  rpm: number;
  phase: Phase;
  beat: number;
  beatAge: number;
  beatFlash: boolean;
  wheelAngle: number;
  playerY: number;
  velocityY: number;
  duck: boolean;
  invulnerable: number;
  course: number;
  scenery: number;
  seed: number;
  round: string | null;
  mode: Mode;
  mixedSources: boolean;
  entities: Entity[];
  message: string;
  messageTime: number;
}

export function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each slot is a pure function of seed + index, independent of viewport and frame rate. */
export function trackSlot(seed: number, index: number): Entity[] {
  const rng = random((seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0);
  const x = 780 + index * SLOT_GAP + Math.floor(rng() * 68);
  const kind = index === 0 ? 'hurdle' : rng() < 0.53 ? 'hurdle' : 'arch';
  const airborne = kind === 'hurdle';
  const result: Entity[] = [{
    id: `${seed}:${index}:obstacle`, kind, x, y: airborne ? 0 : 34,
    width: airborne ? 42 : 80, height: airborne ? 44 : 76, resolved: false,
  }];
  // The cheese leads the obstacle and traces the action required to clear it.
  result.push({
    id: `${seed}:${index}:cheese`, kind: 'cheese', x: x - 80,
    y: airborne ? 108 : 16, width: 24, height: 24, resolved: false,
  });
  if (rng() > 0.35) result.push({
    id: `${seed}:${index}:bonus`, kind: 'cheese', x: x + 138,
    y: airborne ? 92 : 22, width: 24, height: 24, resolved: false,
  });
  return result;
}

export function speedForRpm(rpm: number): number {
  return phaseForRpm(rpm) === 'NAP' ? 7 : 100 + effectiveRpm(rpm) * 3.1;
}

export function totalScore(state: Pick<GameState, 'distancePoints' | 'cheesePoints'>): number {
  return Math.floor(state.distancePoints + state.cheesePoints);
}

export class Runner {
  state: GameState;
  onEvent: (event: GameEvent) => void = () => {};
  private nextSlot = 0;
  private dreamTimer = 0;
  private dreamIndex = 0;
  private duckHeld = false;
  private duckUntil = 0;
  private sample: WheelSample | null = null;
  private suspendedForData = true;

  constructor() {
    this.state = this.initial();
  }

  private initial(): GameState {
    return {
      status: 'ready', elapsed: 0, distance: 0, distancePoints: 0,
      cheesePoints: 0, score: 0, cheese: 0, perfects: 0, combo: 1,
      bestCombo: 1, bumps: 0, rpm: 0, phase: 'NAP', beat: 0, beatAge: Infinity,
      beatFlash: false, wheelAngle: 0, playerY: 0, velocityY: 0,
      duck: false, invulnerable: 0, course: 0, scenery: 0,
      seed: SIM_SEED, round: null, mode: 'live', mixedSources: false,
      entities: [], message: '', messageTime: 0,
    };
  }

  configure(mode: Mode, sample: WheelSample | null): void {
    const s = this.state;
    if (s.mode !== mode && s.elapsed > 0) s.mixedSources = true;
    s.mode = mode;
    this.sample = sample;
    this.suspendedForData = mode === 'live' && sample === null;
    const seed = mode === 'sim' ? SIM_SEED : sample?.seed ?? s.seed;
    s.round = mode === 'live' ? sample?.round ?? null : null;
    if (s.seed !== seed) {
      s.seed = seed;
      // Keep visible obstacles stable when a round changes. Generate future slots with the new seed.
      s.entities = s.entities.filter(e => e.x - s.course < WORLD_WIDTH + 160 || e.kind === 'dream');
      this.nextSlot = Math.max(0, Math.ceil((s.course + WORLD_WIDTH + 160 - 780) / SLOT_GAP));
      if (s.elapsed === 0) { s.entities = []; this.nextSlot = 0; }
    }
    this.updateWheel(0);
  }

  get waitingForData(): boolean { return this.suspendedForData; }

  start(): boolean {
    if (this.suspendedForData) return false;
    if (this.state.status === 'paused') { this.state.status = 'running'; return true; }
    const { mode, seed, round } = this.state;
    this.state = { ...this.initial(), mode, seed, round, status: 'running' };
    this.nextSlot = 0;
    this.dreamTimer = 0;
    this.dreamIndex = 0;
    this.releaseControls();
    this.updateWheel(0);
    this.generate();
    return true;
  }

  pause(): void {
    if (this.state.status === 'running') this.state.status = 'paused';
    this.releaseControls();
  }

  jump(): boolean {
    const s = this.state;
    if (s.status !== 'running' || this.suspendedForData || s.playerY > 0.5) return false;
    s.duck = false;
    this.duckHeld = false;
    this.duckUntil = 0;
    s.velocityY = JUMP_VELOCITY;
    s.playerY = 0.01;
    return true;
  }

  duck(held = false): void {
    if (this.state.status !== 'running') return;
    this.duckHeld = held;
    this.duckUntil = this.state.elapsed + 0.8;
    this.state.duck = this.state.playerY <= 0.5;
    // Down while airborne lands sooner, giving the runner an intentional fast drop.
    if (this.state.playerY > 0.5) this.state.velocityY = Math.min(-450, this.state.velocityY);
  }

  releaseDuck(): void { this.duckHeld = false; }

  releaseControls(): void {
    this.duckHeld = false;
    this.duckUntil = 0;
    this.state.duck = false;
  }

  step(seconds: number): void {
    if (this.state.status !== 'running' || this.suspendedForData || seconds <= 0 || !Number.isFinite(seconds)) return;
    let remaining = Math.min(seconds, RUN_SECONDS - this.state.elapsed);
    // Substeps prevent tunnelling at 120 RPM and make physics independent of rendering FPS.
    while (remaining > 1e-8) {
      const dt = Math.min(1 / 120, remaining);
      this.tick(dt);
      remaining -= dt;
    }
    if (this.state.elapsed >= RUN_SECONDS - 1e-7) {
      this.state.elapsed = RUN_SECONDS;
      this.state.status = 'finished';
      this.releaseControls();
      this.onEvent({ type: 'finish' });
    }
  }

  private updateWheel(dt: number): void {
    const s = this.state;
    const before = s.phase;
    s.rpm = s.mode === 'sim' ? simulatorRpm(s.elapsed) : this.sample?.rpm ?? 0;
    s.phase = phaseForRpm(s.rpm);
    if (s.phase !== before) {
      s.beat = 0;
      s.beatAge = Infinity;
      s.beatFlash = false;
      this.dreamTimer = 0;
      if (s.phase === 'RUN') s.entities = s.entities.filter(e => e.kind !== 'dream');
      if (s.status === 'running') {
        this.message(s.phase === 'NAP' ? 'NAP · Dream Cheese is out' : 'RUN · Follow the wheel');
        this.onEvent({ type: 'phase' });
      }
    }
    s.wheelAngle += effectiveRpm(s.rpm) / 60 * Math.PI * 2 * dt;
    if (s.phase === 'RUN') {
      s.beat += dt * effectiveRpm(s.rpm) / 60;
      s.beatAge += dt;
      if (s.beat >= 1) {
        s.beat %= 1;
        s.beatAge = 0;
        this.onEvent({ type: 'beat' });
      }
      s.beatFlash = s.beatAge <= PERFECT_WINDOW_SECONDS;
    } else {
      // Dream Cheese has its own reward. A resting wheel never generates invented beats.
      s.beatFlash = false;
    }
  }

  private tick(dt: number): void {
    const s = this.state;
    s.elapsed += dt;
    this.updateWheel(dt);
    const dx = speedForRpm(s.rpm) * dt;
    s.scenery += dx;
    s.distance += dx / 10;
    s.distancePoints += dx / 10 * s.combo;
    if (s.phase === 'RUN') s.course += dx;
    s.invulnerable = Math.max(0, s.invulnerable - dt);
    s.messageTime = Math.max(0, s.messageTime - dt);
    if (s.playerY > 0 || s.velocityY !== 0) {
      s.velocityY -= GRAVITY * dt;
      s.playerY = Math.max(0, s.playerY + s.velocityY * dt);
      if (s.playerY === 0) s.velocityY = 0;
    }
    s.duck = s.playerY === 0 && (this.duckHeld || s.elapsed < this.duckUntil);
    this.generate();
    if (s.phase === 'NAP') {
      this.dreamTimer -= dt;
      if (this.dreamTimer <= 0) {
        const rng = random(s.seed + this.dreamIndex * 97);
        s.entities.push({
          id: `dream:${this.dreamIndex++}`, kind: 'dream',
          x: s.course + PLAYER_X + 160 + rng() * 36,
          y: this.dreamIndex % 2 === 0 ? 18 : 110, width: 26, height: 26, resolved: false,
        });
        this.dreamTimer = 2.4;
      }
      for (const entity of s.entities) if (entity.kind === 'dream') entity.x -= dt * 76;
    }
    this.collisions();
    s.entities = s.entities.filter(e => !e.resolved && e.x - s.course > -80);
    s.score = totalScore(s);
  }

  private generate(): void {
    while (780 + this.nextSlot * SLOT_GAP < this.state.course + WORLD_WIDTH + 580) {
      this.state.entities.push(...trackSlot(this.state.seed, this.nextSlot++));
    }
  }

  private collisions(): void {
    const s = this.state;
    const left = PLAYER_X + 7;
    const right = PLAYER_X + PLAYER_WIDTH - 5;
    const bottom = s.playerY + 4;
    const top = s.playerY + (s.duck ? 25 : 48);
    for (const entity of s.entities) {
      if (entity.resolved) continue;
      const x = entity.x - s.course;
      if (x + entity.width < left || x > right || entity.y > top || entity.y + entity.height < bottom) continue;
      if (entity.kind === 'cheese' || entity.kind === 'dream') {
        // Normal cheese stays frozen alongside its obstacle during NAP.
        if (s.phase === 'NAP' && entity.kind !== 'dream') continue;
        const perfect = entity.kind === 'cheese' && s.beatFlash;
        if (perfect) { s.combo++; s.perfects++; s.bestCombo = Math.max(s.bestCombo, s.combo); }
        const points = (entity.kind === 'dream' ? 30 : perfect ? 50 : 10) * s.combo;
        s.cheese++;
        s.cheesePoints += points;
        entity.resolved = true;
        const type = entity.kind === 'dream' ? 'dream' : perfect ? 'perfect' : 'cheese';
        this.message(`${perfect ? 'Perfect Squeek' : entity.kind === 'dream' ? 'Dream Cheese' : 'Cheese'} +${points}`);
        this.onEvent({ type, points });
      } else if (s.phase === 'RUN' && s.invulnerable === 0) {
        s.bumps++;
        s.combo = 1;
        s.invulnerable = 1.2;
        entity.resolved = true;
        this.message('Bump! Combo reset');
        this.onEvent({ type: 'hit' });
      }
    }
  }

  private message(text: string): void {
    this.state.message = text;
    this.state.messageTime = 1.4;
  }
}
