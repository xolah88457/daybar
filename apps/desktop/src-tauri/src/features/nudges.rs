//! Movement nudges during active hours.
//!
//! Every `intervalMinutes`, counted from `activeStart`, on every day, for slots inside the active
//! window `[activeStart, activeEnd)` (which may wrap midnight; equal times are an empty window). Slots
//! are wall-clock times: on a clock-change day a slot that does not exist fires when the clock jumps
//! and one that repeats fires once. A slot is skipped while a focus timer is running and, with the
//! Sleep module on, from the start of the no-phone / night-routine window onwards. Quiet hours of the
//! hourly chime play no part here: the features stay independent.
use super::{
    clock::{local_at, parse_clock, stamp},
    Alert, AlertKind,
};
use crate::{contracts::*, sleep};
use chrono::{DateTime, Duration, Local, TimeZone};

pub const ID: &str = "movementNudges";
const HORIZON_HOURS: i64 = 24;
const MINUTES_PER_DAY: u32 = 1440;

/// Short, varied bodies; the slot picks one deterministically (see [`pick`]).
const BODIES: [&str; 8] = [
    "Roll your shoulders and look away from the screen.",
    "A glass of water and a few deep breaths.",
    "Walk to the window and back.",
    "Reach up high, then touch your toes.",
    "Take a short lap around the room.",
    "Shake out your hands and wrists.",
    "Stretch your neck and straighten your back.",
    "Two minutes on your feet is plenty.",
];

/// Every slot in the next [`HORIZON_HOURS`], ascending, with no two at the same instant.
pub fn slots<Tz: TimeZone>(cfg: &MovementNudgesConfig, now: &DateTime<Tz>) -> Vec<DateTime<Tz>> {
    let (Some(start), Some(end)) = (parse_clock(&cfg.active_start), parse_clock(&cfg.active_end))
    else {
        return Vec::new();
    };
    let length = (end + MINUTES_PER_DAY - start) % MINUTES_PER_DAY;
    if cfg.interval_minutes == 0 || length == 0 {
        return Vec::new();
    }
    let tz = now.timezone();
    let limit = now.clone() + Duration::hours(HORIZON_HOURS);
    let mut out: Vec<DateTime<Tz>> = Vec::new();
    // Yesterday's window can still be running (wrapping windows); tomorrow's may start within the horizon.
    for day in -1..=1 {
        let Some(date) = now.date_naive().checked_add_signed(Duration::days(day)) else {
            continue;
        };
        let mut offset = 0;
        while offset < length {
            let minutes = start + offset;
            let day_shift = Duration::days(i64::from(minutes / MINUTES_PER_DAY));
            if let Some(at) = date
                .checked_add_signed(day_shift)
                .and_then(|d| local_at(&tz, d, minutes % MINUTES_PER_DAY))
            {
                if at > *now && at <= limit {
                    out.push(at);
                }
            }
            offset += cfg.interval_minutes;
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Deterministic variety: consecutive slots always get different bodies.
fn pick(at_ms: i64, interval: u32) -> &'static str {
    let slot = (at_ms / 60_000).div_euclid(i64::from(interval.max(1)));
    BODIES[slot.rem_euclid(BODIES.len() as i64) as usize]
}

/// Whether a focus timer is running at `at` (only while the Focus module is on).
fn during_focus(s: &Snapshot, at: DateTime<Local>) -> bool {
    s.preferences.features.focus
        && s.focus
            .state
            .as_ref()
            .is_some_and(|t| t.r#type == "focus" && at.timestamp_millis() < t.end)
}

/// Whether `at` is inside the no-phone / night-routine window before bed, or past bedtime
/// (only while the Sleep module is on).
fn during_routine(s: &Snapshot, at: DateTime<Local>) -> bool {
    if !s.preferences.features.sleep {
        return false;
    }
    let lead = s
        .settings
        .sleep
        .routine_minutes
        .max(s.settings.sleep.no_phone_minutes);
    sleep::view(&s.sleep, &s.settings.sleep, at)
        .is_ok_and(|v| !v.asleep && at >= v.bed - Duration::minutes(i64::from(lead)))
}

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let cfg = &s.preferences.features.movement_nudges;
    slots(cfg, &now)
        .into_iter()
        .filter(|at| !during_focus(s, *at) && !during_routine(s, *at))
        .map(|at| Alert {
            id: format!("{ID}:{}", stamp(&at)),
            at: at.timestamp_millis(),
            title: "Stand up and stretch".into(),
            body: pick(at.timestamp_millis(), cfg.interval_minutes).into(),
            kind: AlertKind::Feature {
                id: ID,
                key: String::new(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::clock::testzone::{self, at, local};
    use super::super::is_current;
    use super::*;
    use chrono::Timelike;

    fn cfg(interval: u32, start: &str, end: &str) -> MovementNudgesConfig {
        MovementNudgesConfig {
            enabled: true,
            interval_minutes: interval,
            active_start: start.into(),
            active_end: end.into(),
        }
    }
    fn snapshot() -> Snapshot {
        let mut s = testzone::snapshot();
        s.preferences.features.movement_nudges = cfg(50, "09:00", "18:00");
        s
    }
    fn clocks<Tz: TimeZone>(v: &[DateTime<Tz>]) -> Vec<String>
    where
        Tz::Offset: std::fmt::Display,
    {
        v.iter().map(|t| t.format("%d %H:%M").to_string()).collect()
    }
    fn timer(kind: &str, start: DateTime<Local>, minutes: i64) -> TimerState {
        TimerState {
            r#type: kind.into(),
            minutes: minutes as u32,
            start: start.timestamp_millis(),
            end: (start + Duration::minutes(minutes)).timestamp_millis(),
            task: None,
        }
    }

    #[test]
    fn slots_align_to_the_start_and_stay_inside_the_window_every_day() {
        let found = slots(&cfg(50, "09:00", "18:00"), &at(11, 15, 8, 0));
        assert_eq!(
            clocks(&found),
            [
                "15 09:00", "15 09:50", "15 10:40", "15 11:30", "15 12:20", "15 13:10", "15 14:00",
                "15 14:50", "15 15:40", "15 16:30", "15 17:20"
            ]
        );
        // The window repeats on the next day within the 24 hour horizon.
        let later = slots(&cfg(50, "09:00", "18:00"), &at(11, 15, 18, 0));
        assert_eq!(clocks(&later)[0], "16 09:00");
        assert!(later.iter().all(|t| t.hour() >= 9 && t.hour() < 18));
        // Interval limits from the schema.
        assert_eq!(
            slots(&cfg(240, "09:00", "18:00"), &at(11, 15, 8, 0)).len(),
            3
        );
        assert_eq!(
            slots(&cfg(10, "09:00", "10:00"), &at(11, 15, 8, 0)).len(),
            6
        );
    }
    #[test]
    fn the_end_is_exclusive_and_now_is_not_a_slot() {
        let found = slots(&cfg(60, "09:00", "12:00"), &at(11, 15, 9, 0));
        assert_eq!(clocks(&found)[..2], ["15 10:00", "15 11:00"]);
        assert!(!clocks(&found).contains(&"15 12:00".to_string()));
    }
    #[test]
    fn windows_wrapping_midnight_keep_their_slots() {
        let found = slots(&cfg(60, "22:00", "02:00"), &at(11, 15, 21, 0));
        assert_eq!(
            clocks(&found),
            ["15 22:00", "15 23:00", "16 00:00", "16 01:00"]
        );
        // From inside the wrapped part, yesterday's window still supplies the rest.
        let inside = slots(&cfg(60, "22:00", "02:00"), &at(11, 16, 0, 30));
        assert_eq!(clocks(&inside)[..2], ["16 01:00", "16 22:00"]);
    }
    #[test]
    fn empty_windows_and_bad_times_give_nothing() {
        assert!(slots(&cfg(50, "09:00", "09:00"), &at(11, 15, 8, 0)).is_empty());
        assert!(slots(&cfg(50, "9:00", "18:00"), &at(11, 15, 8, 0)).is_empty());
    }
    #[test]
    fn clock_changes_neither_duplicate_nor_lose_a_slot() {
        // Spring forward 2026-03-08: wall slots 01:00, 02:00 (missing), 03:00 ... 02:00 resolves to 03:00,
        // which is also the 03:00 slot, so it appears once.
        let found = slots(&cfg(60, "01:00", "05:00"), &at(3, 8, 0, 0));
        assert_eq!(clocks(&found)[..3], ["08 01:00", "08 03:00", "08 04:00"]);
        // Fall back 2026-11-01: the repeated 01:00 hour fires its slot once, at the first 01:00.
        let found = slots(&cfg(60, "00:00", "03:00"), &at(10, 31, 23, 0));
        assert_eq!(clocks(&found)[..3], ["01 00:00", "01 01:00", "01 02:00"]);
        assert_eq!(found[1].format("%:z").to_string(), "-04:00");
    }
    #[test]
    fn alerts_have_unique_ids_stable_text_and_varied_bodies() {
        let s = snapshot();
        let now = local(2026, 11, 15, 8, 0);
        let all = alerts(&s, now);
        assert_eq!(all.len(), 11);
        let ids: std::collections::BTreeSet<_> = all.iter().map(|a| a.id.clone()).collect();
        assert_eq!(ids.len(), all.len());
        assert!(all
            .iter()
            .all(|a| a.title == "Stand up and stretch" && a.at > now.timestamp_millis()));
        assert_eq!(
            all[0].id,
            "movementNudges:2026-11-15T09:00".to_string()
                + &local(2026, 11, 15, 9, 0).format("%:z").to_string()
        );
        for pair in all.windows(2) {
            assert_ne!(pair[0].body, pair[1].body, "neighbouring nudges differ");
        }
        let again = alerts(&s, now);
        assert!(
            all.iter()
                .zip(&again)
                .all(|(a, b)| a.body == b.body && a.id == b.id),
            "deterministic"
        );
    }
    #[test]
    fn a_running_focus_timer_skips_slots_until_it_ends() {
        let mut s = snapshot();
        let now = local(2026, 11, 15, 9, 20);
        s.focus.state = Some(timer("focus", local(2026, 11, 15, 9, 10), 50)); // until 10:00
        let all = alerts(&s, now);
        assert_eq!(
            all[0].at,
            local(2026, 11, 15, 10, 40).timestamp_millis(),
            "09:50 skipped"
        );
        s.focus.state = Some(timer("break", local(2026, 11, 15, 9, 10), 50));
        assert_eq!(
            alerts(&s, now)[0].at,
            local(2026, 11, 15, 9, 50).timestamp_millis(),
            "breaks do not skip"
        );
        s.focus.state = Some(timer("focus", local(2026, 11, 15, 9, 10), 50));
        s.preferences.features.focus = false;
        assert_eq!(
            alerts(&s, now)[0].at,
            local(2026, 11, 15, 9, 50).timestamp_millis(),
            "Focus module off"
        );
    }
    #[test]
    fn starting_a_timer_cancels_a_pending_nudge_on_revalidation() {
        let mut s = snapshot();
        let nudge = alerts(&s, local(2026, 11, 15, 9, 20)).remove(0); // 09:50
        assert!(is_current(&nudge, &s));
        s.focus.state = Some(timer("focus", local(2026, 11, 15, 9, 30), 25));
        assert!(!is_current(&nudge, &s));
        s.focus.state = None;
        s.preferences.features.movement_nudges.active_end = "09:30".into();
        assert!(!is_current(&nudge, &s), "outside the window now");
        s.preferences.features.movement_nudges.active_end = "18:00".into();
        s.preferences.features.movement_nudges.enabled = false;
        assert!(!is_current(&nudge, &s));
    }
    #[test]
    fn the_routine_window_skips_slots_only_while_sleep_is_on() {
        let mut s = snapshot();
        // Wake 08:00, 16 awake hours: bed 24:00; routine 120 minutes: from 22:00.
        s.sleep.wakes.insert("2026-11-15".into(), 8 * 60);
        s.preferences.features.movement_nudges = cfg(60, "20:00", "23:30");
        let now = local(2026, 11, 15, 19, 0);
        let clock_of = |s: &Snapshot| -> Vec<String> {
            alerts(s, now)
                .iter()
                .map(|a| {
                    Local
                        .timestamp_millis_opt(a.at)
                        .unwrap()
                        .format("%H:%M")
                        .to_string()
                })
                .collect()
        };
        assert_eq!(
            clock_of(&s)[..2],
            ["20:00", "21:00"],
            "22:00 and 23:00 are inside the routine"
        );
        s.preferences.features.sleep = false;
        assert_eq!(clock_of(&s), ["20:00", "21:00", "22:00", "23:00"]);
    }
    #[test]
    fn nudges_ignore_the_hourly_chimes_quiet_hours() {
        let mut s = snapshot();
        s.preferences.features.hourly_chime.quiet_start = "08:00".into();
        s.preferences.features.hourly_chime.quiet_end = "20:00".into();
        assert_eq!(alerts(&s, local(2026, 11, 15, 8, 0)).len(), 11);
    }
}
