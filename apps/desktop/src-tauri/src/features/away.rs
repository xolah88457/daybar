//! Away detection: notice when the Mac has been idle while a focus timer runs.
//!
//! While a FOCUS timer runs and the feature is on, the scheduler thread calls [`poll`] every loop;
//! at most every [`POLL_MS`] it reads the idle time ([`away_mac::idle_seconds`]). Once idle
//! reaches `idleMinutes` it sends one notification for that session and *latches* an "away" state:
//! the banner must still be there when you come back and the idle clock has already reset. The
//! latch lasts until you dismiss it ([`away_dismiss`]) or the session ends. Nothing is read when no
//! focus timer is running or the feature is off. Idle time is capped at the session's age, so time
//! before the timer started never counts.
//!
//! The frontend reads [`away_status`] and listens to the `daybar://away` event.

// Declared here (not in mod.rs) so the FFI file stays self-contained and mod.rs stays untouched.
#[path = "away_mac.rs"]
mod away_mac;
use crate::contracts::{Snapshot, TimerState};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

pub const ID: &str = "awayDetection";
/// How often the idle time is read while a focus timer runs.
pub const POLL_MS: i64 = 30_000;

/// What the UI needs: which session, whether the away banner is showing, and how long you were away.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwayStatus {
    /// Start of the focus timer this status is about; `None` when no focus timer is being watched.
    pub session: Option<i64>,
    pub away: bool,
    pub away_minutes: u32,
}

/// What one [`Tracker::tick`] decided.
#[derive(Debug, PartialEq, Eq)]
pub struct Tick {
    pub status: AwayStatus,
    /// Whole minutes away to put in the one notification for this session, when it is due.
    pub notify: Option<u32>,
}

#[derive(Default)]
pub struct Tracker {
    session: Option<i64>,
    last_check: i64,
    previous_idle: f64,
    peak_idle: f64,
    latched: bool,
    returned: bool,
    dismissed: bool,
}

impl Tracker {
    pub fn status(&self) -> AwayStatus {
        AwayStatus {
            session: self.session,
            away: self.latched && !self.dismissed,
            away_minutes: (self.peak_idle / 60.0) as u32,
        }
    }
    /// `focus_start` is the running focus timer's start, or `None` when nothing should be watched.
    /// `idle` is called only when a reading is due.
    pub fn tick(
        &mut self,
        focus_start: Option<i64>,
        now: i64,
        threshold_secs: f64,
        idle: &dyn Fn() -> Option<f64>,
    ) -> Tick {
        let none = |me: &Self| Tick {
            status: me.status(),
            notify: None,
        };
        let Some(start) = focus_start else {
            if self.session.is_some() {
                *self = Self::default();
            }
            return none(self);
        };
        if self.session != Some(start) {
            *self = Self {
                session: Some(start),
                ..Self::default()
            };
        }
        if now - self.last_check < POLL_MS {
            return none(self);
        }
        self.last_check = now;
        let Some(raw) = idle() else {
            return none(self);
        };
        let idle = raw.min(((now - start) as f64 / 1000.0).max(0.0));
        let mut notify = None;
        if self.latched {
            // Keep growing the figure until the first sign of activity, then freeze it.
            if !self.returned && idle >= self.previous_idle {
                self.peak_idle = self.peak_idle.max(idle);
            } else {
                self.returned = true;
            }
        } else if idle >= threshold_secs {
            self.latched = true;
            self.peak_idle = idle;
            notify = Some((idle / 60.0) as u32);
        }
        self.previous_idle = idle;
        Tick {
            status: self.status(),
            notify,
        }
    }
    pub fn dismiss(&mut self, session: i64) {
        if self.session == Some(session) {
            self.dismissed = true;
        }
    }
}

/// Tauri-managed holder, registered once in `runtime::start`.
#[derive(Default)]
pub struct AwayState {
    tracker: Mutex<Tracker>,
    emitted: Mutex<Option<AwayStatus>>,
}
impl AwayState {
    fn publish(&self, app: &AppHandle, status: AwayStatus) {
        let Ok(mut last) = self.emitted.lock() else {
            return;
        };
        if last.as_ref() != Some(&status) {
            let _ = app.emit("daybar://away", status.clone());
            *last = Some(status);
        }
    }
}

/// The running focus timer to watch, if the feature is on.
fn watched(s: &Snapshot) -> Option<&TimerState> {
    let f = &s.preferences.features;
    s.focus
        .state
        .as_ref()
        .filter(|t| t.r#type == "focus" && f.focus && f.active(ID))
}

/// Called from the scheduler loop with the latest snapshot. Cheap unless a reading is due.
pub fn poll(app: &AppHandle, s: &Snapshot, now: i64) {
    let state = app.state::<AwayState>();
    let timer = watched(s);
    let threshold = f64::from(s.preferences.features.away_detection.idle_minutes) * 60.0;
    let tick = {
        let Ok(mut tracker) = state.tracker.lock() else {
            return;
        };
        tracker.tick(
            timer.map(|t| t.start),
            now,
            threshold,
            &away_mac::idle_seconds,
        )
    };
    if let Some(minutes) = tick.notify {
        let _ = app
            .notification()
            .builder()
            .title("Still focusing?")
            .body(format!("You've been away {minutes} min"))
            .show();
    }
    state.publish(app, tick.status);
}

#[tauri::command]
pub fn away_status(state: State<'_, AwayState>) -> AwayStatus {
    state.tracker.lock().map(|t| t.status()).unwrap_or_default()
}

/// "Keep going": hide the banner for this session.
#[tauri::command]
pub fn away_dismiss(app: AppHandle, state: State<'_, AwayState>, session: i64) -> AwayStatus {
    let status = state
        .tracker
        .lock()
        .map(|mut t| {
            t.dismiss(session);
            t.status()
        })
        .unwrap_or_default();
    state.publish(&app, status.clone());
    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const T: i64 = 1_800_000_000_000;
    const THRESHOLD: f64 = 300.0;

    fn at(tracker: &mut Tracker, secs: i64, idle: Option<f64>) -> Tick {
        tracker.tick(Some(T), T + secs * 1000, THRESHOLD, &|| idle)
    }

    #[test]
    fn notifies_once_when_idle_reaches_the_threshold_and_latches() {
        let mut t = Tracker::default();
        assert_eq!(at(&mut t, 60, Some(60.0)).notify, None);
        assert!(
            !at(&mut t, 120, Some(299.0)).status.away,
            "below the threshold"
        );
        let tick = at(&mut t, 400, Some(310.0));
        assert_eq!(tick.notify, Some(5));
        assert!(tick.status.away);
        assert_eq!(tick.status.away_minutes, 5);
        // More idle time: still one notification only, and the figure grows.
        let tick = at(&mut t, 460, Some(370.0));
        assert_eq!((tick.notify, tick.status.away_minutes), (None, 6));
        // Back at the keyboard: the banner stays and the figure freezes.
        let tick = at(&mut t, 500, Some(2.0));
        assert!(tick.status.away && tick.notify.is_none());
        let tick = at(&mut t, 600, Some(100.0));
        assert_eq!((tick.status.away, tick.status.away_minutes), (true, 6));
    }

    #[test]
    fn readings_are_throttled_and_skipped_without_a_focus_timer() {
        let reads = Cell::new(0);
        let read = || {
            reads.set(reads.get() + 1);
            Some(10.0)
        };
        let mut t = Tracker::default();
        for secs in [31, 40, 55, 62] {
            t.tick(Some(T), T + secs * 1000, THRESHOLD, &read);
        }
        assert_eq!(reads.get(), 2, "31 s and 62 s only");
        reads.set(0);
        let mut t = Tracker::default();
        t.tick(None, T + 99_000, THRESHOLD, &read);
        assert_eq!(reads.get(), 0, "nothing watched, nothing read");
    }

    #[test]
    fn dismiss_hides_the_banner_and_a_new_session_starts_fresh() {
        let mut t = Tracker::default();
        assert!(at(&mut t, 400, Some(400.0)).status.away);
        t.dismiss(T + 1); // some other session: ignored
        assert!(t.status().away);
        t.dismiss(T);
        assert!(!t.status().away);
        assert_eq!(
            at(&mut t, 500, Some(500.0)).notify,
            None,
            "still the same session"
        );
        // The next session: a fresh latch and a fresh notification.
        let tick = t.tick(Some(T + 9_000_000), T + 9_400_000, THRESHOLD, &|| {
            Some(400.0)
        });
        assert_eq!(tick.notify, Some(6));
        assert!(tick.status.away);
        // Timer stopped: everything is cleared.
        let tick = t.tick(None, T + 9_500_000, THRESHOLD, &|| Some(1.0));
        assert_eq!(tick.status, AwayStatus::default());
    }

    #[test]
    fn idle_before_the_timer_started_does_not_count_and_unreadable_idle_is_ignored() {
        let mut t = Tracker::default();
        // 40 s into the session the Mac claims 1 h idle: capped to the session's age.
        assert_eq!(at(&mut t, 40, Some(3600.0)).notify, None);
        assert_eq!(at(&mut t, 80, None).notify, None);
        assert!(!t.status().away);
    }

    #[test]
    fn only_a_running_focus_timer_with_the_feature_on_is_watched() {
        let mut preferences: crate::contracts::Preferences = serde_json::from_str(
            r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
        )
        .unwrap();
        let timer = |kind: &str| TimerState {
            r#type: kind.into(),
            minutes: 25,
            start: T,
            end: T + 1_500_000,
            task: None,
        };
        let snap = |p: &crate::contracts::Preferences, kind: &str| Snapshot {
            settings: Default::default(),
            daily_log: Default::default(),
            focus: crate::contracts::FocusData {
                state: Some(timer(kind)),
                ..Default::default()
            },
            sleep: Default::default(),
            preferences: p.clone(),
            issues: vec![],
            conflicts: vec![],
        };
        assert!(
            watched(&snap(&preferences, "focus")).is_none(),
            "feature off"
        );
        preferences.features.away_detection.enabled = true;
        assert!(watched(&snap(&preferences, "focus")).is_some());
        assert!(watched(&snap(&preferences, "break")).is_none());
        preferences.features.focus = false;
        assert!(watched(&snap(&preferences, "focus")).is_none());
    }
}
