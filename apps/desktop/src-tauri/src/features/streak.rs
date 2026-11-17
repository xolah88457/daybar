//! Streak saver: nudge shortly before bed when today's habits are unfinished.
//!
//! One alert, at `bedtime - minutesBeforeBed`, when Habits is on, the day is not yet complete under
//! `dayCompleteMin` and the current streak is at least 1. Bedtime comes from the same computation as
//! the bedtime alerts (`sleep::view`), even with the Sleep module off: the settings still exist. With
//! no usable bedtime there is no alert. "Today" is the habit day the user is still in: the local date the
//! current waking period started (the `wake` of that same view), not the date of the alert instant,
//! which falls after midnight when bed is late (wake 10:00 and 16 awake hours put the alert on the
//! next calendar day).
//! `K tasks left` is how many more tasks finish the day under the rule (all of them when
//! `dayCompleteMin` equals the task count). Finishing the day cancels the alert on revalidation.
use super::{
    clock::{stamp, tasks},
    Alert, AlertKind,
};
use crate::{contracts::*, sleep};
use chrono::{DateTime, Duration, Local, NaiveDate};

pub const ID: &str = "streakSaver";

/// Entries logged on `day` that are active tasks. Mirrors `doneOn` in packages/core/src/habits.ts,
/// including counting a repeated entry twice.
pub fn done_on(log: &DailyLog, h: &HabitSettings, day: NaiveDate) -> usize {
    log.get(&day.format("%Y-%m-%d").to_string())
        .map_or(0, |d| d.iter().filter(|t| h.tasks.contains(t)).count())
}

/// The current streak on `today`. Mirrors `getHabitStats(...).currentStreak`: an unfinished today does
/// not break yesterday's streak until the day is over. Parity is tested against
/// packages/core/tests/fixtures/streak-parity.json.
pub fn current_streak(h: &HabitSettings, log: &DailyLog, today: NaiveDate) -> u32 {
    let parse = |v: &str| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok();
    let Some(start) = parse(&h.start_date) else {
        return 0;
    };
    let mut elapsed = ((today - start).num_days() + 1).max(0);
    if let Some(end) = parse(&h.end_date) {
        elapsed = elapsed.min((end - start).num_days() + 1);
    }
    let complete =
        |i: i64| done_on(log, h, start + Duration::days(i)) >= h.day_complete_min as usize;
    let mut run = 0;
    for i in 0..elapsed {
        run = if complete(i) { run + 1 } else { 0 };
    }
    if elapsed > 0 && start + Duration::days(elapsed - 1) == today && !complete(elapsed - 1) {
        run = 0;
        let mut i = elapsed - 2;
        while i >= 0 && complete(i) {
            run += 1;
            i -= 1;
        }
    }
    run
}

/// The alert instant for tonight's bedtime, if one can be determined and is still ahead, with the
/// habit day it is about: the date the current waking period started.
fn alert_time(s: &Snapshot, now: DateTime<Local>) -> Option<(DateTime<Local>, NaiveDate)> {
    let view = sleep::view(&s.sleep, &s.settings.sleep, now).ok()?;
    let at = view.bed
        - Duration::minutes(i64::from(
            s.preferences.features.streak_saver.minutes_before_bed,
        ));
    (at > now).then_some((at, view.wake.date_naive()))
}

/// Alerts wanted from `now` onwards. Called only while the feature is active.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let h = &s.settings.habits;
    if !s.preferences.features.habits || h.tasks.is_empty() {
        return Vec::new();
    }
    let Some((at, day)) = alert_time(s, now) else {
        return Vec::new();
    };
    let key = day.format("%Y-%m-%d").to_string();
    if key < h.start_date || (!h.end_date.is_empty() && key > h.end_date) {
        return Vec::new();
    }
    let left = (h.day_complete_min as usize).saturating_sub(done_on(&s.daily_log, h, day));
    let streak = current_streak(h, &s.daily_log, day);
    if left == 0 || streak < 1 {
        return Vec::new();
    }
    vec![Alert {
        id: format!("{ID}:{}", stamp(&at)),
        at: at.timestamp_millis(),
        title: "Streak at risk".into(),
        body: format!(
            "Your {streak}-day streak ends tonight · {} left",
            tasks(left)
        ),
        kind: AlertKind::Feature {
            id: ID,
            key: key.clone(),
        },
    }]
}

#[cfg(test)]
mod tests {
    use super::super::clock::testzone::{self, local};
    use super::super::is_current;
    use super::*;

    /// Wake logged at 08:00 on 2026-11-15 and the default 16 awake hours: bed at midnight, so with the
    /// default 90 minutes the alert is at 22:30.
    fn snapshot() -> Snapshot {
        let mut s = testzone::snapshot();
        s.preferences.features.streak_saver.enabled = true;
        s.settings.habits.start_date = "2026-11-01".into();
        s.settings.habits.tasks = vec!["A".into(), "B".into(), "C".into()];
        s.settings.habits.day_complete_min = 3;
        s.sleep.wakes.insert("2026-11-15".into(), 8 * 60);
        for d in 12..=14 {
            s.daily_log.insert(
                format!("2026-11-{d}"),
                vec!["A".into(), "B".into(), "C".into()],
            );
        }
        s
    }
    const NOON: (i32, u32, u32, u32, u32) = (2026, 11, 15, 12, 0);
    fn now() -> DateTime<Local> {
        local(NOON.0, NOON.1, NOON.2, NOON.3, NOON.4)
    }

    #[test]
    fn rust_current_streak_matches_the_typescript_fixture() {
        let raw: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/core/tests/fixtures/streak-parity.json"
        ))
        .unwrap();
        let tasks: Vec<String> = serde_json::from_value(raw["tasks"].clone()).unwrap();
        let cases = raw["cases"].as_array().unwrap();
        assert!(cases.len() >= 10);
        for c in cases {
            let h = HabitSettings {
                start_date: c["startDate"].as_str().unwrap().into(),
                end_date: c["endDate"].as_str().unwrap().into(),
                day_complete_min: c["dayCompleteMin"].as_u64().unwrap() as u32,
                tasks: tasks.clone(),
                ..Default::default()
            };
            let log: DailyLog = serde_json::from_value(c["log"].clone()).unwrap();
            let today =
                NaiveDate::parse_from_str(c["today"].as_str().unwrap(), "%Y-%m-%d").unwrap();
            assert_eq!(
                u64::from(current_streak(&h, &log, today)),
                c["currentStreak"].as_u64().unwrap(),
                "{}",
                c["name"]
            );
        }
    }
    #[test]
    fn alerts_once_at_bedtime_minus_the_lead_with_the_streak_and_tasks_left() {
        let s = snapshot();
        let all = alerts(&s, now());
        assert_eq!(all.len(), 1);
        let a = &all[0];
        assert_eq!(a.at, local(2026, 11, 15, 22, 30).timestamp_millis());
        assert_eq!(a.title, "Streak at risk");
        assert_eq!(a.body, "Your 3-day streak ends tonight · 3 tasks left");
        assert!(a.id.starts_with("streakSaver:2026-11-15T22:30"));
        let mut partly = snapshot();
        partly
            .daily_log
            .insert("2026-11-15".into(), vec!["A".into()]);
        assert_eq!(
            alerts(&partly, now())[0].body,
            "Your 3-day streak ends tonight · 2 tasks left"
        );
        partly.settings.habits.day_complete_min = 1;
        assert!(
            alerts(&partly, now()).is_empty(),
            "day complete under the rule"
        );
    }
    #[test]
    fn tasks_left_is_what_the_complete_rule_still_needs() {
        let mut s = snapshot();
        s.settings.habits.day_complete_min = 2;
        s.daily_log.insert("2026-11-15".into(), vec!["A".into()]);
        assert_eq!(
            alerts(&s, now())[0].body,
            "Your 3-day streak ends tonight · 1 task left"
        );
    }
    #[test]
    fn no_alert_without_a_streak_habits_a_bedtime_or_a_future_time() {
        let mut s = snapshot();
        s.daily_log.remove("2026-11-14");
        assert!(alerts(&s, now()).is_empty(), "streak is 0");
        let mut off = snapshot();
        off.preferences.features.habits = false;
        assert!(alerts(&off, now()).is_empty());
        let late = local(2026, 11, 15, 23, 0);
        assert!(alerts(&snapshot(), late).is_empty(), "22:30 has passed");
        let mut bad = snapshot();
        bad.sleep.wakes.insert("not-a-date".into(), 5);
        assert!(alerts(&bad, now()).is_empty(), "no usable bedtime");
        let mut outside = snapshot();
        outside.settings.habits.end_date = "2026-11-14".into();
        assert!(alerts(&outside, now()).is_empty(), "habit range is over");
    }
    #[test]
    fn works_with_the_sleep_module_off_and_follows_settings() {
        let mut s = snapshot();
        s.preferences.features.sleep = false;
        assert_eq!(alerts(&s, now()).len(), 1);
        s.preferences.features.streak_saver.minutes_before_bed = 30;
        assert_eq!(
            alerts(&s, now())[0].at,
            local(2026, 11, 15, 23, 30).timestamp_millis()
        );
    }
    #[test]
    fn completing_the_day_cancels_it_through_revalidation() {
        let mut s = snapshot();
        let alert = alerts(&s, now()).remove(0);
        assert!(is_current(&alert, &s));
        s.daily_log.insert(
            "2026-11-15".into(),
            vec!["A".into(), "B".into(), "C".into()],
        );
        assert!(!is_current(&alert, &s));
        s.daily_log.remove("2026-11-15");
        assert!(is_current(&alert, &s));
        s.preferences.features.streak_saver.enabled = false;
        assert!(!is_current(&alert, &s));
    }
    /// Wake 10:00 on the 15th with 16 awake hours: bed 02:00 on the 16th, so the default 90-minute
    /// alert lands at 00:30 on the 16th but is still about the 15th.
    fn late_bed() -> Snapshot {
        let mut s = snapshot();
        s.sleep.wakes.clear();
        s.sleep.wakes.insert("2026-11-15".into(), 10 * 60);
        s
    }

    #[test]
    fn an_alert_after_midnight_is_about_the_day_the_user_is_still_in() {
        let s = late_bed();
        let all = alerts(&s, now());
        assert_eq!(all.len(), 1, "the 15th is unfinished");
        assert_eq!(all[0].at, local(2026, 11, 16, 0, 30).timestamp_millis());
        assert_eq!(all[0].body, "Your 3-day streak ends tonight · 3 tasks left");
        assert!(matches!(&all[0].kind, AlertKind::Feature { key, .. } if key == "2026-11-15"));
        assert!(is_current(&all[0], &s));
        // Still the same alert from 23:00 on the 15th.
        assert_eq!(alerts(&s, local(2026, 11, 15, 23, 0)).len(), 1);
    }

    #[test]
    fn an_after_midnight_alert_is_silent_when_the_wake_day_is_done() {
        let mut s = late_bed();
        s.daily_log.insert(
            "2026-11-15".into(),
            vec!["A".into(), "B".into(), "C".into()],
        );
        // The empty 16th must not produce a false alarm.
        assert!(alerts(&s, now()).is_empty());
        // And a stale alert for the finished day is dropped on revalidation.
        let mut open = late_bed();
        let alert = alerts(&open, now()).remove(0);
        open.daily_log.insert(
            "2026-11-15".into(),
            vec!["A".into(), "B".into(), "C".into()],
        );
        assert!(!is_current(&alert, &open));
    }

    #[test]
    fn id_is_per_occurrence() {
        let a = alerts(&snapshot(), now()).remove(0);
        let mut next_day = snapshot();
        next_day.sleep.wakes.insert("2026-11-16".into(), 8 * 60);
        next_day.daily_log.insert(
            "2026-11-15".into(),
            vec!["A".into(), "B".into(), "C".into()],
        );
        let b = alerts(&next_day, local(2026, 11, 16, 12, 0)).remove(0);
        assert_ne!(a.id, b.id);
    }
}
