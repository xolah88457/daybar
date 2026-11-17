//! Wall-clock helpers shared by the notification features (chime, check-ins, nudges).
//!
//! Everything here is generic over the chrono `TimeZone` so tests can use a fixed zone with real DST
//! rules instead of depending on the `TZ` of the machine running them. The features call these with
//! `Local`.
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Timelike};

/// `"HH:MM"` to minutes after midnight. `None` for anything else (including `""`).
pub fn parse_clock(value: &str) -> Option<u32> {
    let (h, m) = value.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Whether `minute` (minutes after midnight) lies in the half-open window `[start, end)`. The window
/// may wrap midnight (`22:00`..`08:00`). `start == end` is an empty window.
pub fn in_window(minute: u32, start: u32, end: u32) -> bool {
    match start.cmp(&end) {
        std::cmp::Ordering::Equal => false,
        std::cmp::Ordering::Less => minute >= start && minute < end,
        std::cmp::Ordering::Greater => minute >= start || minute < end,
    }
}

/// Minutes after local midnight of an instant.
pub fn minute_of_day<Tz: TimeZone>(at: &DateTime<Tz>) -> u32 {
    at.hour() * 60 + at.minute()
}

/// The instant a local wall-clock time happens on `date`. A repeated time (clocks going back)
/// resolves to its first occurrence; a time that does not exist (clocks going forward) resolves to
/// the first instant after the gap, so the notification still fires once, when the clock jumps.
pub fn local_at<Tz: TimeZone>(tz: &Tz, date: NaiveDate, minutes: u32) -> Option<DateTime<Tz>> {
    let naive = date.and_hms_opt(minutes / 60, minutes % 60, 0)?;
    (0..=180).find_map(|extra| {
        tz.from_local_datetime(&(naive + Duration::minutes(extra)))
            .earliest()
    })
}

/// Stable per-occurrence id suffix: local date, time and UTC offset (distinguishes a repeated hour).
pub fn stamp<Tz: TimeZone>(at: &DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    at.format("%Y-%m-%dT%H:%M%:z").to_string()
}

/// "3 pm", "12 am" (hour only) or "3:30 pm".
pub fn clock_label<Tz: TimeZone>(at: &DateTime<Tz>) -> String {
    let (h, m) = (at.hour(), at.minute());
    let suffix = if h < 12 { "am" } else { "pm" };
    let h12 = if h % 12 == 0 { 12 } else { h % 12 };
    if m == 0 {
        format!("{h12} {suffix}")
    } else {
        format!("{h12}:{m:02} {suffix}")
    }
}

/// `"1 task"` / `"3 tasks"`.
pub fn tasks(n: usize) -> String {
    if n == 1 {
        "1 task".into()
    } else {
        format!("{n} tasks")
    }
}

/// A fixed-rule zone for tests: Toronto in 2026 (EST/EDT) with the real transition instants.
#[cfg(test)]
pub mod testzone {
    use chrono::{FixedOffset, LocalResult, NaiveDate, NaiveDateTime, Offset, TimeZone};
    use std::fmt;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Toronto;
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct TorontoOffset(pub i32);
    impl fmt::Display for TorontoOffset {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            fmt::Display::fmt(&FixedOffset::east_opt(self.0).unwrap(), f)
        }
    }
    impl Offset for TorontoOffset {
        fn fix(&self) -> FixedOffset {
            FixedOffset::east_opt(self.0).unwrap()
        }
    }
    const EST: i32 = -5 * 3600;
    const EDT: i32 = -4 * 3600;
    fn dt(m: u32, d: u32, h: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, m, d)
            .unwrap()
            .and_hms_opt(h, 0, 0)
            .unwrap()
    }
    /// DST: 2026-03-08 07:00Z until 2026-11-01 06:00Z.
    fn offset_at_utc(utc: &NaiveDateTime) -> i32 {
        if *utc >= dt(3, 8, 7) && *utc < dt(11, 1, 6) {
            EDT
        } else {
            EST
        }
    }
    impl TimeZone for Toronto {
        type Offset = TorontoOffset;
        fn from_offset(_: &TorontoOffset) -> Self {
            Toronto
        }
        fn offset_from_local_date(&self, d: &NaiveDate) -> LocalResult<TorontoOffset> {
            self.offset_from_local_datetime(&d.and_hms_opt(12, 0, 0).unwrap())
        }
        fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> LocalResult<TorontoOffset> {
            // Earlier instant first: EDT (UTC-4) before EST (UTC-5) for the same wall time.
            let valid: Vec<i32> = [EDT, EST]
                .into_iter()
                .filter(|o| {
                    offset_at_utc(&(*local - chrono::Duration::seconds(i64::from(*o)))) == *o
                })
                .collect();
            match valid[..] {
                [] => LocalResult::None,
                [a] => LocalResult::Single(TorontoOffset(a)),
                [a, b] => LocalResult::Ambiguous(TorontoOffset(a), TorontoOffset(b)),
                _ => unreachable!(),
            }
        }
        fn offset_from_utc_date(&self, d: &NaiveDate) -> TorontoOffset {
            self.offset_from_utc_datetime(&d.and_hms_opt(12, 0, 0).unwrap())
        }
        fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> TorontoOffset {
            TorontoOffset(offset_at_utc(utc))
        }
    }
    /// A bare snapshot (every optional feature off) for feature tests.
    pub fn snapshot() -> crate::contracts::Snapshot {
        crate::contracts::Snapshot {
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
    /// A local-machine-zone instant, for tests that go through the public `alerts`.
    pub fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<chrono::Local> {
        chrono::Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .earliest()
            .unwrap()
    }
    /// `2026-11-01 01:30` etc. as an instant in Toronto.
    pub fn at(m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<Toronto> {
        Toronto
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(2026, m, d)
                    .unwrap()
                    .and_hms_opt(h, min, 0)
                    .unwrap(),
            )
            .earliest()
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::testzone::*;
    use super::*;
    use chrono::{FixedOffset, TimeZone};

    #[test]
    fn parses_clock_strictly() {
        assert_eq!(parse_clock("00:00"), Some(0));
        assert_eq!(parse_clock("23:59"), Some(1439));
        for bad in ["", "9:00", "24:00", "08:60", "08-00", "8:0", "ab:cd"] {
            assert_eq!(parse_clock(bad), None, "{bad}");
        }
    }
    #[test]
    fn windows_wrap_midnight_and_empty_window_is_empty() {
        assert!(in_window(23 * 60, 22 * 60, 8 * 60));
        assert!(in_window(0, 22 * 60, 8 * 60));
        assert!(in_window(7 * 60 + 59, 22 * 60, 8 * 60));
        assert!(!in_window(8 * 60, 22 * 60, 8 * 60));
        assert!(!in_window(12 * 60, 22 * 60, 8 * 60));
        assert!(in_window(9 * 60, 9 * 60, 18 * 60) && !in_window(18 * 60, 9 * 60, 18 * 60));
        assert!(!in_window(0, 600, 600) && !in_window(600, 600, 600));
    }
    #[test]
    fn local_at_handles_repeated_and_missing_times() {
        let date = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let first = local_at(&Toronto, date, 90).unwrap();
        assert_eq!(
            first.offset().0,
            -4 * 3600,
            "repeated 01:30 is the first one"
        );
        let date = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
        let gap = local_at(&Toronto, date, 150).unwrap();
        assert_eq!(
            gap.format("%H:%M").to_string(),
            "03:00",
            "02:30 does not exist"
        );
        assert_eq!(gap, at(3, 8, 3, 0));
    }
    #[test]
    fn labels() {
        assert_eq!(clock_label(&at(11, 15, 15, 0)), "3 pm");
        assert_eq!(clock_label(&at(11, 15, 0, 0)), "12 am");
        assert_eq!(clock_label(&at(11, 15, 12, 5)), "12:05 pm");
        let india = FixedOffset::east_opt(19800)
            .unwrap()
            .with_ymd_and_hms(2026, 1, 1, 9, 30, 0)
            .unwrap();
        assert_eq!(clock_label(&india), "9:30 am");
        assert_eq!(tasks(1), "1 task");
        assert_eq!(tasks(3), "3 tasks");
    }
}
