use anchor_lang::prelude::*;

#[error_code]
pub enum ClawError {
    #[msg("Not your turn")]
    NotYourTurn,
    #[msg("Turn has expired")]
    TurnExpired,
    #[msg("Turn has not expired yet")]
    TurnNotExpired,
    #[msg("A VRF grip roll is pending")]
    VrfPending,
    #[msg("No VRF roll is pending")]
    NoVrfPending,
    #[msg("VRF callback does not match the pending drop")]
    StaleVrfCallback,
    #[msg("Signer is neither the player nor a valid session key")]
    SessionKeyNotAllowed,
    #[msg("Session key expired")]
    SessionExpired,
    #[msg("Session duration too long")]
    SessionTooLong,
    #[msg("Not enough credits")]
    NoCredits,
    #[msg("Already queued")]
    AlreadyQueued,
    #[msg("Queue is full")]
    QueueFull,
    #[msg("Player is still queued or playing")]
    StillQueued,
    #[msg("Vault would be insolvent")]
    VaultInsolvent,
    #[msg("Prize exceeds max payout per round")]
    PayoutTooLarge,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid capsule spec")]
    InvalidCapsule,
    #[msg("No free capsule slot")]
    NoFreeSlot,
    #[msg("Wrong mint or token account")]
    WrongMint,
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Faucet cooldown")]
    FaucetCooldown,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Mystery vault not sealed")]
    NotSealed,
    #[msg("Profile belongs to another cabinet")]
    WrongCabinet,
    #[msg("Arithmetic overflow")]
    Overflow,
}
