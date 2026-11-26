//! Shared game constants. Mirrored 1:1 in `app/src/lib/constants.ts` and `scripts/lib/math.ts`.

/// Cabinet floor is a GRID x GRID square in integer grid units.
pub const GRID: i32 = 1000;
/// Prize chute (front-right corner). Capsules that slip move toward this point.
pub const CHUTE_X: i32 = 900;
pub const CHUTE_Z: i32 = 900;
/// Capsules never slip closer than this to the chute centre (they stay on the floor).
pub const CHUTE_KEEP_OUT: i32 = 90;
/// Max claw travel per `move_claw` tx, per axis.
pub const MAX_STEP: i32 = 80;
/// Claw parks here at the start of each turn.
pub const CLAW_HOME_X: i32 = 120;
pub const CLAW_HOME_Z: i32 = 120;

pub const MAX_CAPSULES: usize = 12;
pub const QUEUE_LEN: usize = 16;
pub const NUM_MINTS: usize = 4;
pub const RECENT_WINS: usize = 5;

pub const BPS: u64 = 10_000;
/// Slip pulls the capsule this fraction of the way to the chute: [SLIP_MIN_BPS, SLIP_MIN_BPS + SLIP_SPAN_BPS).
pub const SLIP_MIN_BPS: u64 = 1_500;
pub const SLIP_SPAN_BPS: u64 = 5_000;
/// A miss nudges capsules whose centre lies within NUDGE_RADIUS_BPS of their radius from the claw.
pub const NUDGE_RADIUS_BPS: u64 = 15_000;
pub const NUDGE_MAX: i32 = 40;
pub const MAX_NUDGED: usize = 2;
pub const MIN_RADIUS: u16 = 30;
pub const MAX_RADIUS: u16 = 120;

/// If the VRF callback has not landed this many seconds after a drop, anyone may cancel the drop.
pub const VRF_TIMEOUT_SECS: i64 = 30;
/// Session keys may live at most this long.
pub const MAX_SESSION_SECS: i64 = 24 * 60 * 60;
/// Demo faucet: amount (base units of mint 0) and cooldown.
pub const FAUCET_AMOUNT: u64 = 20_000_000;
pub const FAUCET_COOLDOWN_SECS: i64 = 60 * 60;
pub const MAX_CREDITS_PER_BUY: u32 = 50;

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_CABINET: &[u8] = b"cabinet";
pub const SEED_MYSTERY: &[u8] = b"mystery";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_PLAYER: &[u8] = b"player";
pub const SEED_FAUCET: &[u8] = b"faucet";

/// Capsule kinds.
pub const KIND_TOKEN: u8 = 0;
pub const KIND_COLLECTIBLE: u8 = 1;
pub const KIND_MYSTERY: u8 = 2;

/// Outcomes.
pub const OUTCOME_NONE: u8 = 0;
pub const OUTCOME_HELD: u8 = 1;
pub const OUTCOME_SLIP: u8 = 2;
pub const OUTCOME_MISS: u8 = 3;

pub const NO_CAPSULE: u8 = 255;
