// Capsule stock. Mint index: 0 dUSDC, 1 dGEM, 2 KOI, 3 ROBO.
// kind: 0 token, 1 collectible, 2 mystery. Mystery contents are NOT in this file: they are drawn with
// crypto randomness at restock time and go straight into the private TEE vault, so reading the public repo
// tells you nothing about what a mystery capsule holds.
import { randomInt } from "crypto";

export type Spec = { x: number; z: number; radius: number; kind: number; mintIdx: number; amount: bigint; tier: number };
const U = 1_000_000n; // 6-decimals unit

/** Demo appraisal in play-price units (1 play = 1 dUSDC), used by the EV simulation and the UI. */
export const VALUE_PER_UNIT = [1 / 1e6, 0.01 / 1e6, 1, 1];
export const valueOf = (mintIdx: number, amount: bigint) => Number(amount) * VALUE_PER_UNIT[mintIdx];

/** Slot layout. Visible prizes stay at or below one play price, so even a perfect aim-bot that always
 *  picks the best capsule is capped at grip_max (85%) × ~1 play. Jackpots live only in mystery capsules. */
const L: [number, number, number, number, number, bigint][] = [
  // x,   z,   r, kind, mint, amount
  [220, 300, 60, 0, 0, 1n * U],
  [420, 220, 55, 0, 0, (9n * U) / 10n],
  [640, 320, 50, 0, 0, (3n * U) / 4n],
  [300, 560, 60, 0, 1, 90n * U],
  [560, 600, 55, 0, 1, 75n * U],
  [760, 520, 45, 1, 2, 1n],
  [180, 780, 45, 1, 3, 1n],
  [460, 820, 55, 2, 0, 0n],
  [820, 220, 55, 2, 0, 0n],
  [680, 760, 50, 2, 0, 0n],
  [120, 480, 60, 0, 0, U / 2n],
  [520, 420, 50, 2, 0, 0n],
];

/** Mystery tiers: [weight %, mintIdx, amount, tier]. EV ≈ 1.0 play. Jackpot ≤ max_payout_per_round. */
export const MYSTERY_TIERS: [number, number, bigint, number][] = [
  [60, 0, (35n * U) / 100n, 1], // dust: 0.35 dUSDC
  [30, 0, (11n * U) / 10n, 2], // mid: 1.1 dUSDC
  [9, 1, 300n * U, 2], // big: 300 dGEM (3.0)
  [1, 0, 20n * U, 3], // jackpot: 20 dUSDC
];

export function drawMystery(rand: (n: number) => number = randomInt) {
  let r = rand(100);
  for (const [w, mintIdx, amount, tier] of MYSTERY_TIERS) {
    if (r < w) return { mintIdx, amount, tier };
    r -= w;
  }
  throw new Error("weights must sum to 100");
}

/** Spec for slot i (mystery contents freshly drawn). */
export function specFor(i: number, rand?: (n: number) => number): Spec {
  const [x, z, radius, kind, mintIdx, amount] = L[i];
  if (kind === 2) return { x, z, radius, kind, ...drawMystery(rand) };
  return { x, z, radius, kind, mintIdx, amount, tier: 0 };
}
export const NUM_SLOTS = L.length;
