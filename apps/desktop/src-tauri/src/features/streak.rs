//! Streak saver: nudge shortly before bed when today's habits are unfinished.
//!
//! Stub: owned by the `streakSaver` feature. Fill in `alerts`; see `features/mod.rs` for the contract.
use super::Alert;
use crate::contracts::Snapshot;
use chrono::{DateTime, Local};

pub const ID: &str = "streakSaver";

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(_s: &Snapshot, _now: DateTime<Local>) -> Vec<Alert> {
    Vec::new()
}
