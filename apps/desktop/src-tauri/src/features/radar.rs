//! Deadline Radar (calendar/reminder reading via EventKit, due-date alerts) and Room before an event.
//!
//! Stub: owned by the `radar` feature. Fill in `alerts`; see `features/mod.rs` for the contract.
use super::Alert;
use crate::contracts::Snapshot;
use chrono::{DateTime, Local};

pub const ID: &str = "radar";

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(_s: &Snapshot, _now: DateTime<Local>) -> Vec<Alert> {
    Vec::new()
}
