//! Grip, slip and nudge math. Pure integer functions, no floats, no I/O.
//! Ported 1:1 to TypeScript in `scripts/lib/math.ts` for the EV simulation and the app.

use crate::constants::*;

/// Integer square root (floor) for non-negative values.
pub fn isqrt(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    // Newton's method; converges from above.
    let mut x = n;
    let mut y = x / 2 + (x & 1); // (x + 1) / 2 without overflow at u64::MAX
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Euclidean distance between two grid points, floored.
pub fn distance(ax: i32, az: i32, bx: i32, bz: i32) -> u64 {
    let dx = (ax as i64 - bx as i64).unsigned_abs();
    let dz = (az as i64 - bz as i64).unsigned_abs();
    isqrt(dx * dx + dz * dz)
}

/// Alignment error in bps: 0 = dead centre, 10_000 = at or outside the capsule edge.
pub fn align_err_bps(dist: u64, radius: u16) -> u16 {
    if radius == 0 {
        return BPS as u16;
    }
    let e = dist.saturating_mul(BPS) / radius as u64;
    e.min(BPS) as u16
}

/// Grip chance in bps. Linear from `grip_max` at the centre to `grip_min` at the edge.
pub fn grip_bps(align_err: u16, grip_max: u16, grip_min: u16) -> u16 {
    let e = (align_err as u64).min(BPS);
    let span = grip_max.saturating_sub(grip_min) as u64;
    (grip_max as u64 - span * e / BPS) as u16
}

/// Read a little-endian u16 from randomness at `off` and reduce mod 10_000.
pub fn roll_bps(randomness: &[u8; 32], off: usize) -> u16 {
    (u16::from_le_bytes([randomness[off], randomness[off + 1]]) as u64 % BPS) as u16
}

/// HELD / SLIP / MISS from alignment, grip and roll.
pub fn outcome(align_err: u16, grip: u16, roll: u16) -> u8 {
    if align_err as u64 >= BPS {
        OUTCOME_MISS
    } else if roll < grip {
        OUTCOME_HELD
    } else {
        OUTCOME_SLIP
    }
}

/// Slip fraction in bps, in [SLIP_MIN_BPS, SLIP_MIN_BPS + SLIP_SPAN_BPS).
pub fn slip_frac_bps(randomness: &[u8; 32]) -> u16 {
    let r = u16::from_le_bytes([randomness[2], randomness[3]]) as u64 % SLIP_SPAN_BPS;
    (SLIP_MIN_BPS + r) as u16
}

/// Move (x, z) toward the chute by `frac_bps` of the remaining path, but never inside the
/// chute keep-out circle. The capsule stays on the floor for the next player.
pub fn slip_toward_chute(x: i32, z: i32, frac_bps: u16) -> (i32, i32) {
    let f = frac_bps as i64;
    let mut nx = x as i64 + (CHUTE_X as i64 - x as i64) * f / BPS as i64;
    let mut nz = z as i64 + (CHUTE_Z as i64 - z as i64) * f / BPS as i64;
    let d = distance(nx as i32, nz as i32, CHUTE_X, CHUTE_Z) as i64;
    let keep = CHUTE_KEEP_OUT as i64;
    if d < keep {
        // Push back out along the chute->capsule ray to exactly the keep-out radius.
        let ox = x as i64 - CHUTE_X as i64;
        let oz = z as i64 - CHUTE_Z as i64;
        let od = distance(x, z, CHUTE_X, CHUTE_Z) as i64;
        if od == 0 {
            nx = CHUTE_X as i64 - keep;
            nz = CHUTE_Z as i64;
        } else {
            nx = CHUTE_X as i64 + ox * keep / od;
            nz = CHUTE_Z as i64 + oz * keep / od;
        }
    }
    (clamp_grid(nx as i32), clamp_grid(nz as i32))
}

pub fn clamp_grid(v: i32) -> i32 {
    v.clamp(0, GRID)
}

/// Clamp a joystick step to MAX_STEP per axis and the claw to the grid.
pub fn apply_move(x: i32, z: i32, dx: i32, dz: i32) -> (i32, i32) {
    let dx = dx.clamp(-MAX_STEP, MAX_STEP);
    let dz = dz.clamp(-MAX_STEP, MAX_STEP);
    (clamp_grid(x.saturating_add(dx)), clamp_grid(z.saturating_add(dz)))
}

/// Signed nudge offset in [-NUDGE_MAX, NUDGE_MAX] from one randomness byte.
pub fn nudge_offset(b: u8) -> i32 {
    (b as i32 % (2 * NUDGE_MAX + 1)) - NUDGE_MAX
}

/// Minimal capsule geometry used by the math helpers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Geo {
    pub x: i32,
    pub z: i32,
    pub radius: u16,
    pub active: bool,
}

/// Index of the active capsule nearest to (x, z) and its distance. `None` if no capsule is active.
pub fn nearest(geos: &[Geo], x: i32, z: i32) -> Option<(usize, u64)> {
    let mut best: Option<(usize, u64)> = None;
    for (i, g) in geos.iter().enumerate() {
        if !g.active {
            continue;
        }
        let d = distance(x, z, g.x, g.z);
        // Ties resolve to the lowest index (deterministic).
        if best.map_or(true, |(_, bd)| d < bd) {
            best = Some((i, d));
        }
    }
    best
}

/// Indexes of up to MAX_NUDGED active capsules within NUDGE_RADIUS_BPS of their radius from the claw.
pub fn nudge_targets(geos: &[Geo], x: i32, z: i32) -> [Option<usize>; MAX_NUDGED] {
    let mut out = [None; MAX_NUDGED];
    let mut n = 0;
    for (i, g) in geos.iter().enumerate() {
        if n == MAX_NUDGED {
            break;
        }
        if !g.active {
            continue;
        }
        let reach = g.radius as u64 * NUDGE_RADIUS_BPS / BPS;
        if distance(x, z, g.x, g.z) <= reach {
            out[n] = Some(i);
            n += 1;
        }
    }
    out
}

/// Solvency rule: vault + already-claimed must cover everything won plus every live prize.
/// `vault + claimed >= won + liability`, computed without overflow.
pub fn is_solvent(vault: u64, claimed: u64, won: u64, liability: u64) -> bool {
    (vault as u128 + claimed as u128) >= (won as u128 + liability as u128)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rnd(bytes: &[(usize, u8)]) -> [u8; 32] {
        let mut r = [0u8; 32];
        for &(i, b) in bytes {
            r[i] = b;
        }
        r
    }

    #[test]
    fn isqrt_exact_and_floor() {
        for n in 0u64..2000 {
            let s = isqrt(n);
            assert!(s * s <= n && (s + 1) * (s + 1) > n, "n={n}");
        }
        assert_eq!(isqrt(u32::MAX as u64 * u32::MAX as u64), u32::MAX as u64);
        assert_eq!(isqrt(u64::MAX), 4_294_967_295);
    }

    #[test]
    fn distance_basic_and_extremes() {
        assert_eq!(distance(0, 0, 3, 4), 5);
        assert_eq!(distance(3, 4, 0, 0), 5);
        assert_eq!(distance(10, 10, 10, 10), 0);
        // Extreme i32 corners do not overflow (i64 math).
        assert_eq!(distance(i32::MIN, 0, i32::MAX, 0), u32::MAX as u64);
        assert_eq!(distance(0, 0, GRID, GRID), 1414);
    }

    #[test]
    fn align_err_bounds() {
        assert_eq!(align_err_bps(0, 60), 0);
        assert_eq!(align_err_bps(30, 60), 5_000);
        assert_eq!(align_err_bps(59, 60), 9_833);
        assert_eq!(align_err_bps(60, 60), 10_000);
        assert_eq!(align_err_bps(1_000_000, 60), 10_000);
        assert_eq!(align_err_bps(u64::MAX, 60), 10_000); // saturating
        assert_eq!(align_err_bps(5, 0), 10_000); // zero radius never grips
    }

    #[test]
    fn grip_curve_endpoints_and_monotonic() {
        assert_eq!(grip_bps(0, 8_500, 2_500), 8_500);
        assert_eq!(grip_bps(10_000, 8_500, 2_500), 2_500);
        assert_eq!(grip_bps(5_000, 8_500, 2_500), 5_500);
        assert_eq!(grip_bps(u16::MAX, 8_500, 2_500), 2_500); // clamped
        // min > max degrades safely to max (no underflow).
        assert_eq!(grip_bps(5_000, 2_000, 3_000), 2_000);
        let mut prev = u16::MAX;
        for e in (0..=10_000u16).step_by(97) {
            let g = grip_bps(e, 8_500, 2_500);
            assert!(g <= prev);
            prev = g;
        }
    }

    #[test]
    fn roll_range() {
        assert_eq!(roll_bps(&rnd(&[]), 0), 0);
        assert_eq!(roll_bps(&rnd(&[(0, 0xff), (1, 0xff)]), 0), (65_535 % 10_000) as u16);
        assert_eq!(roll_bps(&rnd(&[(0, 0x10), (1, 0x27)]), 0), 0); // 10_000 -> 0
        assert_eq!(roll_bps(&rnd(&[(0, 0x0f), (1, 0x27)]), 0), 9_999);
        for b in 0..=255u8 {
            assert!(roll_bps(&rnd(&[(0, b), (1, b)]), 0) < 10_000);
        }
    }

    #[test]
    fn outcomes_held_slip_miss() {
        assert_eq!(outcome(10_000, 8_500, 0), OUTCOME_MISS);
        assert_eq!(outcome(0, 8_500, 8_499), OUTCOME_HELD);
        assert_eq!(outcome(0, 8_500, 8_500), OUTCOME_SLIP); // boundary: roll == grip slips
        assert_eq!(outcome(9_999, 2_501, 2_500), OUTCOME_HELD);
        assert_eq!(outcome(9_999, 2_501, 9_999), OUTCOME_SLIP);
    }

    #[test]
    fn deterministic_fixed_inputs() {
        // Fixed claw/capsule/randomness -> fixed outcome. Mirrored in scripts/lib/math.test.ts.
        let d = distance(500, 500, 518, 524); // 30
        assert_eq!(d, 30);
        let e = align_err_bps(d, 60);
        assert_eq!(e, 5_000);
        let g = grip_bps(e, 8_500, 2_500);
        assert_eq!(g, 5_500);
        let r = rnd(&[(0, 0x88), (1, 0x13), (2, 0x34), (3, 0x12)]); // 0x1388 = 5000
        assert_eq!(roll_bps(&r, 0), 5_000);
        assert_eq!(outcome(e, g, roll_bps(&r, 0)), OUTCOME_HELD);
        assert_eq!(slip_frac_bps(&r), (1_500 + 0x1234 % 5_000) as u16);
    }

    #[test]
    fn slip_frac_range() {
        for a in [0u8, 1, 127, 255] {
            for b in [0u8, 3, 200, 255] {
                let f = slip_frac_bps(&rnd(&[(2, a), (3, b)]));
                assert!((1_500..6_500).contains(&f), "f={f}");
            }
        }
    }

    #[test]
    fn slip_moves_toward_chute_and_persists_outside_keepout() {
        let (x, z) = (100, 100);
        let d0 = distance(x, z, CHUTE_X, CHUTE_Z);
        let (nx, nz) = slip_toward_chute(x, z, 5_000);
        assert_eq!((nx, nz), (500, 500));
        assert!(distance(nx, nz, CHUTE_X, CHUTE_Z) < d0);
        // Repeated slips converge on, but never enter, the keep-out circle.
        let (mut cx, mut cz) = (x, z);
        for _ in 0..50 {
            let (a, b) = slip_toward_chute(cx, cz, 6_499);
            assert!(distance(a, b, CHUTE_X, CHUTE_Z) >= (CHUTE_KEEP_OUT - 1) as u64);
            assert!(distance(a, b, CHUTE_X, CHUTE_Z) <= distance(cx, cz, CHUTE_X, CHUTE_Z));
            cx = a;
            cz = b;
        }
        // Capsule already at the chute centre is pushed to the keep-out edge.
        let (ax, az) = slip_toward_chute(CHUTE_X, CHUTE_Z, 1_500);
        assert_eq!(distance(ax, az, CHUTE_X, CHUTE_Z), CHUTE_KEEP_OUT as u64);
        // Zero fraction leaves the capsule where it is.
        assert_eq!(slip_toward_chute(300, 200, 0), (300, 200));
    }

    #[test]
    fn move_clamps_step_and_grid() {
        assert_eq!(apply_move(500, 500, 10, -10), (510, 490));
        assert_eq!(apply_move(500, 500, 1_000, -1_000), (580, 420));
        assert_eq!(apply_move(990, 5, 80, -80), (GRID, 0));
        assert_eq!(apply_move(i32::MAX, i32::MIN, i32::MAX, i32::MIN), (GRID, 0));
    }

    #[test]
    fn nudge_offset_range() {
        for b in 0..=255u8 {
            let o = nudge_offset(b);
            assert!((-NUDGE_MAX..=NUDGE_MAX).contains(&o));
        }
        assert_eq!(nudge_offset(0), -NUDGE_MAX);
        assert_eq!(nudge_offset(40), 0);
        assert_eq!(nudge_offset(80), NUDGE_MAX);
    }

    fn g(x: i32, z: i32, active: bool) -> Geo {
        Geo { x, z, radius: 60, active }
    }

    #[test]
    fn nearest_skips_inactive_and_breaks_ties_low() {
        let geos = [g(0, 0, false), g(100, 100, true), g(300, 300, true), g(100, 100, true)];
        assert_eq!(nearest(&geos, 110, 110), Some((1, 14)));
        assert_eq!(nearest(&geos, 290, 300), Some((2, 10)));
        assert_eq!(nearest(&[g(0, 0, false)], 0, 0), None);
        assert_eq!(nearest(&[], 0, 0), None);
    }

    #[test]
    fn nudge_targets_within_reach_max_two() {
        let geos = [g(100, 100, true), g(150, 100, true), g(120, 100, true), g(900, 900, true)];
        let t = nudge_targets(&geos, 120, 100);
        assert_eq!(t, [Some(0), Some(1)]);
        assert_eq!(nudge_targets(&geos, 500, 500), [None, None]);
        let inactive = [g(100, 100, false)];
        assert_eq!(nudge_targets(&inactive, 100, 100), [None, None]);
    }

    #[test]
    fn solvency_rule() {
        assert!(is_solvent(100, 0, 0, 100));
        assert!(!is_solvent(99, 0, 0, 100));
        assert!(is_solvent(50, 50, 30, 70));
        assert!(!is_solvent(50, 50, 31, 70));
        assert!(is_solvent(u64::MAX, u64::MAX, u64::MAX, u64::MAX)); // no overflow
        assert!(!is_solvent(0, 0, u64::MAX, 1));
    }
}
