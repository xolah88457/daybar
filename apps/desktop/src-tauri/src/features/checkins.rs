//! Morning and evening check-in notifications.
//!
//! * Morning, "Plan your day": today's task count (Habits on) and countdown days left (Countdown on).
//! * Evening, "N tasks left today": only while Habits is on and tasks remain. The alert is re-derived
//!   from the saved data at `at - 1ms`, so finishing the tasks before it fires cancels it.
//!
//! An empty time turns that check-in off. A time that does not exist on a clock-change day fires when
//! the clock jumps; a repeated time fires on its first occurrence.
use super::{
    clock::{local_at, parse_clock, stamp, tasks},
    Alert, AlertKind,
};
use crate::contracts::*;
use chrono::{DateTime, Local, NaiveDate, TimeZone};

pub const ID: &str = "checkIns";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Morning,
    Evening,
}

/// The check-ins due after `now`, soonest first: today's and tomorrow's (and yesterday's local date,
/// so a time just after midnight is still found when asked from just before it).
pub fn occurrences<Tz: TimeZone>(
    cfg: &CheckInsConfig,
    now: &DateTime<Tz>,
) -> Vec<(Kind, DateTime<Tz>)> {
    let tz = now.timezone();
    let today = now.date_naive();
    let mut out = Vec::new();
    for offset in -1..=1 {
        let Some(date) = today.checked_add_signed(chrono::Duration::days(offset)) else {
            continue;
        };
        for (kind, time) in [
            (Kind::Morning, &cfg.morning_time),
            (Kind::Evening, &cfg.evening_time),
        ] {
            if let Some(at) = parse_clock(time).and_then(|m| local_at(&tz, date, m)) {
                if at > *now {
                    out.push((kind, at));
                }
            }
        }
    }
    out.sort_by_key(|(_, at)| at.timestamp_millis());
    out
}

/// Habit tasks that are not yet done on `date` (empty outside the habit range or without tasks).
fn tasks_left(s: &Snapshot, date: NaiveDate) -> Vec<&str> {
    let h = &s.settings.habits;
    let day = date.format("%Y-%m-%d").to_string();
    if day < h.start_date || (!h.end_date.is_empty() && day > h.end_date) {
        return vec![];
    }
    let done = s.daily_log.get(&day);
    h.tasks
        .iter()
        .filter(|t| !done.is_some_and(|d| d.contains(t)))
        .map(String::as_str)
        .collect()
}

fn in_habit_range(s: &Snapshot, date: NaiveDate) -> bool {
    let h = &s.settings.habits;
    let day = date.format("%Y-%m-%d").to_string();
    day >= h.start_date && (h.end_date.is_empty() || day <= h.end_date)
}

/// Whole days between `date` and the countdown's end, as the menu bar shows them.
fn countdown_days_left(s: &Snapshot, date: NaiveDate) -> Option<i64> {
    let c = &s.settings.countdown;
    let parse = |v: &str| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok();
    let (start, end) = (parse(&c.start_date)?, parse(&c.end_date)?);
    let total = (end - start).num_days() + 1;
    Some(if date >= end {
        0
    } else {
        (end - date).num_days().min(total).max(0)
    })
}

fn morning(s: &Snapshot, date: NaiveDate) -> Content {
    let f = &s.preferences.features;
    let mut parts = Vec::new();
    if f.habits && in_habit_range(s, date) && !s.settings.habits.tasks.is_empty() {
        parts.push(format!("{} today", tasks(s.settings.habits.tasks.len())));
    }
    if f.countdown {
        if let Some(n) = countdown_days_left(s, date).filter(|n| *n > 0) {
            parts.push(format!("{n} {} left", if n == 1 { "day" } else { "days" }));
        }
    }
    let body = if parts.is_empty() {
        "Take a minute to plan the day ahead.".to_string()
    } else {
        parts.join(" · ")
    };
    Content {
        title: "Plan your day".into(),
        body,
    }
}

/// `None` when nothing is left (or Habits is off): no evening alert at all.
fn evening(s: &Snapshot, date: NaiveDate) -> Option<Content> {
    if !s.preferences.features.habits {
        return None;
    }
    let left = tasks_left(s, date);
    if left.is_empty() {
        return None;
    }
    let shown: Vec<&str> = left.iter().take(3).copied().collect();
    let more = left.len() - shown.len();
    let mut body = format!("Still to do: {}", shown.join(", "));
    if more > 0 {
        body.push_str(&format!(" and {more} more"));
    }
    Some(Content {
        title: format!("{} left today", tasks(left.len())),
        body,
    })
}

struct Content {
    title: String,
    body: String,
}

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let cfg = &s.preferences.features.check_ins;
    occurrences(cfg, &now)
        .into_iter()
        .filter_map(|(kind, at)| {
            let date = at.date_naive();
            let (name, content) = match kind {
                Kind::Morning => ("morning", Some(morning(s, date))),
                Kind::Evening => ("evening", evening(s, date)),
            };
            let content = content?;
            Some(Alert {
                id: format!("{ID}:{name}:{}", stamp(&at)),
                at: at.timestamp_millis(),
                title: content.title,
                body: content.body,
                kind: AlertKind::Feature {
                    id: ID,
                    key: name.into(),
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::clock::testzone::{self, at, local, Toronto};
    use super::super::is_current;
    use super::*;

    fn snapshot() -> Snapshot {
        let mut s = testzone::snapshot();
        let f = &mut s.preferences.features;
        f.check_ins.enabled = true;
        s.settings.habits.start_date = "2026-11-01".into();
        s.settings.habits.end_date = String::new();
        s.settings.countdown.start_date = "2026-10-01".into();
        s.settings.countdown.end_date = "2026-11-25".into();
        s
    }
    fn find<'a>(all: &'a [Alert], id: &str) -> Option<&'a Alert> {
        all.iter()
            .find(|a| a.id.starts_with(&format!("{ID}:{id}:")))
    }
    /// The evening alert of the 15th only (tomorrow's is scheduled too and judged on its own data).
    fn evening_today(all: &[Alert]) -> Option<&Alert> {
        all.iter()
            .find(|a| a.id.starts_with(&format!("{ID}:evening:2026-11-15")))
    }

    #[test]
    fn morning_lists_tasks_and_countdown_days_left() {
        let s = snapshot();
        let all = alerts(&s, local(2026, 11, 15, 6, 0));
        let m = find(&all, "morning").unwrap();
        assert_eq!(m.title, "Plan your day");
        assert_eq!(m.body, "4 tasks today · 10 days left");
        assert_eq!(m.at, local(2026, 11, 15, 8, 0).timestamp_millis());
    }
    #[test]
    fn morning_body_drops_modules_that_are_off() {
        let mut s = snapshot();
        s.preferences.features.countdown = false;
        let m = find(&alerts(&s, local(2026, 11, 15, 6, 0)), "morning")
            .cloned()
            .unwrap();
        assert_eq!(m.body, "4 tasks today");
        s.preferences.features.habits = false;
        let m = find(&alerts(&s, local(2026, 11, 15, 6, 0)), "morning")
            .cloned()
            .unwrap();
        assert_eq!(m.body, "Take a minute to plan the day ahead.");
        s.settings.habits.tasks = vec!["Only".into()];
        s.preferences.features.habits = true;
        let m = find(&alerts(&s, local(2026, 11, 15, 6, 0)), "morning")
            .cloned()
            .unwrap();
        assert_eq!(m.body, "1 task today");
    }
    #[test]
    fn evening_counts_tasks_left_and_is_absent_when_all_done_or_habits_off() {
        let mut s = snapshot();
        s.daily_log.insert(
            "2026-11-15".into(),
            vec!["Take a walk".into(), "Not a task".into()],
        );
        let now = local(2026, 11, 15, 12, 0);
        let all = alerts(&s, now);
        let e = evening_today(&all).unwrap();
        assert_eq!(e.title, "3 tasks left today");
        assert_eq!(
            e.body,
            "Still to do: Read a chapter, Sketch a scene, Water the plants"
        );
        s.daily_log
            .insert("2026-11-15".into(), s.settings.habits.tasks.clone());
        assert!(evening_today(&alerts(&s, now)).is_none());
        s.daily_log.clear();
        s.preferences.features.habits = false;
        assert!(evening_today(&alerts(&s, now)).is_none());
        assert!(
            find(&alerts(&s, now), "morning").is_some(),
            "morning is unaffected"
        );
    }
    #[test]
    fn finishing_the_tasks_cancels_the_evening_alert_on_revalidation() {
        let mut s = snapshot();
        let all = alerts(&s, local(2026, 11, 15, 12, 0));
        let evening = find(&all, "evening").unwrap().clone();
        assert!(is_current(&evening, &s));
        s.daily_log
            .insert("2026-11-15".into(), s.settings.habits.tasks.clone());
        assert!(!is_current(&evening, &s));
        // Habits switched off, or the check-ins feature itself, also cancel it.
        s.daily_log.clear();
        s.preferences.features.habits = false;
        assert!(!is_current(&evening, &s));
        s.preferences.features.habits = true;
        s.preferences.features.check_ins.evening_time = "21:00".into();
        assert!(!is_current(&evening, &s), "moved to another time");
    }
    #[test]
    fn empty_times_turn_a_check_in_off_and_only_future_ones_are_returned() {
        let mut s = snapshot();
        s.preferences.features.check_ins.morning_time = String::new();
        let now = local(2026, 11, 15, 20, 0); // exactly the evening time: not in the future
        let all = alerts(&s, now);
        assert!(find(&all, "morning").is_none());
        assert!(all.iter().all(|a| a.at > now.timestamp_millis()));
        assert!(find(&all, "evening").is_some(), "tomorrow evening");
        s.preferences.features.check_ins.evening_time = String::new();
        assert!(alerts(&s, now).is_empty());
    }
    #[test]
    fn ids_are_unique_per_occurrence() {
        let s = snapshot();
        let all = alerts(&s, local(2026, 11, 15, 6, 0));
        let ids: std::collections::BTreeSet<_> = all.iter().map(|a| a.id.clone()).collect();
        assert_eq!(ids.len(), all.len());
        assert!(all.len() >= 3);
        assert!(all.iter().all(|a| a.id.contains("2026-11-1")));
    }
    #[test]
    fn midnight_check_in_is_found_from_the_evening_before() {
        let cfg = CheckInsConfig {
            enabled: true,
            morning_time: "00:00".into(),
            evening_time: String::new(),
        };
        let from = at(11, 15, 23, 59);
        let found = occurrences(&cfg, &from);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, at(11, 16, 0, 0));
    }
    #[test]
    fn clock_changes_fire_once() {
        // 02:30 does not exist on 2026-03-08 (fires at the jump); on 2026-11-01 01:30 is repeated.
        let cfg = CheckInsConfig {
            enabled: true,
            morning_time: "02:30".into(),
            evening_time: "01:30".into(),
        };
        let on = |found: &[(Kind, DateTime<Toronto>)], kind: Kind, day: &str| {
            found
                .iter()
                .filter(|(k, t)| *k == kind && t.format("%m-%d").to_string() == day)
                .map(|(_, t)| t.clone())
                .collect::<Vec<_>>()
        };
        let spring = occurrences(&cfg, &at(3, 7, 12, 0));
        assert_eq!(on(&spring, Kind::Morning, "03-08"), vec![at(3, 8, 3, 0)]);
        let fall = occurrences(&cfg, &at(10, 31, 12, 0));
        let evening = on(&fall, Kind::Evening, "11-01");
        assert_eq!(evening.len(), 1, "the repeated 01:30 fires once");
        assert_eq!(
            evening[0].timestamp_millis(),
            at(11, 1, 1, 30).timestamp_millis()
        );
        assert_eq!(
            evening[0].format("%:z").to_string(),
            "-04:00",
            "its first occurrence"
        );
    }
}
