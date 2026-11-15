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
        )
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
}
