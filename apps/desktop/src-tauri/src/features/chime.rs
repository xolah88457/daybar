//! Hourly chime: a notification at every whole hour outside quiet hours.
//!
//! One chime per real hour: every instant whose local clock reads `HH:00`. Across a DST change that
//! means no hour is skipped (spring forward: 01:00 then 03:00) and the repeated hour of a fall-back
//! day chimes twice, an hour apart; the ids carry the UTC offset so the two never collide.
//!
//! Sound: the notification plugin cannot mark a desktop notification silent. A notification with no
//! sound name plays none, so `sound: false` simply omits it and `sound: true` asks for the macOS
//! "Glass" sound (see [`sound`], used by the scheduler). Best-effort, not verifiable off macOS.
use super::{
    clock::{clock_label, in_window, minute_of_day, parse_clock, stamp},
    Alert, AlertKind,
};
use crate::{contracts::*, sleep};
use chrono::{DateTime, Local, TimeZone, Timelike};

pub const ID: &str = "hourlyChime";
/// How far ahead chimes are offered to the scheduler (it asks again every minute).
const HORIZON_HOURS: i64 = 24;
const STEP_MS: i64 = 15 * 60_000;

/// Every instant in the next [`HORIZON_HOURS`] whose local time is `HH:00` and that is not quiet.
pub fn fire_times<Tz: TimeZone>(cfg: &HourlyChimeConfig, now: &DateTime<Tz>) -> Vec<DateTime<Tz>> {
    let tz = now.timezone();
    let quiet = parse_clock(&cfg.quiet_start).zip(parse_clock(&cfg.quiet_end));
    // Offsets are whole multiples of 15 minutes, so every local HH:00 sits on the epoch 15-minute grid.
    let first = (now.timestamp_millis().div_euclid(STEP_MS) + 1) * STEP_MS;
    (0..HORIZON_HOURS * 4 + 1)
        .filter_map(|k| tz.timestamp_millis_opt(first + k * STEP_MS).single())
        .filter(|t| t.minute() == 0 && t.second() == 0)
        .filter(|t| !quiet.is_some_and(|(a, b)| in_window(minute_of_day(t), a, b)))
        .collect()
}

fn duration(mins: i64) -> String {
    if mins >= 60 {
        format!("{}h {}m", mins / 60, mins % 60)
    } else {
        format!("{mins}m")
    }
}

/// Time to bed when the Sleep module is on, otherwise nothing (no location, so no daylight).
fn body(s: &Snapshot, at: DateTime<Local>) -> String {
    if !s.preferences.features.sleep {
        return String::new();
    }
    match sleep::view(&s.sleep, &s.settings.sleep, at) {
        Ok(v) if !v.asleep && v.bed > at => {
            format!("{} until bed", duration((v.bed - at).num_minutes()))
        }
        Ok(v) if !v.asleep => "Past bedtime".into(),
        _ => String::new(),
    }
}

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let cfg = &s.preferences.features.hourly_chime;
    fire_times(cfg, &now)
        .into_iter()
        .map(|at| Alert {
            id: format!("{ID}:{}", stamp(&at)),
            at: at.timestamp_millis(),
            title: format!("It's {}", clock_label(&at)),
            body: body(s, at),
            kind: AlertKind::Feature {
                id: ID,
                key: if cfg.sound { "sound" } else { "silent" }.into(),
            },
        })
        .collect()
}

/// The notification sound for a chime alert; `None` (plain, no sound) for everything else.
pub fn sound(alert: &Alert) -> Option<&'static str> {
    match &alert.kind {
        AlertKind::Feature { id, key } if *id == ID && key == "sound" => Some("Glass"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::clock::testzone::*;
    use super::super::is_current;
    use super::*;
    use chrono::FixedOffset;

    fn cfg(start: &str, end: &str) -> HourlyChimeConfig {
        HourlyChimeConfig {
            enabled: true,
            quiet_start: start.into(),
            quiet_end: end.into(),
            sound: true,
        }
    }
    fn hours<Tz: TimeZone>(v: &[DateTime<Tz>]) -> Vec<u32> {
        v.iter().map(|t| t.hour()).collect()
    }
    fn snapshot() -> Snapshot {
        let mut s = super::super::clock::testzone::snapshot();
        s.preferences.features.hourly_chime.enabled = true;
        s
    }
    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        super::super::clock::testzone::local(y, m, d, h, min)
    }
    fn stamps<Tz: TimeZone>(times: &[DateTime<Tz>], n: usize) -> Vec<String>
    where
        Tz::Offset: std::fmt::Display,
    {
        times
            .iter()
            .take(n)
            .map(|t| t.format("%H:%M%:z").to_string())
            .collect()
    }

    #[test]
    fn quiet_hours_wrap_midnight_and_next_chime_is_strictly_future() {
        let now = at(11, 15, 6, 30);
        let times = fire_times(&cfg("22:00", "08:00"), &now);
        // 24h ahead from 06:30: 07:00 quiet, 08:00..21:00 chime, 22:00..06:00 quiet.
        assert_eq!(hours(&times), (8..=21).collect::<Vec<_>>());
        assert!(times.iter().all(|t| *t > now));
        // Exactly on the hour: that chime is not "from now onwards".
        let on_hour = at(11, 15, 9, 0);
        assert_eq!(
            fire_times(&cfg("22:00", "08:00"), &on_hour)[0],
            at(11, 15, 10, 0)
        );
        // A non-wrapping quiet window, and an empty one (no quiet hours at all).
        let day = fire_times(&cfg("12:00", "14:00"), &at(11, 15, 9, 30));
        assert!(!hours(&day).contains(&12) && !hours(&day).contains(&13));
        assert!(hours(&day).contains(&14));
        assert_eq!(fire_times(&cfg("00:00", "00:00"), &now).len(), 24);
    }
    #[test]
    fn spring_forward_skips_no_hour_and_repeats_none() {
        // 2026-03-08: 02:00 EST jumps to 03:00 EDT.
        let times = fire_times(&cfg("00:00", "00:00"), &at(3, 8, 0, 30));
        assert_eq!(
            stamps(&times, 5),
            [
                "01:00-05:00",
                "03:00-04:00",
                "04:00-04:00",
                "05:00-04:00",
                "06:00-04:00"
            ]
        );
        for pair in times.windows(2) {
            assert_eq!((pair[1].clone() - pair[0].clone()).num_minutes(), 60);
        }
    }
    #[test]
    fn fall_back_chimes_the_repeated_hour_once_each_an_hour_apart() {
        // 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:00 happens twice.
        let times = fire_times(&cfg("00:00", "00:00"), &at(11, 1, 0, 30));
        assert_eq!(
            stamps(&times, 4),
            ["01:00-04:00", "01:00-05:00", "02:00-05:00", "03:00-05:00"]
        );
        let ids: std::collections::BTreeSet<_> = times.iter().map(stamp).collect();
        assert_eq!(
            ids.len(),
            times.len(),
            "ids are unique across the repeated hour"
        );
        for pair in times.windows(2) {
            assert_eq!((pair[1].clone() - pair[0].clone()).num_minutes(), 60);
        }
    }
    #[test]
    fn half_hour_zones_chime_on_the_local_hour() {
        let india = FixedOffset::east_opt(19800).unwrap();
        let now = india.with_ymd_and_hms(2026, 11, 15, 9, 10, 0).unwrap();
        let times = fire_times(&cfg("22:00", "08:00"), &now);
        assert_eq!(
            times[0],
            india.with_ymd_and_hms(2026, 11, 15, 10, 0, 0).unwrap()
        );
        assert!(times.iter().all(|t| t.minute() == 0));
    }
    #[test]
    fn alerts_have_unique_ids_titles_and_a_sound_key() {
        let s = snapshot();
        let now = local(2026, 11, 15, 14, 20);
        let all = alerts(&s, now);
        assert!(!all.is_empty());
        let ids: std::collections::BTreeSet<_> = all.iter().map(|a| a.id.clone()).collect();
        assert_eq!(ids.len(), all.len());
        assert!(all
            .iter()
            .all(|a| a.at > now.timestamp_millis() && a.id.starts_with("hourlyChime:2026-")));
        let three = all
            .iter()
            .find(|a| a.title == "It's 3 pm")
            .expect("3 pm chime");
        assert_eq!(three.at, local(2026, 11, 15, 15, 0).timestamp_millis());
        assert_eq!(sound(three), Some("Glass"));
        let mut quiet = snapshot();
        quiet.preferences.features.hourly_chime.sound = false;
        assert_eq!(sound(&alerts(&quiet, now)[0]), None);
        let other = Alert {
            kind: AlertKind::Focus,
            ..three.clone()
        };
        assert_eq!(sound(&other), None);
    }
    #[test]
    fn body_is_time_to_bed_only_while_sleep_is_on() {
        let mut s = snapshot();
        let now = local(2026, 11, 15, 14, 20);
        // Wake logged at 08:00 and the default 16 awake hours: bed at midnight.
        s.sleep.wakes.insert("2026-11-15".into(), 8 * 60);
        let three = alerts(&s, now)
            .into_iter()
            .find(|a| a.title == "It's 3 pm")
            .unwrap();
        assert_eq!(three.body, "9h 0m until bed");
        s.preferences.features.sleep = false;
        let three = alerts(&s, now)
            .into_iter()
            .find(|a| a.title == "It's 3 pm")
            .unwrap();
        assert_eq!(three.body, "");
    }
    #[test]
    fn revalidation_follows_quiet_hours_and_the_switch() {
        let mut s = snapshot();
        let now = local(2026, 11, 15, 14, 20);
        let alert = alerts(&s, now)
            .into_iter()
            .find(|a| a.title == "It's 3 pm")
            .unwrap();
        assert!(is_current(&alert, &s));
        let f = &mut s.preferences.features.hourly_chime;
        f.quiet_start = "14:00".into();
        f.quiet_end = "16:00".into();
        assert!(!is_current(&alert, &s), "now inside quiet hours");
        let f = &mut s.preferences.features.hourly_chime;
        f.quiet_start = "22:00".into();
        f.quiet_end = "08:00".into();
        assert!(is_current(&alert, &s));
        s.preferences.features.hourly_chime.enabled = false;
        assert!(!is_current(&alert, &s));
    }
}
