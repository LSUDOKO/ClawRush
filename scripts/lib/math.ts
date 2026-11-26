// 1:1 TypeScript port of programs/clawrush/src/math.rs (bigint integer math, no floats).
// Checked against the Rust fixed vectors in scripts/lib/math.test.ts.
export const GRID = 1000, CHUTE_X = 900, CHUTE_Z = 900, CHUTE_KEEP_OUT = 90, MAX_STEP = 80;
export const BPS = 10_000, SLIP_MIN_BPS = 1_500, SLIP_SPAN_BPS = 5_000, NUDGE_RADIUS_BPS = 15_000, NUDGE_MAX = 40, MAX_NUDGED = 2;
export const HELD = 1, SLIP = 2, MISS = 3;

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n, y = x / 2n + (x & 1n);
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
export function distance(ax: number, az: number, bx: number, bz: number): number {
  const dx = BigInt(Math.abs(ax - bx)), dz = BigInt(Math.abs(az - bz));
  return Number(isqrt(dx * dx + dz * dz));
}
export function alignErrBps(dist: number, radius: number): number {
  if (radius === 0) return BPS;
  return Math.min(BPS, Math.floor((dist * BPS) / radius));
}
export function gripBps(alignErr: number, gripMax: number, gripMin: number): number {
  const e = Math.min(alignErr, BPS);
  const span = Math.max(0, gripMax - gripMin);
  return gripMax - Math.floor((span * e) / BPS);
}
export const rollBps = (r: Uint8Array, off = 0) => (r[off] | (r[off + 1] << 8)) % BPS;
export function outcome(alignErr: number, grip: number, roll: number): number {
  if (alignErr >= BPS) return MISS;
  return roll < grip ? HELD : SLIP;
}
export const slipFracBps = (r: Uint8Array) => SLIP_MIN_BPS + ((r[2] | (r[3] << 8)) % SLIP_SPAN_BPS);
// Rust i64 division truncates toward zero: Math.trunc matches it.
const div = (a: number, b: number) => Math.trunc(a / b);
export const clampGrid = (v: number) => Math.max(0, Math.min(GRID, v));
export function slipTowardChute(x: number, z: number, frac: number): [number, number] {
  let nx = x + div((CHUTE_X - x) * frac, BPS);
  let nz = z + div((CHUTE_Z - z) * frac, BPS);
  if (distance(nx, nz, CHUTE_X, CHUTE_Z) < CHUTE_KEEP_OUT) {
    const ox = x - CHUTE_X, oz = z - CHUTE_Z, od = distance(x, z, CHUTE_X, CHUTE_Z);
    if (od === 0) { nx = CHUTE_X - CHUTE_KEEP_OUT; nz = CHUTE_Z; }
    else { nx = CHUTE_X + div(ox * CHUTE_KEEP_OUT, od); nz = CHUTE_Z + div(oz * CHUTE_KEEP_OUT, od); }
  }
  return [clampGrid(nx), clampGrid(nz)];
}
export function applyMove(x: number, z: number, dx: number, dz: number): [number, number] {
  const c = (v: number) => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));
  return [clampGrid(x + c(dx)), clampGrid(z + c(dz))];
}
export const nudgeOffset = (b: number) => (b % (2 * NUDGE_MAX + 1)) - NUDGE_MAX;
export type Geo = { x: number; z: number; radius: number; active: boolean };
export function nearest(g: Geo[], x: number, z: number): [number, number] | null {
  let best: [number, number] | null = null;
  g.forEach((c, i) => {
    if (!c.active) return;
    const d = distance(x, z, c.x, c.z);
    if (!best || d < best[1]) best = [i, d];
  });
  return best;
}
export function nudgeTargets(g: Geo[], x: number, z: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.length && out.length < MAX_NUDGED; i++) {
    const c = g[i];
    if (c.active && distance(x, z, c.x, c.z) <= Math.floor((c.radius * NUDGE_RADIUS_BPS) / BPS)) out.push(i);
  }
  return out;
}
export const isSolvent = (vault: bigint, claimed: bigint, won: bigint, liability: bigint) => vault + claimed >= won + liability;
