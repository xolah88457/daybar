use crate::{contracts::*, sleep, store::Store, validation::Result};
use chrono::{DateTime, Local};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{
        mpsc::{self, Sender},
        Arc,
    },
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_notification::NotificationExt;

pub struct Backend {
    pub store: Arc<Store>,
    tx: Sender<Signal>,
    app: AppHandle,
}
enum Signal {
    Changed,
    WatchError(String),
}
impl Backend {
    pub fn changed(&self) {
        let _ = self.tx.send(Signal::Changed);
        let _ = self.app.emit("daybar://changed", ());
    }
}
fn error(app: &AppHandle, store: &Store, source: &str, message: String) {
    store.report(source, Some(message.clone()));
    let _ = app.emit(
        "daybar://error",
        DataIssue {
            file: source.into(),
            message,
        },
    );
    let _ = app.emit("daybar://changed", ());
}
pub fn validate_shortcut(value: &str) -> Result<()> {
    if !value.is_empty() {
        value.parse::<Shortcut>().map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn apply_os_preferences(app: &AppHandle, old: &Preferences, new: &Preferences) -> Result<()> {
    validate_shortcut(&new.global_shortcut)?;
    if old.global_shortcut != new.global_shortcut {
        // Register first so a conflicting shortcut cannot silently remove the working one.
        if !new.global_shortcut.is_empty() {
            app.global_shortcut()
                .register(new.global_shortcut.as_str())
                .map_err(|e| e.to_string())?;
        }
        if !old.global_shortcut.is_empty()
            && app
                .global_shortcut()
                .is_registered(old.global_shortcut.as_str())
        {
            if let Err(e) = app
                .global_shortcut()
                .unregister(old.global_shortcut.as_str())
            {
                if !new.global_shortcut.is_empty() {
                    let _ = app
                        .global_shortcut()
                        .unregister(new.global_shortcut.as_str());
                }
                return Err(e.to_string());
            }
        }
    }
    let autostart = if old.launch_at_login != new.launch_at_login {
        if new.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
    } else {
        Ok(())
    };
    if let Err(e) = autostart {
        rollback_shortcut(app, old, new);
        return Err(e.to_string());
    }
    #[cfg(target_os = "macos")]
    if let Err(e) = app.set_activation_policy(if new.hide_dock {
        tauri::ActivationPolicy::Accessory
    } else {
        tauri::ActivationPolicy::Regular
    }) {
        rollback_shortcut(app, old, new);
        if old.launch_at_login != new.launch_at_login {
            if old.launch_at_login {
                let _ = app.autolaunch().enable();
            } else {
                let _ = app.autolaunch().disable();
            }
        }
        return Err(e.to_string());
    }
    Ok(())
}
fn rollback_shortcut(app: &AppHandle, old: &Preferences, new: &Preferences) {
    if old.global_shortcut != new.global_shortcut {
        if !new.global_shortcut.is_empty() {
            let _ = app
                .global_shortcut()
                .unregister(new.global_shortcut.as_str());
        }
        if !old.global_shortcut.is_empty() {
            let _ = app.global_shortcut().register(old.global_shortcut.as_str());
        }
    }
}
fn open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn native_mutate(app: &AppHandle, op: Operation) {
    let app = app.clone();
    std::thread::spawn(move || {
        let backend = app.state::<Backend>();
        if matches!(op, Operation::StartTimer { .. }) {
            if let Ok(snap) = backend.store.snapshot() {
                if let Ok(v) = sleep::view(&snap.sleep, &snap.settings.sleep, Local::now()) {
                    let left = (v.bed - Local::now()).num_seconds();
                    if !v.asleep
                        && left > 0
                        && left <= i64::from(snap.settings.sleep.no_phone_minutes) * 60
                    {
                        let _ = app
                            .notification()
                            .builder()
                            .title("No phone time")
                            .body("Open Daybar Focus to confirm starting a session near bedtime.")
                            .show();
                        open(&app);
                        return;
                    }
                }
            }
        }
        if let Err(e) = backend.store.mutate(op) {
            error(&app, &backend.store, "mutation", e);
        } else {
            backend.store.report("mutation", None);
        }
        backend.changed();
    });
}
pub fn toggle_focus(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let backend = app.state::<Backend>();
        match backend.store.snapshot() {
            Ok(s) => native_mutate(
                &app,
                if s.focus.state.is_some() {
                    Operation::StopTimer
                } else {
                    Operation::StartTimer {
                        timer_type: "focus".into(),
                        minutes: s.settings.focus.focus_options[0],
                        task: None,
                    }
                },
            ),
            Err(e) => error(&app, &backend.store, "shortcut", e),
        }
    });
}
fn on_menu(app: &AppHandle, id: &str) {
    if id == "open" {
        open(app);
    } else if id == "quit" {
        app.exit(0);
    } else if id == "stop" {
        native_mutate(app, Operation::StopTimer);
    } else if let Some(rest) = id.strip_prefix("start:") {
        if let Some((kind, minutes)) = rest.split_once(':') {
            if let Ok(minutes) = minutes.split(':').next().unwrap_or("").parse() {
                native_mutate(
                    app,
                    Operation::StartTimer {
                        timer_type: kind.into(),
                        minutes,
                        task: None,
                    },
                );
            }
        }
    } else if let Some(task) = id.strip_prefix("task:") {
        let app = app.clone();
        let task = task.to_string();
        std::thread::spawn(move || {
            let backend = app.state::<Backend>();
            let result = (|| {
                let s = backend.store.snapshot()?;
                let date = Local::now().format("%Y-%m-%d").to_string();
                let done = !s.daily_log.get(&date).is_some_and(|ts| ts.contains(&task));
                backend
                    .store
                    .mutate(Operation::SetTask { date, task, done })?;
                Ok::<_, String>(())
            })();
            if let Err(e) = result {
                error(&app, &backend.store, "mutation", e);
            } else {
                backend.store.report("mutation", None);
            }
            backend.changed();
        });
    }
}
fn build_menu(app: &AppHandle, s: &Snapshot) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for (label, kind, options) in [
        ("Focus", "focus", &s.settings.focus.focus_options),
        ("Break", "break", &s.settings.focus.break_options),
        ("Long break", "break", &s.settings.focus.long_break_options),
    ] {
        for (i, m) in options.iter().enumerate() {
            let item = MenuItem::with_id(
                app,
                format!("start:{kind}:{m}:{label}:{i}"),
                format!("{label} {m} min"),
                s.focus.state.is_none(),
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }
    menu.append(&MenuItem::with_id(
        app,
        "stop",
        "Stop timer / count time worked",
        s.focus.state.is_some(),
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    for task in &s.settings.habits.tasks {
        menu.append(&CheckMenuItem::with_id(
            app,
            format!("task:{task}"),
            task,
            true,
            s.daily_log.get(&today).is_some_and(|ts| ts.contains(task)),
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "open",
        "Open Daybar",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "Quit Daybar",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}
#[derive(Clone, Debug)]
struct Alert {
    id: String,
    at: i64,
    title: &'static str,
    body: &'static str,
}
fn deadlines(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let mut out = Vec::new();
    if s.settings.focus.alerts {
        if let Some(timer) = &s.focus.state {
            if timer.end > now.timestamp_millis() {
                out.push(Alert {
                    id: format!("timer:{}", timer.start),
                    at: timer.end,
                    title: if timer.r#type == "focus" {
                        "Focus session done"
                    } else {
                        "Break over"
                    },
                    body: if timer.r#type == "focus" {
                        "Nice work. Take a break."
                    } else {
                        "Ready for the next session?"
                    },
                });
            }
        }
    }
    if s.settings.sleep.bedtime_alerts {
        if let Ok(v) = sleep::view(&s.sleep, &s.settings.sleep, now) {
            if !v.asleep {
                for (id, minutes, title, body) in [
                    (
                        "routine",
                        s.settings.sleep.routine_minutes,
                        "Night routine",
                        "Bed prep time.",
                    ),
                    (
                        "no-phone",
                        s.settings.sleep.no_phone_minutes,
                        "No phone time",
                        "Phone away. Bedtime is approaching.",
                    ),
                    (
                        "bed",
                        0,
                        "Bedtime",
                        "Time to sleep so you get your full night.",
                    ),
                ] {
                    let at = v.bed.timestamp_millis() - i64::from(minutes) * 60_000;
                    if at > now.timestamp_millis() {
                        out.push(Alert {
                            id: format!("{id}:{}", v.bed.timestamp_millis()),
                            at,
                            title,
                            body,
                        });
                    }
                }
            }
        }
    }
    out.sort_by_key(|a| a.at);
    out
}
fn alert_current(
    alert: &Alert,
    latest: &Snapshot,
    scheduled: &Snapshot,
    now: DateTime<Local>,
) -> bool {
    if latest
        .issues
        .iter()
        .any(|i| !i.file.starts_with("runtime:"))
    {
        return false;
    }
    if let Some(id) = alert.id.strip_prefix("timer:") {
        return latest.settings.focus.alerts
            && (latest
                .focus
                .state
                .as_ref()
                .is_some_and(|s| s.start.to_string() == id && s.end == alert.at)
                || latest
                    .focus
                    .sessions
                    .as_ref()
                    .and_then(|m| m.get(id))
                    .is_some_and(|s| s.end == alert.at));
    }
    if !latest.settings.sleep.bedtime_alerts {
        return false;
    }
    // Preserve tonight's scheduled alert across midnight unless its actual inputs changed.
    if serde_json::to_value((&latest.sleep, &latest.settings.sleep)).ok()
        == serde_json::to_value((&scheduled.sleep, &scheduled.settings.sleep)).ok()
    {
        return true;
    }
    sleep::view(&latest.sleep, &latest.settings.sleep, now).is_ok_and(|v| {
        alert
            .id
            .ends_with(&format!(":{}", v.bed.timestamp_millis()))
    })
}
fn tray_title(s: &Snapshot, now: DateTime<Local>) -> String {
    if let Some(timer) = &s.focus.state {
        let secs = ((timer.end - now.timestamp_millis() + 999) / 1000).max(0);
        format!(
            "{} {}:{:02}",
            if timer.r#type == "focus" {
                "Focus"
            } else {
                "Break"
            },
            secs / 60,
            secs % 60
        )
    } else {
        sleep::view(&s.sleep, &s.settings.sleep, now)
            .map(|v| sleep::title(&v, now))
            .unwrap_or_else(|_| "Daybar".into())
    }
}
fn watch(root: &std::path::Path, tx: Sender<Signal>) -> Result<RecommendedWatcher> {
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                if !matches!(event.kind, EventKind::Access(_))
                    && event.paths.iter().any(|p| {
                        p.file_name().is_some_and(|n| {
                            let n = n.to_string_lossy();
                            !n.starts_with(".daybar-")
                                && (n.ends_with(".json") || n.ends_with(".icloud"))
                        })
                    })
                {
                    let _ = tx.send(Signal::Changed);
                }
            }
            Err(e) => {
                let _ = tx.send(Signal::WatchError(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    watcher
        .watch(root, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    Ok(watcher)
}
pub fn start(app: AppHandle, store: Store) -> Result<Backend> {
    let store = Arc::new(store);
    let (tx, rx) = mpsc::channel();
    let tray = TrayIconBuilder::with_id("daybar")
        .title("Daybar")
        .tooltip("Daybar")
        .on_menu_event(|app, e| on_menu(app, e.id.as_ref()))
        .build(&app)
        .map_err(|e| e.to_string())?;
    let prefs = store.preferences()?;
    let mut initial = prefs.clone();
    initial.global_shortcut.clear();
    initial.launch_at_login = false;
    // Do not change launch-at-login registration during debug startup/tests.
    if cfg!(debug_assertions) {
        initial.launch_at_login = prefs.launch_at_login;
    }
    if let Err(e) = apply_os_preferences(&app, &initial, &prefs) {
        error(&app, &store, "OS preferences", e);
    }
    let worker_app = app.clone();
    let worker_store = store.clone();
    let worker_tx = tx.clone();
    std::thread::Builder::new()
        .name("daybar-runtime".into())
        .spawn(move || worker(worker_app, worker_store, worker_tx, rx, tray))
        .map_err(|e| e.to_string())?;
    Ok(Backend { store, tx, app })
}
fn worker(
    app: AppHandle,
    store: Arc<Store>,
    tx: Sender<Signal>,
    rx: mpsc::Receiver<Signal>,
    tray: TrayIcon<tauri::Wry>,
) {
    let mut root = PathBuf::new();
    let mut watcher = None;
    let mut snapshot = None;
    let mut pending = Vec::<Alert>::new();
    let mut fired = BTreeSet::new();
    let mut menu_key = String::new();
    let mut title = String::new();
    let mut refresh = true;
    let mut minute = -1;
    loop {
        let now = Local::now();
        let mut expired = false;
        let latest = if pending.iter().any(|a| a.at <= now.timestamp_millis()) {
            store.inspect().ok()
        } else {
            None
        };
        for alert in pending.iter().filter(|a| a.at <= now.timestamp_millis()) {
            let current = latest
                .as_ref()
                .zip(snapshot.as_ref())
                .is_some_and(|(latest, scheduled)| alert_current(alert, latest, scheduled, now));
            expired = true;
            if current && fired.insert(alert.id.clone()) {
                if let Err(e) = app
                    .notification()
                    .builder()
                    .title(alert.title)
                    .body(alert.body)
                    .show()
                {
                    error(&app, &store, "notifications", e.to_string());
                }
                expired = true;
            }
        }
        pending.retain(|a| a.at > now.timestamp_millis());
        let current_minute = now.timestamp_millis() / 60_000;
        if refresh || expired || current_minute != minute {
            match store.root() {
                Ok(next) if next != root || watcher.is_none() => {
                    watcher.take();
                    match watch(&next, tx.clone()) {
                        Ok(w) => {
                            watcher = Some(w);
                            store.report("watcher", None);
                        }
                        Err(e) => error(&app, &store, "watcher", e),
                    }
                    root = next;
                }
                Ok(_) => (),
                Err(e) => error(&app, &store, "folder", e),
            }
            match store.snapshot() {
                Ok(s) => {
                    store.report("snapshot", None);
                    // Fingerprint only menu inputs: title updates every second do not rebuild menus.
                    let day = now.format("%Y-%m-%d").to_string();
                    let key = serde_json::to_string(&(
                        &s.settings.focus,
                        &s.settings.habits.tasks,
                        s.daily_log.get(&day),
                        s.focus.state.is_some(),
                        &day,
                    ))
                    .unwrap_or_default();
                    if key != menu_key {
                        match build_menu(&app, &s).and_then(|m| tray.set_menu(Some(m))) {
                            Ok(()) => menu_key = key,
                            Err(e) => error(&app, &store, "tray", e.to_string()),
                        }
                    }
                    pending = deadlines(&s, now)
                        .into_iter()
                        .filter(|a| !fired.contains(&a.id))
                        .collect();
                    snapshot = Some(s);
                }
                Err(e) => error(&app, &store, "snapshot", e),
            }
            if refresh || expired {
                let _ = app.emit("daybar://changed", ());
            }
            refresh = false;
            minute = current_minute;
        }
        if let Some(s) = &snapshot {
            let next = tray_title(s, now);
            if next != title {
                if let Err(e) = tray.set_title(Some(&next)) {
                    error(&app, &store, "tray", e.to_string());
                }
                title = next;
            }
        }
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(signal) => {
                refresh = true;
                for event in std::iter::once(signal).chain(rx.try_iter()) {
                    if let Signal::WatchError(e) = event {
                        error(&app, &store, "watcher", e);
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scheduler_cancels_and_titles_clamp() {
        let now = Local::now();
        let s = Snapshot {
            settings: Settings::default(),
            daily_log: Default::default(),
            focus: FocusData {
                state: Some(TimerState {
                    r#type: "focus".into(),
                    minutes: 1,
                    start: now.timestamp_millis() - 60_001,
                    end: now.timestamp_millis() - 1,
                    task: None,
                }),
                ..Default::default()
            },
            sleep: SleepData::default(),
            preferences: Preferences {
                data_folder: "/sandbox".into(),
                real_data: false,
                launch_at_login: false,
                hide_dock: false,
                global_shortcut: String::new(),
            },
            issues: vec![],
            conflicts: vec![],
        };
        assert_eq!(tray_title(&s, now), "Focus 0:00");
        assert!(deadlines(&s, now)
            .iter()
            .all(|a| !a.id.starts_with("timer:")));
    }
    #[test]
    fn default_shortcut_is_valid_and_bad_shortcut_rejected() {
        validate_shortcut("CommandOrControl+Shift+F").unwrap();
        validate_shortcut("").unwrap();
        assert!(validate_shortcut("not a real shortcut").is_err());
    }
    #[test]
    fn scheduler_rebuild_removes_cancelled_or_disabled_alerts() {
        let now = Local::now();
        let mut s = Snapshot {
            settings: Settings::default(),
            daily_log: Default::default(),
            focus: FocusData::default(),
            sleep: SleepData::default(),
            preferences: Preferences {
                data_folder: "/sandbox".into(),
                real_data: false,
                launch_at_login: false,
                hide_dock: false,
                global_shortcut: String::new(),
            },
            issues: vec![],
            conflicts: vec![],
        };
        s.focus.state = Some(TimerState {
            r#type: "break".into(),
            minutes: 5,
            start: now.timestamp_millis(),
            end: now.timestamp_millis() + 300_000,
            task: None,
        });
        let a = deadlines(&s, now);
        assert!(a.iter().any(|a| a.title == "Break over"));
        let scheduled = s.clone();
        let timer = a.iter().find(|a| a.id.starts_with("timer:")).unwrap();
        s.focus.state = None;
        assert!(!alert_current(
            timer,
            &s,
            &scheduled,
            now + chrono::Duration::minutes(5)
        ));
        assert!(deadlines(&s, now)
            .iter()
            .all(|a| !a.id.starts_with("timer:")));
        s.settings.sleep.bedtime_alerts = false;
        assert!(deadlines(&s, now).is_empty());
    }
    #[test]
    fn watcher_observes_phone_edit() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let (tx, rx) = mpsc::channel();
        let _watch = watch(&root, tx).unwrap();
        std::fs::write(
            root.join("sleep-data.json"),
            r#"{"wakes":{},"beds":{},"plan":null}"#,
        )
        .unwrap();
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            Signal::Changed
        ));
    }
}
