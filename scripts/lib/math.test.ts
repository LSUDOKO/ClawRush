// Same fixed vectors as the Rust unit tests in math.rs. Run: npx tsx scripts/lib/math.test.ts
import assert from "assert";
import * as m from "./math.ts";
const rnd = (pairs: [number, number][]) => { const r = new Uint8Array(32); for (const [i, b] of pairs) r[i] = b; return r; };
assert.equal(m.isqrt(18446744073709551615n), 4294967295n);
for (let n = 0n; n < 2000n; n++) { const s = m.isqrt(n); assert(s * s <= n && (s + 1n) * (s + 1n) > n); }
assert.equal(m.distance(0, 0, 3, 4), 5); assert.equal(m.distance(0, 0, 1000, 1000), 1414);
assert.equal(m.alignErrBps(30, 60), 5000); assert.equal(m.alignErrBps(59, 60), 9833); assert.equal(m.alignErrBps(60, 60), 10000); assert.equal(m.alignErrBps(5, 0), 10000);
assert.equal(m.gripBps(0, 8500, 2500), 8500); assert.equal(m.gripBps(10000, 8500, 2500), 2500); assert.equal(m.gripBps(5000, 8500, 2500), 5500); assert.equal(m.gripBps(5000, 2000, 3000), 2000);
assert.equal(m.rollBps(rnd([[0, 0xff], [1, 0xff]])), 5535); assert.equal(m.rollBps(rnd([[0, 0x10], [1, 0x27]])), 0); assert.equal(m.rollBps(rnd([[0, 0x0f], [1, 0x27]])), 9999);
assert.equal(m.outcome(10000, 8500, 0), m.MISS); assert.equal(m.outcome(0, 8500, 8499), m.HELD); assert.equal(m.outcome(0, 8500, 8500), m.SLIP);
const r = rnd([[0, 0x88], [1, 0x13], [2, 0x34], [3, 0x12]]);
assert.equal(m.distance(500, 500, 518, 524), 30); assert.equal(m.rollBps(r), 5000); assert.equal(m.slipFracBps(r), 1500 + (0x1234 % 5000));
assert.deepEqual(m.slipTowardChute(100, 100, 5000), [500, 500]); assert.deepEqual(m.slipTowardChute(300, 200, 0), [300, 200]);
const [ax, az] = m.slipTowardChute(900, 900, 1500); assert.equal(m.distance(ax, az, 900, 900), 90);
assert.deepEqual(m.applyMove(500, 500, 1000, -1000), [580, 420]); assert.deepEqual(m.applyMove(990, 5, 80, -80), [1000, 0]);
assert.equal(m.nudgeOffset(0), -40); assert.equal(m.nudgeOffset(40), 0); assert.equal(m.nudgeOffset(80), 40);
const g = (x: number, z: number, active: boolean) => ({ x, z, radius: 60, active });
assert.deepEqual(m.nearest([g(0, 0, false), g(100, 100, true), g(300, 300, true), g(100, 100, true)], 110, 110), [1, 14]);
assert.deepEqual(m.nudgeTargets([g(100, 100, true), g(150, 100, true), g(120, 100, true), g(900, 900, true)], 120, 100), [0, 1]);
assert(m.isSolvent(50n, 50n, 30n, 70n)); assert(!m.isSolvent(50n, 50n, 31n, 70n));
console.log("math.ts port: all vectors match math.rs");
