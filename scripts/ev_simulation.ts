// Monte Carlo payout proof on a shared cabinet, using the integer math ported 1:1 from math.rs.
//   npx tsx scripts/ev_simulation.ts            (100k turns per population)
// Writes scripts/ev_results.md.
import fs from "fs";
import path from "path";
import { randomBytes, randomInt } from "crypto";
import * as m from "./lib/math.ts";
import { specFor, valueOf, NUM_SLOTS } from "./lib/stock.ts";
import { ROOT } from "./lib/common.ts";

const TURNS = Number(process.env.TURNS ?? 100_000);
const GRIP_MAX = 8500, GRIP_MIN = 2500, PRICE = 1; // 1 play = 1 dUSDC
const RESTOCK_BELOW = 6; // config.restock_threshold
const VAULT0 = 300; // starting vault, in play-price units (matches setup_devnet dUSDC funding)

type Cap = { x: number; z: number; radius: number; active: boolean; kind: number; value: number };
type Kind = "beginner" | "skilled" | "perfect";

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** Alignment error in bps for a player type, and which capsule they go for. */
function aim(kind: Kind, caps: Cap[]): { idx: number; align: number } {
  const act = caps.map((c, i) => [c, i] as const).filter(([c]) => c.active);
  // Mystery capsules are valued at their known tier EV (contents are private), visible ones at face value.
  const ev = (c: Cap) => (c.kind === 2 ? MYSTERY_EV : c.value);
  if (kind === "beginner") {
    const [, idx] = act[randomInt(act.length)];
    if (Math.random() < 0.25) return { idx, align: m.BPS };
    return { idx, align: Math.floor(3000 + Math.random() * 7000) };
  }
  const [, idx] = act.reduce((a, b) => (ev(b[0]) > ev(a[0]) ? b : a));
  if (kind === "perfect") return { idx, align: 0 };
  const e = Math.max(0, Math.min(1, 0.15 + 0.1 * gauss()));
  return { idx, align: Math.floor(e * m.BPS) };
}

let MYSTERY_EV = 0;
{
  let s = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) { const d = specFor(7); s += valueOf(d.mintIdx, d.amount); }
  MYSTERY_EV = s / N;
}

function stockSlot(caps: Cap[], i: number) {
  const s = specFor(i);
  caps[i] = { x: s.x, z: s.z, radius: s.radius, active: true, kind: s.kind, value: valueOf(s.mintIdx, s.amount) };
}

function run(pop: Kind[], turns: number) {
  const caps: Cap[] = [];
  for (let i = 0; i < NUM_SLOTS; i++) stockSlot(caps, i);
  let vault = VAULT0, paid = 0, income = 0, minHeadroom = Infinity, peak = vault, maxDD = 0;
  const per: Record<string, { plays: number; paid: number; held: number; slip: number; miss: number }> = {};
  const liability = () => caps.reduce((a, c) => a + (c.active ? c.value : 0), 0);
  const series: number[] = [];
  for (let t = 0; t < turns; t++) {
    const kind = pop[t % pop.length];
    const st = (per[kind] ??= { plays: 0, paid: 0, held: 0, slip: 0, miss: 0 });
    vault += PRICE; income += PRICE; st.plays++;
    const { idx, align } = aim(kind, caps);
    const rnd = randomBytes(32);
    const grip = m.gripBps(align, GRIP_MAX, GRIP_MIN);
    const out = m.outcome(align, grip, m.rollBps(rnd, 0));
    const c = caps[idx];
    if (out === m.HELD) {
      c.active = false; vault -= c.value; paid += c.value; st.paid += c.value; st.held++;
    } else if (out === m.SLIP) {
      [c.x, c.z] = m.slipTowardChute(c.x, c.z, m.slipFracBps(rnd)); st.slip++;
    } else {
      st.miss++;
      const g = caps.map((k) => ({ x: k.x, z: k.z, radius: k.radius, active: k.active }));
      m.nudgeTargets(g, c.x, c.z).forEach((i, k) => {
        caps[i].x = m.clampGrid(caps[i].x + m.nudgeOffset(rnd[4 + 2 * k]));
        caps[i].z = m.clampGrid(caps[i].z + m.nudgeOffset(rnd[5 + 2 * k]));
      });
    }
    // Restock exactly like the on-chain rule: only if the vault covers every live prize afterwards.
    if (caps.filter((k) => k.active).length < RESTOCK_BELOW) {
      const save = caps.map((k) => ({ ...k }));
      caps.forEach((k, i) => { if (!k.active) stockSlot(caps, i); });
      if (vault < liability()) caps.splice(0, caps.length, ...save); // refused: VaultInsolvent
    }
    minHeadroom = Math.min(minHeadroom, vault - liability());
    peak = Math.max(peak, vault); maxDD = Math.max(maxDD, peak - vault);
    if (t % Math.ceil(turns / 20) === 0) series.push(Math.round(vault));
  }
  return { per, vault, paid, income, minHeadroom, maxDD, series };
}

const pops: [string, Kind[]][] = [["Beginner", ["beginner"]], ["Skilled", ["skilled"]], ["Perfect bot", ["perfect"]], ["Mixed (2 beginner : 1 skilled : 1 perfect)", ["beginner", "beginner", "skilled", "perfect"]]];
const rows: string[] = [];
const extra: string[] = [];
for (const [name, pop] of pops) {
  const r = run(pop, TURNS);
  for (const [k, s] of Object.entries(r.per)) {
    rows.push(`| ${name}${pop.length > 1 ? ` → ${k}` : ""} | ${s.plays} | ${((100 * s.paid) / (s.plays * PRICE)).toFixed(1)}% | ${((100 * s.held) / s.plays).toFixed(1)}% | ${((100 * s.slip) / s.plays).toFixed(1)}% | ${((100 * s.miss) / s.plays).toFixed(1)}% |`);
  }
  extra.push(`| ${name} | ${((100 * r.paid) / r.income).toFixed(1)}% | ${r.vault.toFixed(0)} | ${r.minHeadroom.toFixed(2)} | ${r.maxDD.toFixed(1)} | ${r.series.join(" → ")} |`);
}

const md = [
  "# EV simulation results",
  "",
  `Generated by \`scripts/ev_simulation.ts\` (${TURNS.toLocaleString()} turns per population, shared cabinet, VRF modelled with 32 crypto-random bytes per turn).`,
  "Math is the integer port of `math.rs` (`scripts/lib/math.ts`, checked against the Rust test vectors). Prize values use the demo appraisal in",
  "`scripts/lib/stock.ts` (1 dUSDC = 1 play, 100 dGEM = 1 play, 1 collectible = 1 play). Mystery contents are drawn at restock from the tier table",
  `(EV ≈ ${MYSTERY_EV.toFixed(3)} play). Skilled and perfect players always target the highest-EV capsule; beginners pick at random.`,
  "",
  "| Player | plays | return to player (EV / play) | HELD | SLIP | MISS |",
  "|---|---|---|---|---|---|",
  ...rows,
  "",
  `Vault (starting ${VAULT0} plays of inventory cash). Restock only happens when the vault covers every live prize, exactly like the on-chain rule.`,
  "",
  "| Population | house payout ratio | final vault | min (vault − live liability) | max drawdown | vault every 5% of the run |",
  "|---|---|---|---|---|---|",
  ...extra,
  "",
];
fs.writeFileSync(path.join(ROOT, "scripts", "ev_results.md"), md.join("\n"));
console.log(md.join("\n"));
