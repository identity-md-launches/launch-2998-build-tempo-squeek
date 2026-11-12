/**
 * Minimal secp256k1 for two jobs: recovering the signer of an Ethereum personal_sign message,
 * and BIP340 Schnorr signatures for the Nostr score events that make the leaderboard shared.
 * No private key of the player's wallet ever reaches this code; the only key signed with here is
 * the browser's own leaderboard key, which can do nothing but publish scores.
 */
import { concat, fromHex, keccak256, sha256, toHex, utf8 } from './hash.ts';

const P = 2n ** 256n - 2n ** 32n - 977n;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

type Jacobian = [bigint, bigint, bigint];
export type Point = { x: bigint; y: bigint };

const mod = (a: bigint, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a: bigint, m = P): bigint {
  let [low, high, lm, hm] = [mod(a, m), m, 1n, 0n];
  if (low === 0n) throw new Error('No inverse');
  while (low > 1n) {
    const q = high / low;
    [lm, hm] = [hm - lm * q, lm];
    [low, high] = [high - low * q, low];
  }
  return mod(lm, m);
}
function pow(base: bigint, exp: bigint, m = P): bigint {
  let result = 1n, b = mod(base, m), e = exp;
  while (e > 0n) { if (e & 1n) result = (result * b) % m; b = (b * b) % m; e >>= 1n; }
  return result;
}

const ZERO: Jacobian = [0n, 1n, 0n];
function double([x, y, z]: Jacobian): Jacobian {
  if (z === 0n || y === 0n) return ZERO;
  const ysq = (y * y) % P;
  const s = (4n * x * ysq) % P;
  const m = (3n * x * x) % P;
  const nx = mod(m * m - 2n * s);
  const ny = mod(m * (s - nx) - 8n * ysq * ysq);
  const nz = (2n * y * z) % P;
  return [nx, ny, nz];
}
function add(p: Jacobian, q: Jacobian): Jacobian {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const z1z1 = (p[2] * p[2]) % P, z2z2 = (q[2] * q[2]) % P;
  const u1 = (p[0] * z2z2) % P, u2 = (q[0] * z1z1) % P;
  const s1 = (p[1] * q[2] * z2z2) % P, s2 = (q[1] * p[2] * z1z1) % P;
  if (u1 === u2) return s1 === s2 ? double(p) : ZERO;
  const h = mod(u2 - u1), r = mod(s2 - s1);
  const h2 = (h * h) % P, h3 = (h * h2) % P, u1h2 = (u1 * h2) % P;
  const nx = mod(r * r - h3 - 2n * u1h2);
  const ny = mod(r * (u1h2 - nx) - s1 * h3);
  const nz = (h * p[2] * q[2]) % P;
  return [nx, ny, nz];
}
function toAffine([x, y, z]: Jacobian): Point | null {
  if (z === 0n) return null;
  const zi = inv(z), zi2 = (zi * zi) % P;
  return { x: (x * zi2) % P, y: (y * zi2 * zi) % P };
}
const fromAffine = (p: Point): Jacobian => [p.x, p.y, 1n];

/** a·A + b·B in one pass (Shamir's trick), which keeps signature checks quick. */
function mul2(a: bigint, A: Point, b: bigint, B: Point): Point | null {
  const ja = fromAffine(A), jb = fromAffine(B), jab = add(ja, jb);
  let acc = ZERO;
  for (let i = 255; i >= 0; i--) {
    acc = double(acc);
    const bitA = (a >> BigInt(i)) & 1n, bitB = (b >> BigInt(i)) & 1n;
    if (bitA && bitB) acc = add(acc, jab);
    else if (bitA) acc = add(acc, ja);
    else if (bitB) acc = add(acc, jb);
  }
  return toAffine(acc);
}
const G: Point = { x: GX, y: GY };
export const mulG = (k: bigint) => mul2(mod(k, N), G, 0n, G);

function liftX(x: bigint): Point | null {
  if (x <= 0n || x >= P) return null;
  const c = mod(x * x * x + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if ((y * y) % P !== c) return null;
  return { x, y: y & 1n ? P - y : y };
}

const bytesToBig = (bytes: Uint8Array) => bytes.length ? BigInt(`0x${toHex(bytes)}`) : 0n;
const bigTo32 = (n: bigint) => fromHex(n.toString(16).padStart(64, '0'));

// ---------- Ethereum ----------

export function personalMessageHash(message: string): Uint8Array {
  const body = utf8(message);
  return keccak256(concat(utf8(`\x19Ethereum Signed Message:\n${body.length}`), body));
}

export function checksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error('Invalid address');
  const hash = toHex(keccak256(utf8(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash.charAt(i), 16) >= 8 ? lower.charAt(i).toUpperCase() : lower.charAt(i);
  return out;
}

/** Returns the checksummed address that produced a 65-byte personal_sign signature, or null. */
export function recoverPersonalSigner(message: string, signature: string): string | null {
  try {
    const sig = fromHex(signature);
    if (sig.length !== 65) return null;
    const r = bytesToBig(sig.slice(0, 32)), s = bytesToBig(sig.slice(32, 64));
    let v = sig[64] as number;
    if (v >= 27) v -= 27;
    if (v > 1 || r <= 0n || r >= N || s <= 0n || s >= N) return null;
    const R = liftX(r);
    if (!R) return null;
    const point = (R.y & 1n) === BigInt(v) ? R : { x: R.x, y: P - R.y };
    const e = bytesToBig(personalMessageHash(message));
    const ri = inv(r, N);
    const Q = mul2(mod(-e * ri, N), G, mod(s * ri, N), point);
    if (!Q) return null;
    const hash = keccak256(concat(bigTo32(Q.x), bigTo32(Q.y)));
    return checksumAddress(toHex(hash.slice(12)));
  } catch {
    return null;
  }
}

// ---------- BIP340 (Nostr) ----------

function taggedHash(tag: string, ...parts: Uint8Array[]): Uint8Array {
  const t = sha256(utf8(tag));
  return sha256(concat(t, t, ...parts));
}

export function schnorrPublicKey(secretHex: string): string {
  const point = mulG(bytesToBig(fromHex(secretHex)));
  if (!point) throw new Error('Invalid key');
  return toHex(bigTo32(point.x));
}

export function schnorrSign(messageHex: string, secretHex: string, auxHex: string): string {
  const d0 = bytesToBig(fromHex(secretHex));
  if (d0 <= 0n || d0 >= N) throw new Error('Invalid key');
  const Pt = mulG(d0)!;
  const d = Pt.y & 1n ? N - d0 : d0;
  const px = bigTo32(Pt.x);
  const msg = fromHex(messageHex);
  const t = bigTo32(d ^ bytesToBig(taggedHash('BIP0340/aux', fromHex(auxHex))));
  const k0 = mod(bytesToBig(taggedHash('BIP0340/nonce', t, px, msg)), N);
  if (k0 === 0n) throw new Error('Bad nonce');
  const R = mulG(k0)!;
  const k = R.y & 1n ? N - k0 : k0;
  const rx = bigTo32(R.x);
  const e = mod(bytesToBig(taggedHash('BIP0340/challenge', rx, px, msg)), N);
  return toHex(concat(rx, bigTo32(mod(k + e * d, N))));
}

export function schnorrVerify(messageHex: string, publicKeyHex: string, signatureHex: string): boolean {
  try {
    const Pt = liftX(bytesToBig(fromHex(publicKeyHex)));
    const sig = fromHex(signatureHex);
    if (!Pt || sig.length !== 64) return false;
    const r = bytesToBig(sig.slice(0, 32)), s = bytesToBig(sig.slice(32));
    if (r >= P || s >= N) return false;
    const e = mod(bytesToBig(taggedHash('BIP0340/challenge', sig.slice(0, 32), fromHex(publicKeyHex), fromHex(messageHex))), N);
    const R = mul2(s, G, N - e, Pt);
    return !!R && (R.y & 1n) === 0n && R.x === r;
  } catch {
    return false;
  }
}
