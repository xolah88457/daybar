//! Run macOS Shortcuts when a focus session starts or ends.
//!
//! The hook is [`on_focus_change`], driven by the store's focus observer (see `store::FocusChange`):
//! it sees every committed change to the focus file, whichever path made it (window, tray, global
//! shortcut, or an expired timer settled on read), and reports each start and each end exactly once.
//! Shortcuts run through `/usr/bin/shortcuts run "<name>"` with no shell, one at a time on a worker
//! thread, each with a timeout, so a hung Shortcut can neither block the app nor pile up. Failures
//! are reported through the runtime error channel (a `runtime:shortcuts` issue). macOS only; the
//! hook and the Test command do nothing elsewhere.
//!
//! An end is reported when a focus session lands in the ledger, so a timer that finished while the
//! app was closed runs `onEnd` once, on the next launch, rather than never turning your Focus mode
//! back off.

use crate::{
    contracts::{FocusData, Preferences},
    store::FocusChange,
};
use std::{
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub const ID: &str = "focusShortcuts";
#[cfg(target_os = "macos")]
const BIN: &str = "/usr/bin/shortcuts";
/// A Shortcut that has not finished by now is killed and reported.
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Start,
    End,
}

/// Focus transitions between two saved states. `End` comes first, so a mutation that settles one
/// session and starts the next runs `onEnd` before `onStart`. Breaks never count.
pub fn phases(before: &FocusData, after: &FocusData) -> Vec<Phase> {
    let mut out = Vec::new();
    if let (Some(running), Some(sessions)) = (&before.state, &after.sessions) {
        let ended = sessions.get(&running.start.to_string());
        let was_listed = before
            .sessions
            .as_ref()
            .is_some_and(|s| s.contains_key(&running.start.to_string()));
        if running.r#type == "focus" && ended.is_some() && !was_listed {
            out.push(Phase::End);
        }
    }
    if let Some(now) = after.state.as_ref().filter(|s| s.r#type == "focus") {
        if before.state.as_ref().is_none_or(|b| b.start != now.start) {
            out.push(Phase::Start);
        }
    }
    out
}

/// The Shortcuts to run for a change: nothing unless the feature and the Focus module are on, and
/// never for an empty name.
pub fn due(prefs: &Preferences, before: &FocusData, after: &FocusData) -> Vec<(Phase, String)> {
    let f = &prefs.features;
    if !f.focus || !f.active(ID) {
        return vec![];
    }
    phases(before, after)
        .into_iter()
        .filter_map(|phase| {
            let name = match phase {
                Phase::Start => &f.focus_shortcuts.on_start,
                Phase::End => &f.focus_shortcuts.on_end,
            };
            let name = name.trim();
            (!name.is_empty()).then(|| (phase, name.to_string()))
        })
        .collect()
}

/// The one hook: call `run` for each Shortcut a committed change calls for. `run` is injectable so
/// tests need no macOS; the app passes [`enqueue`].
pub fn on_focus_change(change: &FocusChange, run: &dyn Fn(Phase, &str)) {
    for (phase, name) in due(change.preferences, change.before, change.after) {
        run(phase, &name);
    }
}

/// Runs `bin run <name>` without a shell and waits at most `timeout`; the error says what went wrong.
pub fn execute(bin: &str, name: &str, timeout: Duration) -> Result<(), String> {
    if name.starts_with('-') {
        return Err("A Shortcut name cannot start with “-”.".into());
    }
    let mut child = Command::new(bin)
        .args(["run", name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run {bin}: {e}"))?;
    // Drain stderr on its own thread so a chatty child can never block on a full pipe.
    let mut pipe = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(p) = pipe.as_mut() {
            let _ = p.take(8192).read_to_string(&mut text);
        }
        text
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                // The reader is left to finish on its own: a grandchild may still hold the pipe.
                return Err(format!(
                    "Shortcut “{name}” did not finish within {} s and was stopped.",
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("Could not wait for Shortcut “{name}”: {e}")),
        }
    };
    let stderr = reader.join().unwrap_or_default();
    if status.success() {
        return Ok(());
    }
    let detail = stderr.trim().lines().next().unwrap_or("").trim();
    Err(if detail.is_empty() {
        format!("Shortcut “{name}” failed ({status}).")
    } else {
        format!("Shortcut “{name}” failed: {detail}")
    })
}

#[cfg(target_os = "macos")]
fn run_shortcut(name: &str) -> Result<(), String> {
    execute(BIN, name, TIMEOUT)
}
#[cfg(not(target_os = "macos"))]
fn run_shortcut(_name: &str) -> Result<(), String> {
    Err("Shortcuts are only available on macOS.".into())
}

/// Reports the outcome of a background run: `Some(message)` on failure, `None` once one succeeds.
pub type Report = std::sync::Arc<dyn Fn(Option<String>) + Send + Sync>;

/// Queues a Shortcut for the single worker thread; returns at once. A no-op off macOS.
pub fn enqueue(name: &str, report: &Report) {
    #[cfg(target_os = "macos")]
    {
        use std::sync::{mpsc, OnceLock};
        static QUEUE: OnceLock<mpsc::Sender<(String, Report)>> = OnceLock::new();
        let tx = QUEUE.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<(String, Report)>();
            let _ = std::thread::Builder::new()
                .name("daybar-shortcuts".into())
                .spawn(move || {
                    for (name, report) in rx {
                        report(run_shortcut(&name).err());
                    }
                });
            tx
        });
        let _ = tx.send((name.to_string(), report.clone()));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (name, report);
}

/// Settings → Focus shortcuts → Test: runs one Shortcut and returns the failure, if any.
#[tauri::command]
pub async fn run_focus_shortcut(name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 120 || name.contains('\0') {
        return Err("Type the exact name of a Shortcut first.".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_shortcut(&name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{FocusSession, TimerState};
    use std::{cell::RefCell, collections::BTreeMap};

    fn timer(kind: &str, start: i64) -> TimerState {
        TimerState {
            r#type: kind.into(),
            minutes: 25,
            start,
            end: start + 25 * 60_000,
            task: None,
        }
    }
    fn data(state: Option<TimerState>, done: &[(i64, &str)]) -> FocusData {
        let sessions: BTreeMap<_, _> = done
            .iter()
            .map(|(start, kind)| {
                (
                    start.to_string(),
                    FocusSession {
                        r#type: (*kind).into(),
                        minutes: 25,
                        credited_minutes: 25,
                        end: start + 25 * 60_000,
                        date: "2026-11-16".into(),
                        task: None,
                    },
                )
            })
            .collect();
        FocusData {
            state,
            sessions: Some(sessions),
            baseline: Some(BTreeMap::new()),
            ..Default::default()
        }
    }
    fn prefs(on: bool, start: &str, end: &str) -> Preferences {
        let mut p: Preferences = serde_json::from_str(
            r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
        )
        .unwrap();
        p.features.focus_shortcuts.enabled = on;
        p.features.focus_shortcuts.on_start = start.into();
        p.features.focus_shortcuts.on_end = end.into();
        p
    }
    fn ran(p: &Preferences, before: &FocusData, after: &FocusData) -> Vec<(Phase, String)> {
        let log = RefCell::new(Vec::new());
        on_focus_change(
            &FocusChange {
                before,
                after,
                preferences: p,
            },
            &|phase, name| log.borrow_mut().push((phase, name.to_string())),
        );
        log.into_inner()
    }
    const T: i64 = 1_800_000_000_000;

    #[test]
    fn start_and_end_run_their_shortcuts_in_order() {
        let p = prefs(true, "Focus On", "Focus Off");
        let idle = data(None, &[]);
        let running = data(Some(timer("focus", T)), &[]);
        assert_eq!(
            ran(&p, &idle, &running),
            [(Phase::Start, "Focus On".into())]
        );
        // Stopped early or settled at the end: the session lands in the ledger.
        let stopped = data(None, &[(T, "focus")]);
        assert_eq!(
            ran(&p, &running, &stopped),
            [(Phase::End, "Focus Off".into())]
        );
        // One mutation that settles a finished timer and starts the next one: end, then start.
        let next = data(Some(timer("focus", T + 3_000_000)), &[(T, "focus")]);
        assert_eq!(
            ran(&p, &running, &next),
            [
                (Phase::End, "Focus Off".into()),
                (Phase::Start, "Focus On".into())
            ]
        );
    }

    #[test]
    fn breaks_and_unchanged_focus_never_run_anything() {
        let p = prefs(true, "A", "B");
        let idle = data(None, &[]);
        let brk = data(Some(timer("break", T)), &[]);
        assert!(ran(&p, &idle, &brk).is_empty());
        assert!(ran(&p, &brk, &data(None, &[(T, "break")])).is_empty());
        let running = data(Some(timer("focus", T)), &[]);
        assert!(ran(&p, &running, &running.clone()).is_empty());
    }

    #[test]
    fn disabled_module_off_or_empty_names_are_skipped() {
        let idle = data(None, &[]);
        let running = data(Some(timer("focus", T)), &[]);
        let stopped = data(None, &[(T, "focus")]);
        let off = prefs(false, "A", "B");
        assert!(ran(&off, &idle, &running).is_empty() && ran(&off, &running, &stopped).is_empty());
        let mut no_focus = prefs(true, "A", "B");
        no_focus.features.focus = false;
        assert!(ran(&no_focus, &idle, &running).is_empty());
        let only_end = prefs(true, "  ", "B");
        assert!(ran(&only_end, &idle, &running).is_empty());
        assert_eq!(ran(&only_end, &running, &stopped).len(), 1);
        assert!(ran(&prefs(true, "", ""), &running, &stopped).is_empty());
    }

    #[test]
    fn the_store_reports_each_start_and_end_once_whatever_path_made_it() {
        use crate::{contracts::Operation, store::Store};
        use std::sync::{Arc, Mutex};
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().canonicalize().unwrap(), None).unwrap();
        let mut p = store.preferences().unwrap();
        p.features.focus_shortcuts.enabled = true;
        p.features.focus_shortcuts.on_start = "On".into();
        p.features.focus_shortcuts.on_end = "Off".into();
        store.set_preferences(p).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        store.observe_focus(Box::new(move |c| {
            on_focus_change(c, &|phase, name| {
                log.lock().unwrap().push((phase, name.to_string()))
            })
        }));
        let now = chrono::Local::now().timestamp_millis();
        let t0 = now - 40 * 60_000;
        let start = |minutes| Operation::StartTimer {
            timer_type: "focus".into(),
            minutes,
            task: None,
        };
        store.mutate_at(start(25), t0).unwrap();
        // The timer ran out while nobody was looking: the next read settles it (and reports it once).
        store.snapshot().unwrap();
        store.snapshot().unwrap();
        store.mutate_at(Operation::SettleTimer, now).unwrap();
        // A second session started by one mutation settles nothing and stops early.
        store.mutate_at(start(25), now + 1_000).unwrap();
        store.mutate_at(Operation::StopTimer, now + 61_000).unwrap();
        store.mutate_at(Operation::StopTimer, now + 62_000).unwrap();
        assert_eq!(
            *seen.lock().unwrap(),
            [
                (Phase::Start, "On".to_string()),
                (Phase::End, "Off".to_string()),
                (Phase::Start, "On".to_string()),
                (Phase::End, "Off".to_string()),
            ]
        );
    }

    #[cfg(unix)]
    fn script(dir: &std::path::Path, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-shortcuts");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }
    #[cfg(unix)]
    #[test]
    fn execute_reports_success_failure_missing_binary_and_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let secs = Duration::from_secs(5);
        let ok = script(dir.path(), r#"[ "$1" = run ] && [ "$2" = "My Shortcut" ]"#);
        assert!(execute(&ok, "My Shortcut", secs).is_ok());
        let bad = script(
            dir.path(),
            "echo \"Error: Couldn't find shortcut\" >&2; exit 1",
        );
        let e = execute(&bad, "Nope", secs).unwrap_err();
        assert!(
            e.contains("Nope") && e.contains("Couldn't find shortcut"),
            "{e}"
        );
        let e = execute("/nonexistent/shortcuts", "x", secs).unwrap_err();
        assert!(e.contains("Could not run"), "{e}");
        let hang = script(dir.path(), "sleep 30");
        let started = Instant::now();
        let e = execute(&hang, "Slow", Duration::from_millis(300)).unwrap_err();
        assert!(
            e.contains("did not finish") && started.elapsed() < Duration::from_secs(5),
            "{e}"
        );
        assert!(execute(&ok, "-h", secs).is_err());
    }
}
