export const STATUS_URL = 'https://api.squeekchain.com/v1/status';
export const POLL_MS = 5_000;
export const REQUEST_TIMEOUT_MS = 4_000;
export const MAX_RPM = 120;

export type Mode = 'live' | 'sim';
export type Phase = 'RUN' | 'NAP';

export interface WheelSample {
  rpm: number;
  round: string;
  seed: number;
  observedAt: string | null;
}

export interface WheelState {
  mode: Mode;
  status: 'connecting' | 'live' | 'retrying' | 'sim';
  sample: WheelSample | null;
  failures: number;
  automatic: boolean;
  lastSuccess: number | null;
}

export function seedForRound(round: string | number | bigint): number {
  const value = BigInt(round);
  if (value < 0n) throw new Error('Round must be nonnegative.');
  return Number((value * 7919n + 4242n) % 90000n) + 10000;
}

export function phaseForRpm(rpm: number): Phase {
  return rpm > 2 ? 'RUN' : 'NAP';
}

export function effectiveRpm(rpm: number): number {
  return Math.max(0, Math.min(MAX_RPM, rpm));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function parseRound(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toString();
  return null;
}

/** Parse only documented, observed API fields. Missing readings never become zero RPM. */
export function parseStatus(payload: unknown, now = Date.now()): WheelSample {
  const data = record(payload);
  const measurement = record(data.measurement);
  const rawRpm = measurement.rpmMilli;
  if (typeof rawRpm !== 'number' || !Number.isFinite(rawRpm) || rawRpm < 0) {
    throw new Error('The wheel reading is unavailable.');
  }
  if (measurement.freshness != null && measurement.freshness !== 'online') {
    throw new Error('The wheel reading is not fresh.');
  }
  const observedAt = typeof measurement.observedAt === 'string' ? measurement.observedAt : null;
  if (observedAt !== null) {
    const observed = Date.parse(observedAt);
    const staleAfter = typeof measurement.staleAfterSeconds === 'number'
      && measurement.staleAfterSeconds > 0 ? measurement.staleAfterSeconds : 120;
    if (!Number.isFinite(observed) || now - observed > staleAfter * 1000 || observed - now > 60_000) {
      throw new Error('The wheel reading is stale.');
    }
  }
  const closure = record(record(data.oracle).latestClosure);
  const anchor = record(record(data.builder).anchor);
  const latest = parseRound(closure.lastRound);
  const settled = parseRound(anchor.settledThroughRound);
  const round = latest && settled
    ? (BigInt(latest) >= BigInt(settled) ? latest : settled)
    : latest ?? settled;
  if (round === null) throw new Error('The SqueekCore round is unavailable.');
  return { rpm: rawRpm / 1000, round, seed: seedForRound(round), observedAt };
}

/** Local practice data, deliberately separate from all real samples and round IDs. */
export function simulatorRpm(seconds: number): number {
  const t = ((seconds % 36) + 36) % 36;
  if (t >= 24 && t < 31) return 0;
  if (t >= 31) return 32 + (t - 31) * 8;
  return Math.max(8, Math.min(112, 61 + Math.sin(t * 0.23) * 25 + Math.sin(t * 0.71) * 10));
}

export const SIM_SEED = 48271;

/** A 5-second, non-overlapping poller. The request timeout is shorter than the cadence. */
export class WheelConnection {
  state: WheelState = {
    mode: 'live', status: 'connecting', sample: null, failures: 0,
    automatic: false, lastSuccess: null,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private listeners = new Set<(state: WheelState) => void>();

  subscribe(listener: (state: WheelState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer !== null) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
  }

  setMode(mode: Mode): void {
    if (mode === this.state.mode && this.state.status !== 'retrying') return;
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.state = {
      ...this.state, mode, status: mode === 'sim' ? 'sim' : 'connecting',
      failures: 0, automatic: false,
      // A previous live sample is never presented as a fresh response on a new connection.
      sample: null,
    };
    this.emit();
    if (mode === 'live') void this.poll();
  }

  async poll(): Promise<void> {
    if (this.state.mode !== 'live' || this.request) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(STATUS_URL, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sample = parseStatus(await response.json());
      if (generation !== this.generation) return;
      this.state = {
        mode: 'live', status: 'live', sample, failures: 0,
        automatic: false, lastSuccess: Date.now(),
      };
    } catch {
      if (generation !== this.generation) return;
      const failures = this.state.failures + 1;
      this.state = {
        ...this.state, failures, status: failures >= 3 ? 'sim' : 'retrying',
        mode: failures >= 3 ? 'sim' : 'live', automatic: failures >= 3,
      };
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.request = null;
        this.emit();
      }
    }
  }

  stop(): void {
    this.generation++;
    this.request?.abort();
    this.request = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
