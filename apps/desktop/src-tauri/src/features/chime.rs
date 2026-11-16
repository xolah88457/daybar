//! Hourly chime.
//!
//! Stub: owned by the `hourlyChime` feature. Fill in `alerts`; see `features/mod.rs` for the contract.
use super::Alert;
use crate::contracts::Snapshot;
use chrono::{DateTime, Local};

pub const ID: &str = "hourlyChime";

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(_s: &Snapshot, _now: DateTime<Local>) -> Vec<Alert> {
    Vec::new()
}
