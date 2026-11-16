//! Morning and evening check-in notifications.
//!
//! Stub: owned by the `checkIns` feature. Fill in `alerts`; see `features/mod.rs` for the contract.
use super::Alert;
use crate::contracts::Snapshot;
use chrono::{DateTime, Local};

pub const ID: &str = "checkIns";

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(_s: &Snapshot, _now: DateTime<Local>) -> Vec<Alert> {
    Vec::new()
}
