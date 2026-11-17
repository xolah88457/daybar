use crate::contracts::*;
use chrono::{NaiveDate, TimeZone, Utc};
use std::collections::BTreeSet;

pub type Result<T> = std::result::Result<T, String>;
pub fn ensure(ok: bool, message: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(message.into())
    }
}
pub fn date(s: &str) -> Result<()> {
    ensure(
        s.len() == 10
            && s.as_bytes()[4] == b'-'
            && s.as_bytes()[7] == b'-'
            && s.bytes()
                .enumerate()
                .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
            && &s[..4] >= "0100"
            && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok(),
        "Invalid calendar date",
    )
}
pub fn name(s: &mut String) -> Result<()> {
    *s = s.trim().to_owned();
    ensure(
        !s.is_empty() && s.encode_utf16().count() <= 120,
        "Invalid task/title name",
    )
}
fn names(xs: &mut [String]) -> Result<()> {
    for x in xs {
        name(x)?;
    }
    Ok(())
}
fn positive(n: u32) -> Result<()> {
    ensure((1..=240).contains(&n), "Minutes must be 1–240")
}
fn clock(s: &str) -> bool {
    s.len() == 5
        && s.as_bytes()[2] == b':'
        && s.bytes()
            .enumerate()
            .all(|(i, b)| i == 2 || b.is_ascii_digit())
        && s[..2].parse::<u32>().is_ok_and(|h| h < 24)
        && s[3..].parse::<u32>().is_ok_and(|m| m < 60)
}
pub trait Validate {
    fn validate(&mut self) -> Result<()>;
}
impl Validate for Settings {
    fn validate(&mut self) -> Result<()> {
        ensure(self.schema_version == 1, "Unknown settings schema version")?;
        let c = &mut self.countdown;
        date(&c.start_date)?;
        date(&c.end_date)?;
        name(&mut c.title)?;
        ensure(c.end_date >= c.start_date, "End date precedes start date")?;
        let h = &mut self.habits;
        date(&h.start_date)?;
        if !h.end_date.is_empty() {
            date(&h.end_date)?;
            ensure(h.end_date >= h.start_date, "End date precedes start date")?;
        }
        name(&mut h.title)?;
        ensure(
            !h.log_id.is_empty()
                && h.log_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
            "Invalid log ID",
        )?;
        names(&mut h.tasks)?;
        names(&mut h.archived_tasks)?;
        ensure(
            !h.tasks.is_empty() && h.tasks.iter().collect::<BTreeSet<_>>().len() == h.tasks.len(),
            "Empty or duplicate tasks",
        )?;
        ensure(
            h.day_complete_min > 0 && h.day_complete_min as usize <= h.tasks.len(),
            "Invalid completion minimum",
        )?;
        let mut thresholds = std::collections::BTreeMap::new();
        for (mut task, n) in std::mem::take(&mut h.focus_thresholds) {
            name(&mut task)?;
            ensure((1..=1440).contains(&n), "Invalid focus threshold")?;
            thresholds.insert(task, n);
        }
        h.focus_thresholds = thresholds;
        let f = &mut self.focus;
        name(&mut f.title)?;
        positive(f.block_minutes)?;
        for xs in [&f.focus_options, &f.break_options, &f.long_break_options] {
            ensure(!xs.is_empty(), "Empty presets")?;
            for &n in xs {
                positive(n)?;
            }
        }
        let s = &mut self.sleep;
        name(&mut s.title)?;
        ensure(
            (1.0..=24.0).contains(&s.awake_hours) && (1.0..=24.0).contains(&s.sleep_hours),
            "Invalid awake/sleep hours",
        )?;
        ensure(
            clock(&s.target_wake) && (s.target_bed.is_empty() || clock(&s.target_bed)),
            "Invalid clock time",
        )?;
        positive(s.step_minutes)?;
        ensure(
            (1..=365).contains(&s.average_days)
                && s.routine_minutes <= 1440
                && s.no_phone_minutes <= s.routine_minutes,
            "Invalid sleep phases/average",
        )?;
        let a = &self.appearance;
        for c in [
            &a.background,
            &a.text,
            &a.green,
            &a.blue,
            &a.red,
            &a.orange,
            &a.yellow,
        ] {
            ensure(
                c.len() == 7
                    && c.starts_with('#')
                    && c.bytes().skip(1).all(|b| b.is_ascii_hexdigit()),
                "Invalid colour",
            )?;
        }
        ensure(
            [a.empty_opacity, a.min_done_opacity, a.future_opacity]
                .iter()
                .all(|n| (0.0..=1.0).contains(n))
                && a.rows == 7
                && (3.0..=30.0).contains(&a.cell_size)
                && (0.0..=10.0).contains(&a.gap)
                && (0.0..=10.0).contains(&a.radius),
            "Invalid appearance",
        )
    }
}
impl Validate for DailyLogFile {
    fn validate(&mut self) -> Result<()> {
        match self {
            Self::Current(map) => {
                for (d, tasks) in map {
                    date(d)?;
                    names(tasks)?;
                }
            }
            Self::Legacy(ds) => {
                for d in ds {
                    date(d)?;
                }
            }
        }
        Ok(())
    }
}
impl Validate for FocusData {
    fn validate(&mut self) -> Result<()> {
        if let Some(s) = &mut self.state {
            ensure(
                s.r#type == "focus" || s.r#type == "break",
                "Invalid timer type",
            )?;
            positive(s.minutes)?;
            ensure(
                s.start >= 0
                    && s.end > s.start
                    && s.end.checked_sub(s.start) == Some(i64::from(s.minutes) * 60_000),
                "Invalid timer timestamps/duration",
            )?;
            crate::focus::date_at(s.start)?;
            crate::focus::date_at(s.end)?;
            if let Some(t) = &mut s.task {
                name(t)?;
            }
        }
        for map in [Some(&self.days), self.baseline.as_ref()]
            .into_iter()
            .flatten()
        {
            for d in map.keys() {
                date(d)?;
            }
        }
        if let Some(map) = &mut self.sessions {
            for (id, s) in map {
                ensure(
                    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()),
                    "Invalid session key",
                )?;
                date(&s.date)?;
                positive(s.minutes)?;
                let start = id.parse::<i64>().map_err(|_| "Session key out of range")?;
                ensure(
                    start.to_string() == *id
                        && start <= s.end
                        && s.end
                            .checked_sub(start)
                            .is_some_and(|elapsed| elapsed <= i64::from(s.minutes) * 60_000),
                    "Invalid session timestamps/duration",
                )?;
                let utc_day = Utc
                    .timestamp_millis_opt(s.end)
                    .single()
                    .ok_or("Invalid session timestamp")?
                    .date_naive();
                let recorded_day =
                    NaiveDate::parse_from_str(&s.date, "%Y-%m-%d").map_err(|e| e.to_string())?;
                // A shared ledger may have been written in another timezone; all civil zones fit UTC ±1 day.
                ensure(
                    (recorded_day - utc_day).num_days().abs() <= 1,
                    "Session date disagrees with end timestamp",
                )?;
                ensure(
                    s.end >= 0
                        && s.credited_minutes <= s.minutes
                        && i64::from(s.credited_minutes) * 60_000 <= s.end - start
                        && (s.r#type == "focus" || s.r#type == "break" && s.credited_minutes == 0),
                    "Invalid session credit/type",
                )?;
                if let Some(t) = &mut s.task {
                    name(t)?;
                }
            }
        }
        crate::focus::normalize(&mut self.clone(), 1)?;
        Ok(())
    }
}
impl Validate for SleepData {
    fn validate(&mut self) -> Result<()> {
        for map in [&self.wakes, &self.beds] {
            for (d, &m) in map {
                date(d)?;
                ensure(m < 1440, "Invalid minutes of day")?;
            }
        }
        if let Some(p) = &self.plan {
            date(&p.start)?;
            ensure(p.wake < 1440 && p.bed < 1440, "Invalid plan minutes")?;
        }
        Ok(())
    }
}
impl Validate for Preferences {
    fn validate(&mut self) -> Result<()> {
        ensure(
            !self.data_folder.is_empty() && !self.data_folder.contains('\0'),
            "Choose a data folder",
        )?;
        self.features.validate()
    }
}
fn in_range(n: u32, lo: u32, hi: u32, message: &str) -> Result<()> {
    ensure((lo..=hi).contains(&n), message)
}
fn clock_field(s: &str, message: &str) -> Result<()> {
    ensure(clock(s), message)
}
fn name_list(xs: &mut [String], message: &str) -> Result<()> {
    ensure(xs.len() <= 100, message)?;
    names(xs)
}
fn shortcut_name(s: &str) -> Result<()> {
    ensure(
        s.encode_utf16().count() <= 120 && !s.contains('\0'),
        "Shortcut names can be at most 120 characters",
    )
}
/// Mirrors `featuresSchema` (packages/core/src/contracts/index.ts). Keep limits identical.
impl Validate for Features {
    fn validate(&mut self) -> Result<()> {
        let r = &mut self.radar;
        name_list(&mut r.calendars, "Radar: at most 100 calendars")?;
        name_list(&mut r.reminder_lists, "Radar: at most 100 reminder lists")?;
        name_list(&mut r.keywords, "Radar: at most 100 keywords")?;
        in_range(r.days_ahead, 1, 365, "Radar: days ahead must be 1–365")?;
        in_range(
            r.overdue_days_back,
            0,
            90,
            "Radar: overdue days back must be 0–90",
        )?;
        clock_field(&r.alert_time, "Radar: alert time must be HH:MM")?;
        let c = &self.hourly_chime;
        ensure(
            clock(&c.quiet_start) && clock(&c.quiet_end),
            "Hourly chime: quiet hours must be HH:MM",
        )?;
        let k = &self.check_ins;
        ensure(
            (k.morning_time.is_empty() || clock(&k.morning_time))
                && (k.evening_time.is_empty() || clock(&k.evening_time)),
            "Check-ins: times must be HH:MM or empty",
        )?;
        in_range(
            self.streak_saver.minutes_before_bed,
            0,
            720,
            "Streak saver: minutes before bed must be 0–720",
        )?;
        in_range(
            self.auto_cycle.long_break_every,
            2,
            12,
            "Auto-cycle: long break every must be 2–12",
        )?;
        shortcut_name(&self.focus_shortcuts.on_start)?;
        shortcut_name(&self.focus_shortcuts.on_end)?;
        in_range(
            self.away_detection.idle_minutes,
            1,
            60,
            "Away detection: idle minutes must be 1–60",
        )?;
        let m = &self.movement_nudges;
        in_range(
            m.interval_minutes,
            10,
            240,
            "Movement nudges: interval must be 10–240 minutes",
        )?;
        ensure(
            clock(&m.active_start) && clock(&m.active_end),
            "Movement nudges: active hours must be HH:MM",
        )?;
        let items = &mut self.extra_countdowns.items;
        ensure(items.len() <= 12, "At most 12 extra countdowns")?;
        let mut ids = BTreeSet::new();
        for item in items.iter_mut() {
            ensure(
                !item.id.is_empty()
                    && item.id.len() <= 40
                    && item
                        .id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
                "Invalid countdown ID",
            )?;
            ensure(ids.insert(item.id.clone()), "Duplicate countdown IDs")?;
            name(&mut item.title)?;
            date(&item.start_date)?;
            date(&item.end_date)?;
            ensure(
                item.end_date >= item.start_date,
                "End date precedes start date",
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_and_settings_boundaries() {
        for s in [
            "2025-02-29",
            "0001-01-01",
            "2026-1-01",
            "2026-11-31",
            "../escape",
        ] {
            assert!(date(s).is_err());
        }
        date("2024-02-29").unwrap();
        let mut s = Settings::default();
        s.validate().unwrap();
        s.sleep.no_phone_minutes = 121;
        assert!(s.validate().is_err());
        s.sleep.no_phone_minutes = 60;
        s.habits.tasks.push(" Read a chapter ".into());
        assert!(s.validate().is_err());
    }
    fn prefs() -> Preferences {
        serde_json::from_str(
            r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
        )
        .unwrap()
    }
    #[test]
    fn default_features_validate_and_boundaries_hold() {
        let mut p = prefs();
        p.validate().unwrap();
        let mut f = p.features.clone();
        f.radar.days_ahead = 365;
        f.radar.overdue_days_back = 0;
        f.check_ins.morning_time = String::new();
        f.streak_saver.minutes_before_bed = 720;
        f.auto_cycle.long_break_every = 12;
        f.movement_nudges.interval_minutes = 240;
        f.focus_shortcuts.on_start = "x".repeat(120);
        f.validate().unwrap();
    }
    #[test]
    fn invalid_features_are_rejected_with_a_clear_message() {
        type Edit = fn(&mut Features);
        let cases: [(Edit, &str); 14] = [
            (|f| f.radar.days_ahead = 0, "days ahead"),
            (|f| f.radar.days_ahead = 366, "days ahead"),
            (|f| f.radar.overdue_days_back = 91, "overdue"),
            (|f| f.radar.alert_time = "9:00".into(), "alert time"),
            (|f| f.radar.keywords = vec!["  ".into()], "name"),
            (|f| f.hourly_chime.quiet_end = "24:00".into(), "quiet hours"),
            (|f| f.check_ins.evening_time = "20:60".into(), "Check-ins"),
            (|f| f.streak_saver.minutes_before_bed = 721, "bed"),
            (|f| f.auto_cycle.long_break_every = 1, "Auto-cycle"),
            (|f| f.focus_shortcuts.on_end = "x".repeat(121), "120"),
            (|f| f.away_detection.idle_minutes = 61, "idle"),
            (|f| f.movement_nudges.interval_minutes = 9, "interval"),
            (
                |f| f.movement_nudges.active_start = "nine".into(),
                "active hours",
            ),
            (
                |f| {
                    let item = ExtraCountdown {
                        id: "a b".into(),
                        title: "T".into(),
                        start_date: "2026-01-01".into(),
                        end_date: "2026-02-01".into(),
                    };
                    f.extra_countdowns.items = vec![item];
                },
                "countdown ID",
            ),
        ];
        for (edit, expect) in cases {
            let mut p = prefs();
            edit(&mut p.features);
            let err = p.validate().unwrap_err();
            assert!(
                err.to_lowercase().contains(&expect.to_lowercase()),
                "{err} should mention {expect}"
            );
        }
    }
    #[test]
    fn extra_countdowns_are_normalised_and_bounded() {
        let item = |id: &str, start: &str, end: &str| ExtraCountdown {
            id: id.into(),
            title: "  Trip  ".into(),
            start_date: start.into(),
            end_date: end.into(),
        };
        let mut p = prefs();
        p.features.extra_countdowns.items = vec![item("a-1_B", "2026-01-01", "2026-01-01")];
        p.validate().unwrap();
        assert_eq!(p.features.extra_countdowns.items[0].title, "Trip");
        p.features.extra_countdowns.items = vec![item("a", "2026-02-01", "2026-01-01")];
        assert!(p.validate().is_err());
        p.features.extra_countdowns.items = vec![item("a", "2026-02-30", "2026-03-01")];
        assert!(p.validate().is_err());
        p.features.extra_countdowns.items = vec![
            item("a", "2026-01-01", "2026-02-01"),
            item("a", "2026-01-01", "2026-02-01"),
        ];
        assert!(p.validate().is_err());
        p.features.extra_countdowns.items = (0..13)
            .map(|i| item(&format!("c{i}"), "2026-01-01", "2026-02-01"))
            .collect();
        assert!(p.validate().is_err());
        p.features.extra_countdowns.items.truncate(12);
        p.validate().unwrap();
        p.features.extra_countdowns.items[0].id = "x".repeat(41);
        assert!(p.validate().is_err());
    }
    /// Zod's `.max(120)` counts UTF-16 code units: a 120-character non-ASCII name (several bytes
    /// each) is valid, and an emoji counts as two units.
    #[test]
    fn feature_name_limits_count_characters_like_zod_not_bytes() {
        let mut f = prefs().features;
        let name = "é".repeat(120); // 240 bytes
        f.focus_shortcuts.on_start = name.clone();
        f.radar.calendars = vec![name.clone()];
        f.radar.reminder_lists = vec!["日".repeat(120)];
        f.radar.keywords = vec![name.clone()];
        f.extra_countdowns.items = vec![ExtraCountdown {
            id: "a".into(),
            title: name,
            start_date: "2026-01-01".into(),
            end_date: "2026-02-01".into(),
        }];
        f.validate().unwrap();
        f.focus_shortcuts.on_start = "é".repeat(121);
        assert!(f.validate().is_err());
        f.focus_shortcuts.on_start = "😀".repeat(61); // 122 UTF-16 units
        assert!(f.validate().is_err());
        f.focus_shortcuts.on_start = "😀".repeat(60); // 120 units
        f.validate().unwrap();
    }
}
