/**
 * The public leaderboard: signed score events on open Nostr relays.
 *
 * A wallet signs ONE free message (personal_sign) naming this browser's leaderboard key. Each
 * finished live run is then published as a Nostr event signed by that key, carrying the wallet's
 * sign-in message and signature. Every visitor reads the same relays and keeps only events whose
 * wallet signature recovers to the address they claim and names the key that signed the event.
 */
import { BOARD_KIND, BOARD_TAG, MAX_PLAUSIBLE_SCORE, RELAYS } from './config.ts';
import { sha256, toHex, utf8 } from './hash.ts';
import { checksumAddress, N, recoverPersonalSigner, schnorrPublicKey, schnorrSign, schnorrVerify } from './secp256k1.ts';

export interface NostrEvent {
  id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string;
}
export interface SignIn { address: string; pubkey: string; message: string; signature: string; }
export interface ScoreEntry { address: string; score: number; round: string; playedAt: number; id: string; }
export interface BoardRow extends ScoreEntry { rank: number; }

const KEY_STORE = 'tempo-squeek.player-key.v1';
const SIGNIN_STORE = 'tempo-squeek.sign-in.v1';

export function buildSignInMessage(address: string, pubkey: string, issuedAt: string): string {
  return [
    'Tempo Squeek leaderboard sign-in',
    '',
    'Link my Tempo Squeek runs to this wallet on the public leaderboard.',
    '',
    `Wallet: ${address}`,
    `Player key: ${pubkey}`,
    `Issued: ${issuedAt}`,
    '',
    'This signature is free. It is not a transaction and costs no gas.',
  ].join('\n');
}

export const eventId = (e: Pick<NostrEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>) =>
  toHex(sha256(utf8(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return toHex(out);
}

/** This browser's leaderboard key. It can only publish score events; it holds no funds. */
export function playerKey(): { secret: string; pubkey: string } {
  let secret = '';
  try { secret = localStorage.getItem(KEY_STORE) ?? ''; } catch { /* storage blocked */ }
  if (!/^[0-9a-f]{64}$/.test(secret) || BigInt(`0x${secret}`) >= N || BigInt(`0x${secret}`) === 0n) {
    do { secret = randomHex(32); } while (BigInt(`0x${secret}`) >= N || BigInt(`0x${secret}`) === 0n);
    try { localStorage.setItem(KEY_STORE, secret); } catch { /* kept for this visit */ }
  }
  return { secret, pubkey: schnorrPublicKey(secret) };
}

export function storedSignIn(address: string): SignIn | null {
  try {
    const all = JSON.parse(localStorage.getItem(SIGNIN_STORE) ?? '{}') as Record<string, SignIn>;
    const found = all[address.toLowerCase()];
    if (!found || found.pubkey !== playerKey().pubkey) return null;
    return recoverPersonalSigner(found.message, found.signature) === checksumAddress(address) ? found : null;
  } catch { return null; }
}

export function saveSignIn(signIn: SignIn): void {
  try {
    const all = JSON.parse(localStorage.getItem(SIGNIN_STORE) ?? '{}') as Record<string, SignIn>;
    all[signIn.address.toLowerCase()] = signIn;
    localStorage.setItem(SIGNIN_STORE, JSON.stringify(all));
  } catch { /* sign-in kept in memory for this visit */ }
}

/** Returns a verified entry, or null for anything malformed, forged or implausible. */
export function parseScoreEvent(event: NostrEvent): ScoreEntry | null {
  try {
    if (event.kind !== BOARD_KIND || !event.tags.some(t => t[0] === 't' && t[1] === BOARD_TAG)) return null;
    if (!/^[0-9a-f]{64}$/.test(event.pubkey) || eventId(event) !== event.id) return null;
    const body = JSON.parse(event.content) as Record<string, unknown>;
    const signIn = body.signIn as { message?: unknown; signature?: unknown } | undefined;
    const { score, round, playedAt } = body;
    if (typeof body.address !== 'string' || typeof signIn?.message !== 'string' || typeof signIn.signature !== 'string') return null;
    if (typeof score !== 'number' || !Number.isSafeInteger(score) || score <= 0 || score > MAX_PLAUSIBLE_SCORE) return null;
    if (typeof round !== 'string' || !/^\d{1,20}$/.test(round)) return null;
    if (typeof playedAt !== 'number' || !Number.isFinite(playedAt)) return null;
    const address = checksumAddress(body.address);
    if (!signIn.message.startsWith('Tempo Squeek leaderboard sign-in\n')) return null;
    if (!signIn.message.includes(`\nWallet: ${address}\n`) || !signIn.message.includes(`\nPlayer key: ${event.pubkey}\n`)) return null;
    if (!schnorrVerify(event.id, event.pubkey, event.sig)) return null;
    if (recoverPersonalSigner(signIn.message, signIn.signature) !== address) return null;
    return { address, score, round, playedAt: Math.min(playedAt, event.created_at * 1000 + 60_000), id: event.id };
  } catch { return null; }
}

/** One row per wallet: its best run (earliest wins a tie), highest first. */
export function aggregateBoard(entries: ScoreEntry[]): BoardRow[] {
  const best = new Map<string, ScoreEntry>();
  for (const entry of entries) {
    const key = entry.address.toLowerCase();
    const current = best.get(key);
    if (!current || entry.score > current.score || (entry.score === current.score && entry.playedAt < current.playedAt)) best.set(key, entry);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.playedAt - b.playedAt)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

export function buildScoreEvent(signIn: SignIn, run: { score: number; round: string; seed: number; distance: number; cheese: number; perfects: number }): NostrEvent {
  const key = playerKey();
  const playedAt = Date.now();
  const unsigned = {
    pubkey: key.pubkey,
    created_at: Math.floor(playedAt / 1000),
    kind: BOARD_KIND,
    tags: [['d', `${BOARD_TAG}:${signIn.address.toLowerCase()}`], ['t', BOARD_TAG]],
    content: JSON.stringify({
      v: 1, game: 'Tempo Squeek', address: signIn.address, ...run, playedAt,
      signIn: { message: signIn.message, signature: signIn.signature },
    }),
  };
  const id = eventId(unsigned);
  return { ...unsigned, id, sig: schnorrSign(id, key.secret, randomHex(32)) };
}

type Socket = { send(data: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: (() => void) | null; onclose: (() => void) | null };

function withRelay(url: string, timeoutMs: number, onOpen: (ws: Socket) => void, onMessage: (msg: unknown[], done: () => void) => void): Promise<void> {
  return new Promise(resolve => {
    let ws: Socket;
    let finished = false;
    const done = () => { if (finished) return; finished = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(); };
    const timer = setTimeout(done, timeoutMs);
    try { ws = new WebSocket(url) as unknown as Socket; } catch { finished = true; clearTimeout(timer); resolve(); return; }
    ws.onopen = () => onOpen(ws);
    ws.onmessage = e => { try { const msg = JSON.parse(String(e.data)); if (Array.isArray(msg)) onMessage(msg, done); } catch { /* ignore */ } };
    ws.onerror = done;
    ws.onclose = done;
  });
}

/** Sends a score event to every relay; resolves with how many stored it. */
export async function publishScore(event: NostrEvent, relays: readonly string[] = RELAYS): Promise<number> {
  const results = await Promise.all(relays.map(url => {
    let accepted = false;
    return withRelay(url, 8000, ws => ws.send(JSON.stringify(['EVENT', event])), (msg, done) => {
      if (msg[0] === 'OK' && msg[1] === event.id) { accepted = msg[2] === true; done(); }
    }).then(() => accepted);
  }));
  return results.filter(Boolean).length;
}

const verified = new Map<string, ScoreEntry | null>();

/** Reads relay history in pages, including legacy per-run events, then verifies each wallet's best. */
export async function fetchBoard(relays: readonly string[] = RELAYS): Promise<{ rows: BoardRow[]; relaysAnswered: number }> {
  const events = new Map<string, NostrEvent>();
  let answered = 0;
  await Promise.all(relays.map(async url => {
    const seen = new Set<string>();
    let until: number | undefined;
    let relayAnswered = false;
    for (;;) {
      const sub = `board-${Math.random().toString(36).slice(2, 8)}`;
      let gotEose = false, added = 0, oldest = Infinity;
      await withRelay(url, 7000, ws => ws.send(JSON.stringify(['REQ', sub, {
        kinds: [BOARD_KIND], '#t': [BOARD_TAG], limit: 2000, ...(until === undefined ? {} : { until }),
      }])), (msg, done) => {
        if (msg[0] === 'EVENT' && msg[1] === sub && msg[2] && typeof msg[2] === 'object') {
          const e = msg[2] as NostrEvent;
          if (typeof e.id !== 'string' || !Number.isSafeInteger(e.created_at) || e.created_at < 0 || (until !== undefined && e.created_at > until)) return;
          oldest = Math.min(oldest, e.created_at);
          if (!seen.has(e.id)) { seen.add(e.id); added++; events.set(e.id, e); }
        } else if (msg[0] === 'EOSE' && msg[1] === sub) { gotEose = true; done(); }
      });
      if (gotEose) relayAnswered = true;
      if (!gotEose || !Number.isFinite(oldest) || oldest === 0) break;
      // `until` is inclusive. Re-read the boundary second before advancing past it.
      // Continue even with a short page: relays can cap our requested limit themselves.
      until = added > 0 ? oldest : oldest - 1;
    }
    if (relayAnswered) answered++;
  }));
  // Verify the highest claims first; stop at each wallet's first genuine entry.
  const claims = [...events.values()].map(e => {
    try { const c = JSON.parse(e.content) as { address?: string; score?: number }; return { e, address: String(c.address).toLowerCase(), score: Number(c.score) || 0 }; }
    catch { return { e, address: '', score: 0 }; }
  }).filter(c => c.address && c.score > 0).sort((a, b) => b.score - a.score);
  const settled = new Set<string>();
  const entries: ScoreEntry[] = [];
  for (const claim of claims) {
    if (settled.has(claim.address)) continue;
    if (!verified.has(claim.e.id)) verified.set(claim.e.id, parseScoreEvent(claim.e));
    const entry = verified.get(claim.e.id);
    if (entry && entry.address.toLowerCase() === claim.address) { entries.push(entry); settled.add(claim.address); }
  }
  return { rows: aggregateBoard(entries), relaysAnswered: answered };
}
