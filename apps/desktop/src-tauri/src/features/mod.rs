//! Rust-side seams for the toggleable features (see docs/ARCHITECTURE.md, "Features and toggles").
//!
//! Every feature that needs native behaviour owns one submodule below. The scheduler in
//! `runtime.rs` knows only this file: it merges [`alerts`] into its own deadlines and re-checks a
//! fired [`AlertKind::Feature`] alert through [`is_current`].
//!
//! Contract for a feature submodule (all of it is optional, stubs return nothing):
//! * `pub const ID: &str` is its camelCase key in `preferences.features` (see `Features::active`).
//! * `pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert>` returns the alerts the
//!   feature wants from `now` onwards. It is called only while the feature is active, so it need not
//!   check its own switch. It MUST be a pure function of `(snapshot, now)`: [`is_current`] re-asks it
//!   with `now = alert.at - 1ms` and keeps the alert only if the same `Alert.id` and `at` come back.
//!   `Alert.id` must be unique per occurrence (include the timestamp): the scheduler fires each id once.
//! * Tauri commands live in the submodule and are registered in `lib.rs` (`invoke_handler`).
// Seams are filled in feature by feature; until then most of this is intentionally unused.
#![allow(dead_code)]

use crate::contracts::Snapshot;
use chrono::{DateTime, Local, TimeZone};

pub mod autocycle;
pub mod away;
pub mod checkins;
pub mod clock;
pub mod chime;
pub mod export;
pub mod nudges;
pub mod radar;
pub mod shortcuts;
pub mod streak;

/// Which part of the app an alert belongs to; decides how the scheduler re-validates it before it fires.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AlertKind {
    /// Focus/break timer alert. Dropped while the Focus module is off.
    Focus,
    /// Routine / no-phone / bedtime alert. Dropped while the Sleep module is off.
    Sleep,
    /// Alert contributed by a feature. `id` is the feature id (e.g. `"radar"`), `key` is free-form
    /// feature data (for example an event identifier). Re-validated by asking [`alerts`] again.
    Feature { id: &'static str, key: String },
}

/// A notification the scheduler will show at `at` (epoch milliseconds) if it is still current.
#[derive(Clone, Debug)]
pub struct Alert {
    pub id: String,
    pub at: i64,
    pub title: String,
    pub body: String,
    pub kind: AlertKind,
}

/// All alerts the enabled features want from `now` onwards, in no particular order.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let f = &s.preferences.features;
    let mut out = Vec::new();
    for (id, contribute) in contributors() {
        if f.active(id) {
            out.extend(contribute(s, now));
        }
    }
    out
}

/// Whether a previously scheduled feature alert should still fire given the latest data.
pub fn is_current(alert: &Alert, latest: &Snapshot) -> bool {
    let AlertKind::Feature { id, .. } = &alert.kind else {
        return false;
    };
    if !latest.preferences.features.active(id) {
        return false;
    }
    let Some(before) = Local.timestamp_millis_opt(alert.at - 1).single() else {
        return false;
    };
    alerts(latest, before)
        .iter()
        .any(|a| a.id == alert.id && a.at == alert.at)
}

/// How late (ms) a feature alert may still be shown. The scheduler fires every due alert in one pass,
/// so after the Mac wakes from sleep each missed chime, nudge and check-in would otherwise appear at
/// once; an alert later than this is dropped silently instead. Radar "due" alerts stay useful for
/// hours (the event is still ahead), everything else is about "now" and is stale after two minutes.
/// `None` for the Focus and Sleep kinds: they keep their existing behaviour.
pub fn max_lateness_ms(alert: &Alert) -> Option<i64> {
    match &alert.kind {
        AlertKind::Feature { id, .. } if *id == radar::ID => Some(2 * 60 * 60_000),
        AlertKind::Feature { .. } => Some(2 * 60_000),
        AlertKind::Focus | AlertKind::Sleep => None,
    }
}

/// Whether `alert` is too late to be worth showing at `now_ms` (epoch milliseconds).
pub fn is_stale(alert: &Alert, now_ms: i64) -> bool {
    max_lateness_ms(alert).is_some_and(|max| now_ms - alert.at > max)
}

/// Whether `alert` depends on the data files (settings, logs, focus, sleep) being readable. Such an
/// alert is held back while any of those files has an issue. The chime, movement nudges and radar
/// read none of them, so an unrelated broken or not-yet-downloaded file must not silence them.
pub fn needs_clean_data(alert: &Alert) -> bool {
    match &alert.kind {
        AlertKind::Focus | AlertKind::Sleep => true,
        AlertKind::Feature { id, .. } => *id == checkins::ID || *id == streak::ID,
    }
}

type Contributor = fn(&Snapshot, DateTime<Local>) -> Vec<Alert>;
/// Register an alert-producing feature here (one line each).
fn contributors() -> [(&'static str, Contributor); 5] {
    [
        (radar::ID, radar::alerts),
        (chime::ID, chime::alerts),
        (checkins::ID, checkins::alerts),
        (streak::ID, streak::alerts),
        (nudges::ID, nudges::alerts),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Snapshot {
        Snapshot {
            settings: Default::default(),
            daily_log: Default::default(),
            focus: Default::default(),
            sleep: Default::default(),
            preferences: serde_json::from_str(
                r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
            )
            .unwrap(),
            issues: vec![],
            conflicts: vec![],
        }
    }

    #[test]
    fn stubs_contribute_nothing_even_when_radar_is_on() {
        let mut s = snapshot();
        let f = &mut s.preferences.features;
        f.radar.enabled = true;
        f.room_before_event.enabled = true;
        assert!(alerts(&s, Local::now()).is_empty());
    }

    #[test]
    fn feature_alerts_are_revalidated_through_the_aggregator() {
        let s = snapshot();
        let alert = Alert {
            id: "radar:1".into(),
            at: Local::now().timestamp_millis(),
            title: "t".into(),
            body: "b".into(),
            kind: AlertKind::Feature {
                id: "radar",
                key: "1".into(),
            },
        };
        // The stub no longer wants this alert, and non-feature kinds never pass through here.
        assert!(!is_current(&alert, &s));
        let focus = Alert {
            kind: AlertKind::Focus,
            ..alert
        };
        assert!(!is_current(&focus, &s));
    }

    fn alert(kind: AlertKind, at: i64) -> Alert {
        Alert {
            id: "x".into(),
            at,
            title: "t".into(),
            body: "b".into(),
            kind,
        }
    }
    fn feature(id: &'static str) -> AlertKind {
        AlertKind::Feature {
            id,
            key: String::new(),
        }
    }

    #[test]
    fn lateness_cutoffs_are_per_feature_and_leave_focus_and_sleep_alone() {
        let at = 1_000_000_000_000;
        for id in [chime::ID, nudges::ID, checkins::ID, streak::ID] {
            let a = alert(feature(id), at);
            assert!(!is_stale(&a, at + 120_000), "{id}: exactly 2 minutes is fine");
            assert!(is_stale(&a, at + 120_001), "{id}");
        }
        let radar = alert(feature(radar::ID), at);
        assert!(!is_stale(&radar, at + 7_200_000));
        assert!(is_stale(&radar, at + 7_200_001));
        for kind in [AlertKind::Focus, AlertKind::Sleep] {
            assert!(!is_stale(&alert(kind, at), at + 100 * 3_600_000));
        }
    }

    #[test]
    fn only_alerts_that_read_data_files_wait_for_clean_data() {
        for kind in [AlertKind::Focus, AlertKind::Sleep] {
            assert!(needs_clean_data(&alert(kind, 0)));
        }
        for id in [checkins::ID, streak::ID] {
            assert!(needs_clean_data(&alert(feature(id), 0)), "{id}");
        }
        for id in [chime::ID, nudges::ID, radar::ID] {
            assert!(!needs_clean_data(&alert(feature(id), 0)), "{id}");
        }
    }
}
