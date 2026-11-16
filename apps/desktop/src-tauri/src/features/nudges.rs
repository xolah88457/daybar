//! Movement nudges during active hours.
//!
//! Stub: owned by the `movementNudges` feature. Fill in `alerts`; see `features/mod.rs` for the contract.
use super::Alert;
use crate::contracts::Snapshot;
use chrono::{DateTime, Local};

pub const ID: &str = "movementNudges";

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(_s: &Snapshot, _now: DateTime<Local>) -> Vec<Alert> {
    Vec::new()
}
