/** Read-only checks and the one optional transaction: SqueekMining.checkpoint() on Sepolia. */
import { keccak256, toHex, utf8 } from './hash.ts';
import { SEPOLIA, SQUEEK_CORE, SQUEEK_MINING } from './config.ts';

export const selector = (signature: string) => `0x${toHex(keccak256(utf8(signature))).slice(0, 8)}`;
export const CHECKPOINT_SELECTOR = selector('checkpoint()');
const STATUS_SELECTOR = selector('checkpointStatus()');
const STATE_SELECTOR = selector('state()');
const SETTLED_SELECTOR = selector('settledThroughRound()');

const ERRORS: Record<string, string | undefined> = {
  [selector('EmergencyPaused()')]: 'SqueekMining is paused right now, so checkpoints are on hold. Try again later.',
  [selector('StartNotScheduled()')]: 'SqueekMining has not started issuing yet, so there is nothing to checkpoint.',
  [selector('CorePaused()')]: 'SqueekCore is paused right now, so checkpoints are on hold. Try again later.',
};

export interface MiningState {
  processedThroughRound: bigint; startRound: bigint; paused: boolean; active: boolean;
}
export interface CheckpointStatus { corePaused: boolean; nextRound: bigint; roundSettled: boolean; }

function words(hex: string): bigint[] {
  const body = hex.replace(/^0x/, '');
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(BigInt(`0x${body.slice(i, i + 64)}`));
  return out;
}

export function decodeCheckpointStatus(hex: string): CheckpointStatus {
  const w = words(hex);
  if (w.length < 3) throw new Error('Short checkpointStatus response');
  return { corePaused: w[0] !== 0n, nextRound: w[1] as bigint, roundSettled: w[2] !== 0n };
}

export function decodeMiningState(hex: string): MiningState {
  const w = words(hex);
  if (w.length < 10) throw new Error('Short state response');
  return { processedThroughRound: w[1] as bigint, startRound: w[2] as bigint, paused: w[8] !== 0n, active: w[9] !== 0n };
}

/** Turns a wallet or RPC error into one plain sentence. */
export function describeRevert(error: unknown): string {
  const e = error as { code?: number; message?: string; data?: unknown } | string;
  if (typeof e === 'string') {
    const known = ERRORS[e.slice(0, 10).toLowerCase()];
    return known ?? 'The checkpoint would fail on Sepolia right now. Nothing was sent.';
  }
  if (e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? '')) return 'You rejected the transaction in your wallet. Nothing was sent, and your run is safe.';
  const data = typeof e?.data === 'string' ? e.data : typeof (e?.data as { data?: unknown })?.data === 'string' ? (e.data as { data: string }).data : '';
  const known = data ? ERRORS[data.slice(0, 10).toLowerCase()] : undefined;
  if (known) return known;
  if (/insufficient funds/i.test(e?.message ?? '')) return 'Your wallet needs a little Sepolia test ETH to pay the network fee. Sepolia ETH is free from public faucets.';
  return 'The wallet could not send the checkpoint. Nothing was charged. You can try again.';
}

type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/** Public Sepolia reads with fallback across endpoints. */
export const publicRpc: RpcCall = async (method, params) => {
  let lastError: unknown = null;
  for (const url of SEPOLIA.rpcUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }).finally(() => clearTimeout(timer));
      const body = await response.json() as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      if (body.error) {
        if (body.error.code === 3 || /revert/i.test(body.error.message)) throw Object.assign(new Error(body.error.message), { revert: body.error.data ?? '0x' });
        throw new Error(body.error.message);
      }
      return body.result;
    } catch (error) {
      if ((error as { revert?: unknown }).revert !== undefined) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('No Sepolia endpoint answered');
};

const call = (to: string, data: string, from?: string) => publicRpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']) as Promise<string>;

export type Readiness =
  | { ok: true; settledThrough: bigint; status: CheckpointStatus; note: string }
  | { ok: false; reason: string; retry: boolean };

/** Everything the docs ask a caller to check before sending checkpoint(). */
export async function checkReadiness(runRound: string, from: string): Promise<Readiness> {
  let settledThrough: bigint, status: CheckpointStatus, state: MiningState;
  try {
    const [settled, statusHex, stateHex] = await Promise.all([
      call(SQUEEK_CORE, SETTLED_SELECTOR), call(SQUEEK_MINING, STATUS_SELECTOR), call(SQUEEK_MINING, STATE_SELECTOR),
    ]);
    settledThrough = words(settled)[0] ?? 0n;
    status = decodeCheckpointStatus(statusHex);
    state = decodeMiningState(stateHex);
  } catch {
    return { ok: false, reason: 'Sepolia could not be reached to check the round. Your run is saved here; try again in a moment.', retry: true };
  }
  const round = BigInt(runRound);
  if (round > settledThrough) {
    return { ok: false, retry: true, reason: `Round ${round} has not settled on Sepolia yet (settled through ${settledThrough}). Rounds settle about every 10 minutes. Try again soon.` };
  }
  if (state.paused) return { ok: false, retry: true, reason: ERRORS[selector('EmergencyPaused()')] ?? 'Checkpoints are on hold right now.' };
  if (state.startRound === 0n) return { ok: false, retry: false, reason: ERRORS[selector('StartNotScheduled()')] ?? 'Checkpoints are on hold right now.' };
  if (status.corePaused) return { ok: false, retry: true, reason: ERRORS[selector('CorePaused()')] ?? 'Checkpoints are on hold right now.' };
  if (!status.roundSettled) {
    return { ok: false, retry: true, reason: `Round ${round} is settled and SqueekMining is already checkpointed through round ${state.processedThroughRound}. A new round settles about every 10 minutes; try again then.` };
  }
  try {
    await call(SQUEEK_MINING, CHECKPOINT_SELECTOR, from);
  } catch (error) {
    const revert = (error as { revert?: unknown }).revert;
    if (typeof revert === 'string') return { ok: false, retry: true, reason: describeRevert(revert) };
    return { ok: false, retry: true, reason: 'Sepolia could not simulate the checkpoint. Nothing was sent; try again in a moment.' };
  }
  const note = state.processedThroughRound >= round
    ? `Round ${round} is settled. This checkpoint processes the next settled rounds from ${status.nextRound} on, under your address.`
    : `Round ${round} is settled and waiting for a checkpoint.`;
  return { ok: true, settledThrough, status, note };
}
