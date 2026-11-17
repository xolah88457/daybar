//! Auto-cycle: when a focus session runs to its end, start a break by itself.
//!
//! The scheduler thread in `runtime.rs` is the only caller, so every start goes through the same
//! store mutation as the window and tray (`StartTimer` with `timerType` break) and also works while
//! the window is hidden. It runs right after settlement: when the end-of-timer alert fires (so the
//! notification can say "Break started"), after every snapshot refresh, and on a forced refresh the
//! moment a timer is due, even if alerts are off.
//!
//! **Idempotency rule.** [`decide`] looks only at the saved state, never at "what just happened".
//! It starts a break only when ALL of these hold:
//! * no timer is running;
//! * the newest ledger session is a focus session that ran to its full length (stopped early means
//!   no break), and it ended no more than [`FRESH_MS`] (2 minutes) ago;
//! so a re-settle, a second refresh or an app restart finds a running or finished break (or nothing
//! fresh) and does nothing, and a session that ended long ago while the app was closed or the Mac
//! slept never triggers a break. A break ending never starts focus.
//!
//! Every `longBreakEvery`-th naturally completed focus session of that session's day (counted from
//! the ledger, the session itself included) gets the first `longBreakOptions`; others get the
//! first `breakOptions`. The no-phone-time confirmation applies to focus starts only, so it never
//! blocks a break.

use crate::{
    contracts::{Operation, Snapshot},
    store::Store,
};

pub const ID: &str = "autoCycle";
/// A finished session older than this is left alone (settled late: app closed, Mac asleep).
pub const FRESH_MS: i64 = 2 * 60_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub minutes: u32,
    pub long: bool,
}

fn natural(key: i64, minutes: u32, end: i64) -> bool {
    end == key + i64::from(minutes) * 60_000
}

/// The break to start now, if any. Pure function of the saved state; see the module docs.
pub fn decide(s: &Snapshot, now: i64) -> Option<Plan> {
    let f = &s.preferences.features;
    if !f.focus || !f.active(ID) || s.focus.state.is_some() {
        return None;
    }
    let sessions = s.focus.sessions.as_ref()?;
    let (start, last) = sessions
        .iter()
        .filter_map(|(k, v)| Some((k.parse::<i64>().ok()?, v)))
        .max_by_key(|(k, _)| *k)?;
    if last.r#type != "focus"
        || !natural(start, last.minutes, last.end)
        || now < last.end
        || now - last.end > FRESH_MS
    {
        return None;
    }
    let done = sessions
        .iter()
        .filter(|(k, v)| {
            v.r#type == "focus"
                && v.date == last.date
                && k.parse::<i64>().is_ok_and(|k| natural(k, v.minutes, v.end))
        })
        .count() as u32;
    let every = f.auto_cycle.long_break_every;
    let long = every > 0 && done % every == 0;
    let focus = &s.settings.focus;
    let options = if long && !focus.long_break_options.is_empty() {
        &focus.long_break_options
    } else {
        &focus.break_options
    };
    options.first().map(|&minutes| Plan { minutes, long })
}

/// Starts the break [`decide`] asks for (if any) and returns its length in minutes. `snapshot`
/// must already be settled. A lost race with another start (window or tray) is not an error.
pub fn run(store: &Store, snapshot: &Snapshot, now: i64) -> Result<Option<u32>, String> {
    let Some(plan) = decide(snapshot, now) else {
        return Ok(None);
    };
    let op = Operation::StartTimer {
        timer_type: "break".into(),
        minutes: plan.minutes,
        task: None,
    };
    match store.mutate_at(op, now) {
        Ok(_) => Ok(Some(plan.minutes)),
        Err(e) => match store.snapshot() {
            Ok(latest) if latest.focus.state.is_some() => Ok(None),
            _ => Err(e),
        },
    }
}

/// Settles an expired timer and starts the break, for the end-of-timer alert. Returns the break
/// length to mention in the notification.
pub fn settle_and_run(store: &Store, now: i64) -> Result<Option<u32>, String> {
    let snapshot = store.snapshot()?;
    run(store, &snapshot, now)
}

/// True once per timer: the running timer is due but unsettled, so the scheduler should refresh now
/// rather than at the next minute tick (alerts may be off). `woken` remembers the timer start.
pub fn wants_refresh(s: &Snapshot, now: i64, woken: &mut Option<i64>) -> bool {
    let f = &s.preferences.features;
    match &s.focus.state {
        Some(t) if f.focus && f.active(ID) && t.r#type == "focus" && t.end <= now => {
            woken.replace(t.start) != Some(t.start)
        }
        _ => false,
    }
}

/// The notification body when the break started: "Break started · N min".
pub fn started_body(minutes: u32) -> String {
    format!("Break started · {minutes} min")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{FocusData, FocusSession, TimerState};
    use std::collections::BTreeMap;

    const T: i64 = 1_800_000_000_000;
    const MIN: i64 = 60_000;

    fn snapshot() -> Snapshot {
        let mut preferences: crate::contracts::Preferences = serde_json::from_str(
            r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
        )
        .unwrap();
        preferences.features.auto_cycle.enabled = true;
        Snapshot {
            settings: Default::default(),
            daily_log: Default::default(),
            focus: FocusData::default(),
            sleep: Default::default(),
            preferences,
            issues: vec![],
            conflicts: vec![],
        }
    }
    /// `n` full 25-minute focus sessions the same day, the last ending at `last_end`.
    fn with_sessions(s: &mut Snapshot, n: i64, last_end: i64) {
        let mut sessions = BTreeMap::new();
        for i in 0..n {
            let end = last_end - (n - 1 - i) * 30 * MIN;
            sessions.insert(
                (end - 25 * MIN).to_string(),
                FocusSession {
                    r#type: "focus".into(),
                    minutes: 25,
                    credited_minutes: 25,
                    end,
                    date: "2026-11-16".into(),
                    task: None,
                },
            );
        }
        s.focus = FocusData {
            sessions: Some(sessions),
            baseline: Some(BTreeMap::new()),
            ..Default::default()
        };
    }

    #[test]
    fn every_nth_completed_session_gets_a_long_break() {
        let mut picks = Vec::new();
        for n in 1..=8 {
            let mut s = snapshot();
            with_sessions(&mut s, n, T);
            let plan = decide(&s, T + 1_000).unwrap();
            picks.push((plan.long, plan.minutes));
        }
        // Defaults: every 4th; break 5, long break 15.
        assert_eq!(
            picks,
            [
                (false, 5),
                (false, 5),
                (false, 5),
                (true, 15),
                (false, 5),
                (false, 5),
                (false, 5),
                (true, 15)
            ]
        );
        let mut s = snapshot();
        s.preferences.features.auto_cycle.long_break_every = 2;
        s.settings.focus.long_break_options = vec![20, 30];
        with_sessions(&mut s, 2, T);
        assert_eq!(
            decide(&s, T),
            Some(Plan {
                minutes: 20,
                long: true
            })
        );
    }

    #[test]
    fn only_todays_completed_sessions_count_toward_the_long_break() {
        let mut s = snapshot();
        with_sessions(&mut s, 4, T);
        // Move the first three sessions to another day, and make one of today's an early stop.
        let sessions = s.focus.sessions.as_mut().unwrap();
        for (i, v) in sessions.values_mut().enumerate() {
            if i < 3 {
                v.date = "2026-11-15".into();
            }
        }
        assert!(!decide(&s, T).unwrap().long);
        let mut s = snapshot();
        with_sessions(&mut s, 4, T);
        let first = s
            .focus
            .sessions
            .as_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap();
        first.end -= 5 * MIN;
        first.credited_minutes = 20;
        assert!(
            !decide(&s, T).unwrap().long,
            "an early stop is not a completed session"
        );
    }

    #[test]
    fn no_break_after_an_early_stop_a_break_or_while_running() {
        let mut s = snapshot();
        with_sessions(&mut s, 1, T);
        let v = s
            .focus
            .sessions
            .as_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap();
        v.end -= MIN;
        v.credited_minutes = 24;
        assert_eq!(decide(&s, T), None, "stopped early");
        with_sessions(&mut s, 1, T);
        s.focus
            .sessions
            .as_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap()
            .r#type = "break".into();
        assert_eq!(
            decide(&s, T),
            None,
            "a finished break never starts focus or another break"
        );
        with_sessions(&mut s, 1, T);
        s.focus.state = Some(TimerState {
            r#type: "break".into(),
            minutes: 5,
            start: T,
            end: T + 5 * MIN,
            task: None,
        });
        assert_eq!(decide(&s, T), None, "a timer is already running");
        let mut off = snapshot();
        with_sessions(&mut off, 1, T);
        off.preferences.features.auto_cycle.enabled = false;
        assert_eq!(decide(&off, T), None);
        off.preferences.features.auto_cycle.enabled = true;
        off.preferences.features.focus = false;
        assert_eq!(decide(&off, T), None, "hidden Focus module is inert");
    }

    #[test]
    fn stale_sessions_never_auto_start() {
        let mut s = snapshot();
        with_sessions(&mut s, 1, T);
        assert!(decide(&s, T).is_some());
        assert!(decide(&s, T + FRESH_MS).is_some());
        assert_eq!(
            decide(&s, T + FRESH_MS + 1),
            None,
            "settled long after the end"
        );
        assert_eq!(decide(&s, T - 1), None, "clock before the end");
    }

    #[test]
    fn wakes_the_scheduler_once_per_due_timer() {
        let mut s = snapshot();
        let timer = |kind: &str| TimerState {
            r#type: kind.into(),
            minutes: 25,
            start: T,
            end: T + 25 * MIN,
            task: None,
        };
        s.focus.state = Some(timer("focus"));
        let mut woken = None;
        assert!(!wants_refresh(&s, T + 24 * MIN, &mut woken));
        assert!(wants_refresh(&s, T + 25 * MIN, &mut woken));
        assert!(
            !wants_refresh(&s, T + 26 * MIN, &mut woken),
            "only once, even if settling fails"
        );
        s.focus.state = Some(timer("break"));
        woken = None;
        assert!(!wants_refresh(&s, T + 26 * MIN, &mut woken));
    }

    mod through_the_store {
        use super::*;
        use crate::store::Store;

        fn store_with_autocycle(every: u32) -> (tempfile::TempDir, Store) {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(dir.path().canonicalize().unwrap(), None).unwrap();
            let mut prefs = store.preferences().unwrap();
            prefs.features.auto_cycle.enabled = true;
            prefs.features.auto_cycle.long_break_every = every;
            store.set_preferences(prefs).unwrap();
            (dir, store)
        }
        fn focus_op(minutes: u32) -> Operation {
            Operation::StartTimer {
                timer_type: "focus".into(),
                minutes,
                task: None,
            }
        }

        #[test]
        fn natural_end_starts_one_break_and_stays_idempotent_across_reloads() {
            let (dir, store) = store_with_autocycle(2);
            let now = chrono::Local::now().timestamp_millis();
            // Ended two minutes ago, so the 5-minute break is still running at the real "now".
            let t0 = now - 27 * 60_000;
            store.mutate_at(focus_op(25), t0).unwrap();
            let end = t0 + 25 * 60_000;
            // Settle at the natural end (what the UI, tray or scheduler does), then cycle.
            store.mutate_at(Operation::SettleTimer, end + 500).unwrap();
            let settled = store.snapshot().unwrap();
            assert!(settled.focus.state.is_none());
            assert_eq!(run(&store, &settled, end + 1_000).unwrap(), Some(5));
            let after = store.snapshot().unwrap();
            let brk = after.focus.state.clone().unwrap();
            assert_eq!((brk.r#type.as_str(), brk.minutes), ("break", 5));
            // Re-settle and re-run: no second break, no change to the running one.
            store
                .mutate_at(Operation::SettleTimer, end + 2_000)
                .unwrap();
            let again = store.snapshot().unwrap();
            assert_eq!(run(&store, &again, end + 3_000).unwrap(), None);
            assert_eq!(
                store.snapshot().unwrap().focus.state.unwrap().start,
                brk.start
            );
            // A "restart" is a fresh Store over the same folder: still nothing to do.
            let reopened = Store::open(dir.path().canonicalize().unwrap(), None).unwrap();
            let snap = reopened.snapshot().unwrap();
            assert_eq!(run(&reopened, &snap, end + 4_000).unwrap(), None);
            // After the break ends, nothing starts either (break never auto-starts focus).
            let after_break = brk.end + 1_000;
            reopened
                .mutate_at(Operation::SettleTimer, after_break)
                .unwrap();
            let snap = reopened.snapshot().unwrap();
            assert!(snap.focus.state.is_none());
            assert_eq!(run(&reopened, &snap, after_break).unwrap(), None);
        }

        #[test]
        fn early_stop_and_stale_settlement_start_nothing() {
            let (_dir, store) = store_with_autocycle(4);
            let now = chrono::Local::now().timestamp_millis();
            let t0 = now - 10 * 60 * 60_000;
            store.mutate_at(focus_op(25), t0).unwrap();
            store
                .mutate_at(Operation::StopTimer, t0 + 10 * 60_000)
                .unwrap();
            let snap = store.snapshot().unwrap();
            assert_eq!(run(&store, &snap, t0 + 10 * 60_000 + 500).unwrap(), None);
            // Ran to its end hours ago while the app was closed: settled late, so no break.
            let t1 = now - 5 * 60 * 60_000;
            store.mutate_at(focus_op(25), t1).unwrap();
            store.mutate_at(Operation::SettleTimer, now).unwrap();
            let snap = store.snapshot().unwrap();
            assert!(snap.focus.state.is_none());
            assert_eq!(run(&store, &snap, now).unwrap(), None);
        }
    }
}
