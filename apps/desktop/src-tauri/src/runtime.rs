use crate::{
    contracts::*,
    features::{self, Alert, AlertKind},
    sleep,
    store::Store,
    validation::Result,
};
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
fn quiet_focus_start(s: &Snapshot, op: &Operation, now: DateTime<Local>) -> bool {
    if !matches!(op, Operation::StartTimer { timer_type, .. } if timer_type == "focus") {
        return false;
    }
    // With the Sleep module off there is no bedtime, so there is no no-phone time to confirm.
    if !s.preferences.features.sleep {
        return false;
    }
    sleep::view(&s.sleep, &s.settings.sleep, now).is_ok_and(|v| {
        let left = (v.bed - now).num_seconds();
        !v.asleep && left > 0 && left <= i64::from(s.settings.sleep.no_phone_minutes) * 60
    })
}
fn finish_mutation(app: &AppHandle, backend: &Backend, result: Result<()>) {
    match result {
        Ok(()) => backend.store.report("mutation", None),
        Err(e) => error(app, &backend.store, "mutation", e),
    }
    backend.changed();
}
fn native_mutate(app: &AppHandle, op: Operation) {
    let app = app.clone();
    std::thread::spawn(move || {
        let backend = app.state::<Backend>();
        if let Ok(snap) = backend.store.snapshot() {
            // Timer operations belong to the Focus module: hidden means inert.
            if !snap.preferences.features.focus {
                return;
            }
            if quiet_focus_start(&snap, &op, Local::now()) {
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
        finish_mutation(&app, &backend, backend.store.mutate(op).map(drop));
    });
}
fn toggle_focus_operation(s: &Snapshot) -> Option<Operation> {
    if !s.preferences.features.focus {
        return None;
    }
    Some(if s.focus.state.is_some() {
        Operation::StopTimer
    } else {
        Operation::StartTimer {
            timer_type: "focus".into(),
            minutes: s.settings.focus.focus_options[0],
            task: None,
        }
    })
}
pub fn toggle_focus(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let backend = app.state::<Backend>();
        match backend.store.snapshot() {
            Ok(s) => match toggle_focus_operation(&s) {
                Some(op) => native_mutate(&app, op),
                // Focus is switched off: the shortcut only brings the window forward.
                None => open(&app),
            },
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
                if !s.preferences.features.habits {
                    return Ok(());
                }
                let date = Local::now().format("%Y-%m-%d").to_string();
                let done = !s.daily_log.get(&date).is_some_and(|ts| ts.contains(&task));
                backend
                    .store
                    .mutate(Operation::SetTask { date, task, done })?;
                Ok(())
            })();
            finish_mutation(&app, &backend, result);
        });
    }
}
fn build_menu(app: &AppHandle, s: &Snapshot) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let features = &s.preferences.features;
    // Items of a module that is switched off are left out entirely.
    if features.focus {
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
    }
    if features.habits {
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
    }
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
fn deadlines(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let mut out = Vec::new();
    // A module that is switched off schedules nothing; its data stays untouched.
    if s.preferences.features.focus && s.settings.focus.alerts {
        if let Some(timer) = &s.focus.state {
            if timer.end > now.timestamp_millis() {
                out.push(Alert {
                    id: format!("timer:{}", timer.start),
                    at: timer.end,
                    title: if timer.r#type == "focus" {
                        "Focus session done"
                    } else {
                        "Break over"
                    }
                    .into(),
                    body: if timer.r#type == "focus" {
                        "Nice work. Take a break."
                    } else {
                        "Ready for the next session?"
                    }
                    .into(),
                    kind: AlertKind::Focus,
                });
            }
        }
    }
    if s.preferences.features.sleep && s.settings.sleep.bedtime_alerts {
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
                            title: title.into(),
                            body: body.into(),
                            kind: AlertKind::Sleep,
                        });
                    }
                }
            }
        }
    }
    out.extend(features::alerts(s, now));
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
    match alert.kind {
        AlertKind::Feature { .. } => return features::is_current(alert, latest),
        AlertKind::Focus if !latest.preferences.features.focus => return false,
        AlertKind::Sleep if !latest.preferences.features.sleep => return false,
        _ => (),
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
fn countdown_label(timer: &TimerState, now: DateTime<Local>) -> String {
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
}
fn bedtime_title(s: &Snapshot, now: DateTime<Local>) -> String {
    sleep::view(&s.sleep, &s.settings.sleep, now)
        .map(|v| sleep::title(&v, now))
        .unwrap_or_else(|_| "Daybar".into())
}
// Auto: the running timer, otherwise time until bed. Modules that are off are skipped.
fn timer_title(s: &Snapshot, now: DateTime<Local>) -> String {
    let features = &s.preferences.features;
    match &s.focus.state {
        Some(timer) if features.focus => countdown_label(timer, now),
        _ if features.sleep => bedtime_title(s, now),
        _ => "Daybar".into(),
    }
}
// A display mode that belongs to a module that is off behaves as Auto.
fn effective_display(s: &Snapshot) -> TrayDisplay {
    use crate::contracts::TrayDisplay::*;
    let features = &s.preferences.features;
    let wanted = s.preferences.tray_display;
    let available = match wanted {
        Auto => true,
        FocusMinutes | FocusHours | FocusBlocks | ActiveTimer => features.focus,
        Bedtime => features.sleep,
        NextTask => features.habits,
        Countdown => features.countdown,
    };
    if available {
        wanted
    } else {
        Auto
    }
}
fn tray_title(s: &Snapshot, now: DateTime<Local>) -> String {
    use crate::contracts::TrayDisplay::*;
    use chrono::NaiveDate;
    let today = now.format("%Y-%m-%d").to_string();
    match effective_display(s) {
        Auto => timer_title(s, now),
        FocusMinutes => format!("{} min", s.focus.days.get(&today).map_or(0, |d| d.minutes)),
        FocusHours => {
            let minutes = s.focus.days.get(&today).map_or(0, |d| d.minutes);
            format!("{}h {}m", minutes / 60, minutes % 60)
        }
        FocusBlocks => format!("{} blocks", s.focus.days.get(&today).map_or(0, |d| d.count)),
        ActiveTimer => s
            .focus
            .state
            .as_ref()
            .map_or_else(|| "Timer idle".into(), |timer| countdown_label(timer, now)),
        Bedtime => bedtime_title(s, now),
        NextTask => {
            let h = &s.settings.habits;
            if today < h.start_date
                || (!h.end_date.is_empty() && today > h.end_date)
                || h.tasks.is_empty()
            {
                "No tasks today".into()
            } else if let Some(task) = h.tasks.iter().find(|task| {
                !s.daily_log
                    .get(&today)
                    .is_some_and(|done| done.contains(task))
            }) {
                let label: String = task.chars().take(24).collect();
                if task.chars().count() > 24 {
                    format!("Task: {}…", label.trim_end())
                } else {
                    format!("Task: {label}")
                }
            } else {
                "All tasks done".into()
            }
        }
        Countdown => {
            let parse = |value: &str| NaiveDate::parse_from_str(value, "%Y-%m-%d");
            let (Ok(start), Ok(end)) = (
                parse(&s.settings.countdown.start_date),
                parse(&s.settings.countdown.end_date),
            ) else {
                return "Daybar".into();
            };
            let day = now.date_naive();
            let total = (end - start).num_days() + 1;
            let remaining = if day >= end {
                0
            } else {
                (end - day).num_days().min(total).max(0)
            };
            format!("{remaining}d")
        }
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
    // Focus extras: run the user's Shortcuts on every committed focus start/end (any path), and
    // keep the away-detection state the scheduler thread updates.
    let report: features::shortcuts::Report = {
        let (app, store) = (app.clone(), Arc::downgrade(&store));
        Arc::new(move |failure| {
            let Some(store) = store.upgrade() else { return };
            match failure {
                Some(message) => error(&app, &store, "shortcuts", message),
                None => {
                    store.report("shortcuts", None);
                    let _ = app.emit("daybar://changed", ());
                }
            }
        })
    };
    store.observe_focus(Box::new(move |change| {
        features::shortcuts::on_focus_change(change, &|_, name| {
            features::shortcuts::enqueue(name, &report)
        })
    }));
    app.manage(features::away::AwayState::default());
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
    let mut woken = None;
    loop {
        let now = Local::now();
        let mut expired = false;
        // Auto-cycle: settle a due focus timer promptly even when its alert is off.
        if snapshot.as_ref().is_some_and(|s| {
            features::autocycle::wants_refresh(s, now.timestamp_millis(), &mut woken)
        }) {
            refresh = true;
        }
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
                // Auto-cycle: settle the finished timer and start the break first, so this
                // notification can say so. Idempotent: the refresh below finds it already started.
                let mut body = alert.body.clone();
                if alert.id.starts_with("timer:")
                    && latest
                        .as_ref()
                        .is_some_and(|l| l.preferences.features.active("autoCycle"))
                {
                    match features::autocycle::settle_and_run(&store, now.timestamp_millis()) {
                        Ok(Some(minutes)) => body = features::autocycle::started_body(minutes),
                        Ok(None) => (),
                        Err(e) => error(&app, &store, "auto-cycle", e),
                    }
                }
                let mut note = app
                    .notification()
                    .builder()
                    .title(alert.title.clone())
                    .body(body);
                // Only the hourly chime names a sound; every other alert stays as it was.
                if let Some(sound) = features::chime::sound(alert) {
                    note = note.sound(sound);
                }
                if let Err(e) = note.show() {
                    error(&app, &store, "notifications", e.to_string());
                }
            }
        }
        pending.retain(|a| a.at > now.timestamp_millis());
        let current_minute = now.timestamp_millis() / 60_000;
        let mut cycled = false;
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
                        &s.preferences.features,
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
                    // Auto-cycle: right after settlement, start the break the saved state calls for.
                    match features::autocycle::run(&store, &s, now.timestamp_millis()) {
                        Ok(started) => cycled = started.is_some(),
                        Err(e) => error(&app, &store, "auto-cycle", e),
                    }
                    snapshot = Some(s);
                }
                Err(e) => error(&app, &store, "snapshot", e),
            }
            if refresh || expired {
                let _ = app.emit("daybar://changed", ());
            }
            refresh = cycled;
            minute = current_minute;
        }
        if let Some(s) = &snapshot {
            // Away detection reads the idle time only while a focus timer runs (every ~30 s).
            features::away::poll(&app, s, now.timestamp_millis());
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
    fn snapshot(tray_display: TrayDisplay) -> Snapshot {
        Snapshot {
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
                theme_mode: ThemeMode::Night,
                tray_display,
                features: Features::default(),
            },
            issues: vec![],
            conflicts: vec![],
        }
    }
    #[test]
    fn scheduler_cancels_and_titles_clamp() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 11, 15, 23, 30, 0)
            .single()
            .unwrap();
        let s = Snapshot {
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
            ..snapshot(TrayDisplay::Auto)
        };
        assert_eq!(tray_title(&s, now), "Focus 0:00");
        assert!(deadlines(&s, now)
            .iter()
            .all(|a| !a.id.starts_with("timer:")));
        let start = |timer_type: &str| Operation::StartTimer {
            timer_type: timer_type.into(),
            minutes: 25,
            task: None,
        };
        assert!(quiet_focus_start(&s, &start("focus"), now));
        assert!(!quiet_focus_start(&s, &start("break"), now));
        assert!(!quiet_focus_start(&s, &Operation::StopTimer, now));
        assert!(!quiet_focus_start(
            &s,
            &start("focus"),
            now - chrono::Duration::hours(2)
        ));
        assert!(!quiet_focus_start(
            &s,
            &start("focus"),
            now + chrono::Duration::hours(1)
        ));
    }
    #[test]
    fn tray_display_modes_use_credited_totals_dates_and_ordered_tasks() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 11, 15, 12, 0, 0)
            .single()
            .unwrap();
        let today = now.format("%Y-%m-%d").to_string();
        let mut s = Snapshot {
            focus: FocusData {
                days: std::collections::BTreeMap::from([
                    (
                        today.clone(),
                        FocusDay {
                            count: 3,
                            minutes: 85,
                        },
                    ),
                    (
                        "2026-11-14".into(),
                        FocusDay {
                            count: 99,
                            minutes: 999,
                        },
                    ),
                ]),
                ..Default::default()
            },
            ..snapshot(TrayDisplay::FocusMinutes)
        };
        for (mode, expected) in [
            (TrayDisplay::FocusMinutes, "85 min"),
            (TrayDisplay::FocusHours, "1h 25m"),
            (TrayDisplay::FocusBlocks, "3 blocks"),
        ] {
            s.preferences.tray_display = mode;
            assert_eq!(tray_title(&s, now), expected);
        }
        s.focus.state = Some(TimerState {
            r#type: "break".into(),
            minutes: 5,
            start: now.timestamp_millis(),
            end: now.timestamp_millis() + 90_000,
            task: None,
        });
        s.preferences.tray_display = TrayDisplay::FocusMinutes;
        assert_eq!(tray_title(&s, now), "85 min");
        s.preferences.tray_display = TrayDisplay::ActiveTimer;
        assert_eq!(tray_title(&s, now), "Break 1:30");
        s.focus.state.as_mut().unwrap().end = now.timestamp_millis() - 1;
        assert_eq!(tray_title(&s, now), "Break 0:00");
        s.focus.state = None;
        assert_eq!(tray_title(&s, now), "Timer idle");
        s.focus.days.clear();
        s.preferences.tray_display = TrayDisplay::FocusMinutes;
        assert_eq!(tray_title(&s, now), "0 min");
        s.preferences.tray_display = TrayDisplay::FocusHours;
        assert_eq!(tray_title(&s, now), "0h 0m");
        s.preferences.tray_display = TrayDisplay::FocusBlocks;
        assert_eq!(tray_title(&s, now), "0 blocks");
        s.focus.days.insert(
            "2026-11-16".into(),
            FocusDay {
                count: 2,
                minutes: 50,
            },
        );
        let before_midnight = Local
            .with_ymd_and_hms(2026, 11, 15, 23, 59, 59)
            .single()
            .unwrap();
        let after_midnight = Local
            .with_ymd_and_hms(2026, 11, 16, 0, 0, 0)
            .single()
            .unwrap();
        s.preferences.tray_display = TrayDisplay::FocusMinutes;
        assert_eq!(tray_title(&s, before_midnight), "0 min");
        assert_eq!(tray_title(&s, after_midnight), "50 min");
        s.focus.state = Some(TimerState {
            r#type: "focus".into(),
            minutes: 1,
            start: now.timestamp_millis(),
            end: now.timestamp_millis() + 30_000,
            task: None,
        });
        s.preferences.tray_display = TrayDisplay::ActiveTimer;
        assert_eq!(tray_title(&s, now), "Focus 0:30");
        s.focus.state = None;
        s.preferences.tray_display = TrayDisplay::Bedtime;
        assert!(tray_title(&s, now).ends_with("→ bed"));
        s.preferences.tray_display = TrayDisplay::NextTask;
        s.settings.habits.tasks = vec!["First task".into(), "Second task".into()];
        s.daily_log.insert(today.clone(), vec!["First task".into()]);
        assert_eq!(tray_title(&s, now), "Task: Second task");
        s.daily_log
            .insert(today.clone(), s.settings.habits.tasks.clone());
        assert_eq!(tray_title(&s, now), "All tasks done");
        s.settings.habits.tasks = vec!["🌿 One very long unicode task label".into()];
        s.daily_log.remove(&today);
        assert_eq!(tray_title(&s, now), "Task: 🌿 One very long unicode…");
        s.settings.habits.start_date = "2026-11-16".into();
        assert_eq!(tray_title(&s, now), "No tasks today");
    }
    #[test]
    fn tray_countdown_matches_remaining_days_and_auto_preserves_legacy_title() {
        use chrono::TimeZone;
        let mut s = snapshot(TrayDisplay::Countdown);
        let at = |y, m, d| Local.with_ymd_and_hms(y, m, d, 12, 0, 0).single().unwrap();
        s.settings.countdown.start_date = "2026-11-15".into();
        s.settings.countdown.end_date = "2027-07-01".into();
        assert_eq!(tray_title(&s, at(2026, 11, 14)), "229d");
        assert_eq!(tray_title(&s, at(2026, 11, 15)), "228d");
        s.settings.countdown.start_date = "2026-11-15".into();
        s.settings.countdown.end_date = "2026-11-15".into();
        assert_eq!(tray_title(&s, at(2026, 11, 15)), "0d");
        assert_eq!(tray_title(&s, at(2026, 11, 16)), "0d");
        s.preferences.tray_display = TrayDisplay::Auto;
        s.focus.state = Some(TimerState {
            r#type: "focus".into(),
            minutes: 5,
            start: at(2026, 11, 15).timestamp_millis(),
            end: at(2026, 11, 15).timestamp_millis() + 60_000,
            task: None,
        });
        assert_eq!(tray_title(&s, at(2026, 11, 15)), "Focus 1:00");
        s.focus.state = None;
        assert!(tray_title(&s, at(2026, 11, 15)).ends_with("→ bed"));
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
        let mut s = snapshot(TrayDisplay::Auto);
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
    fn timer(now: DateTime<Local>, kind: &str, minutes: i64) -> TimerState {
        TimerState {
            r#type: kind.into(),
            minutes: minutes as u32,
            start: now.timestamp_millis(),
            end: now.timestamp_millis() + minutes * 60_000,
            task: None,
        }
    }
    #[test]
    fn disabled_modules_stop_their_alerts_and_stale_ones_are_not_current() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 11, 15, 12, 0, 0)
            .single()
            .unwrap();
        let mut s = snapshot(TrayDisplay::Auto);
        s.focus.state = Some(timer(now, "focus", 25));
        let all = deadlines(&s, now);
        assert!(all.iter().any(|a| a.kind == AlertKind::Focus));
        assert!(all.iter().any(|a| a.kind == AlertKind::Sleep));
        let sleep_alert = all.iter().find(|a| a.kind == AlertKind::Sleep).unwrap();
        let focus_alert = all.iter().find(|a| a.kind == AlertKind::Focus).unwrap();
        let later = now + chrono::Duration::hours(30);
        let mut off = s.clone();
        off.preferences.features.focus = false;
        let kinds: Vec<_> = deadlines(&off, now).into_iter().map(|a| a.kind).collect();
        assert!(!kinds.contains(&AlertKind::Focus) && kinds.contains(&AlertKind::Sleep));
        assert!(!alert_current(focus_alert, &off, &s, later));
        assert!(alert_current(sleep_alert, &off, &s, later));
        let mut off = s.clone();
        off.preferences.features.sleep = false;
        let kinds: Vec<_> = deadlines(&off, now).into_iter().map(|a| a.kind).collect();
        assert!(kinds.contains(&AlertKind::Focus) && !kinds.contains(&AlertKind::Sleep));
        assert!(!alert_current(sleep_alert, &off, &s, later));
        off.preferences.features.focus = false;
        assert!(deadlines(&off, now).is_empty());
    }
    #[test]
    fn tray_title_falls_back_to_auto_when_a_modules_display_is_off() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 11, 15, 12, 0, 0)
            .single()
            .unwrap();
        let mut s = snapshot(TrayDisplay::FocusMinutes);
        s.focus.days.insert(
            now.format("%Y-%m-%d").to_string(),
            FocusDay {
                count: 1,
                minutes: 25,
            },
        );
        assert_eq!(tray_title(&s, now), "25 min");
        s.preferences.features.focus = false;
        // Auto without Focus skips the timer and shows bedtime.
        assert!(tray_title(&s, now).ends_with("→ bed"));
        s.focus.state = Some(timer(now, "focus", 5));
        assert!(tray_title(&s, now).ends_with("→ bed"));
        s.preferences.features.sleep = false;
        assert_eq!(tray_title(&s, now), "Daybar");
        s.preferences.features.focus = true;
        assert_eq!(tray_title(&s, now), "25 min");
        for (mode, hide) in [
            (TrayDisplay::NextTask, "habits"),
            (TrayDisplay::Countdown, "countdown"),
            (TrayDisplay::Bedtime, "sleep"),
            (TrayDisplay::ActiveTimer, "focus"),
        ] {
            let mut s = snapshot(mode);
            s.focus.state = Some(timer(now, "focus", 5));
            let shown = tray_title(&s, now);
            match hide {
                "habits" => s.preferences.features.habits = false,
                "countdown" => s.preferences.features.countdown = false,
                "sleep" => s.preferences.features.sleep = false,
                _ => s.preferences.features.focus = false,
            }
            let hidden = tray_title(&s, now);
            s.preferences.tray_display = TrayDisplay::Auto;
            assert_ne!(shown, hidden, "{hide}");
            assert_eq!(hidden, tray_title(&s, now), "{hide} behaves as auto");
        }
    }
    #[test]
    fn focus_shortcut_only_opens_the_window_when_focus_is_off() {
        let mut s = snapshot(TrayDisplay::Auto);
        assert!(matches!(
            toggle_focus_operation(&s),
            Some(Operation::StartTimer { .. })
        ));
        s.focus.state = Some(timer(Local::now(), "focus", 25));
        assert!(matches!(
            toggle_focus_operation(&s),
            Some(Operation::StopTimer)
        ));
        s.preferences.features.focus = false;
        assert!(toggle_focus_operation(&s).is_none());
    }
    #[test]
    fn no_phone_confirmation_is_skipped_when_the_sleep_module_is_off() {
        use chrono::TimeZone;
        let now = Local
            .with_ymd_and_hms(2026, 11, 15, 23, 30, 0)
            .single()
            .unwrap();
        let mut s = snapshot(TrayDisplay::Auto);
        let focus_start = Operation::StartTimer {
            timer_type: "focus".into(),
            minutes: 25,
            task: None,
        };
        // Bed is 5 minutes away: with the Sleep module on this is no-phone time.
        s.sleep.plan = Some(SleepPlan {
            start: "2026-11-15".into(),
            wake: 8 * 60,
            bed: 23 * 60 + 35,
        });
        assert!(quiet_focus_start(&s, &focus_start, now));
        s.preferences.features.sleep = false;
        assert!(!quiet_focus_start(&s, &focus_start, now));
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
