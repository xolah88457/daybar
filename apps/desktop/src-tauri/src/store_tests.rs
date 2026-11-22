use super::*;
use std::time::{Duration, Instant};
use tempfile::TempDir;
fn sandbox() -> (TempDir, Store, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    write_fixtures(&root);
    let store = Store::open(root.clone(), None).unwrap();
    (dir, store, root)
}
fn write(root: &Path, file: &str, raw: &str) {
    fs::write(root.join(file), raw).unwrap();
}
fn task(day: &str, task: &str) -> Operation {
    Operation::SetTask {
        date: day.into(),
        task: task.into(),
        done: true, space: None
    }
}
fn all_backups(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root.join(".daybar-backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect()
}
#[test]
fn malformed_unknown_and_invalid_dates_are_never_overwritten() {
    for (file, raw) in [
        (FOCUS, r#"{"state":null,"days":{},"unknown":true}"#),
        (FOCUS, r#"{"days":{}}"#),
        (FOCUS, r#"{"state":null,"days":{},"sessions":null}"#),
        (
            FOCUS,
            r#"{"state":null,"days":{"2026-11-15":{"count":1,"minutes":25}},"sessions":{}}"#,
        ),
        (
            FOCUS,
            r#"{"state":null,"days":{},"baseline":{"2026-11-15":{"count":1,"minutes":25}}}"#,
        ),
        (
            FOCUS,
            r#"{"state":{"type":"focus","minutes":1,"start":1800000000000,"end":1800000060000,"task":null},"days":{}}"#,
        ),
        (
            SLEEP,
            r#"{"wakes":{"2026-02-30":480},"beds":{},"plan":null}"#,
        ),
        ("daily-log-Daily_Tasks.json", r#"{"2026-11-15":[1]}"#),
        (SETTINGS, r#"{"schemaVersion":2}"#),
        (SETTINGS, r#"{"sleep":{"unexpected":true}}"#),
        ("daily-log-Other.json", "{not json"),
    ] {
        let (_d, store, root) = sandbox();
        write(&root, file, raw);
        let before = bytes(&root.join(file)).unwrap();
        assert!(!store.snapshot().unwrap().issues.is_empty(), "{file}");
        assert!(store.mutate(task("2026-11-15", "Read a chapter")).is_err());
        assert_eq!(bytes(&root.join(file)).unwrap(), before);
    }
}
#[test]
fn first_opted_in_write_backs_up_every_managed_file() {
    let (_d, store, _root) = sandbox();
    let real = tempfile::tempdir().unwrap();
    let root = real.path().canonicalize().unwrap();
    write(&root, FOCUS, r#"{"state":null,"days":{}}"#);
    write(&root, SLEEP, r#"{"wakes":{},"beds":{},"plan":null}"#);
    write(&root, SETTINGS, "{}");
    write(&root, "daily-log-Other.json", r#"{"2026-01-01":["old"]}"#);
    let originals: Vec<_> = [FOCUS, SLEEP, SETTINGS, "daily-log-Other.json"]
        .into_iter()
        .map(|n| (n, fs::read(root.join(n)).unwrap()))
        .collect();
    let mut prefs = store.preferences().unwrap();
    prefs.real_data = true;
    prefs.data_folder = root.to_string_lossy().into();
    store.set_preferences(prefs).unwrap();
    store.mutate(task("2026-11-15", "Read a chapter")).unwrap();
    let backups = all_backups(&root);
    assert_eq!(backups.len(), 1);
    for (n, b) in originals {
        assert_eq!(fs::read(backups[0].join(n)).unwrap(), b);
    }
    store.mutate(task("2026-11-15", "Sketch a scene")).unwrap();
    assert_eq!(all_backups(&root).len(), 1);
}
#[test]
fn interleaved_external_edit_is_preserved_and_stale_commit_rejected() {
    let (_d, store, root) = sandbox();
    store.mutate(task("2026-11-15", "Read a chapter")).unwrap();
    write(
        &root,
        "daily-log-Daily_Tasks.json",
        r#"{"2026-11-15":["Read a chapter","Sketch a scene"],"2026-11-14":["Take a walk"]}"#,
    );
    let s = store
        .mutate(task("2026-11-15", "Water the plants"))
        .unwrap()
        .snapshot;
    assert_eq!(s.daily_log["2026-11-15"].len(), 3);
    assert_eq!(s.daily_log["2026-11-14"], vec!["Take a walk"]);
    let mut state = store.lock().unwrap();
    let (_, previous) = store.load(&state).unwrap();
    write(
        &root,
        SLEEP,
        r#"{"wakes":{"2026-11-15":500},"beds":{},"plan":null}"#,
    );
    assert!(store
        .commit(
            &mut state,
            &previous,
            BTreeMap::from([(SLEEP.into(), encode(&SleepData::default()).unwrap())])
        )
        .is_err());
    assert!(String::from_utf8(fs::read(root.join(SLEEP)).unwrap())
        .unwrap()
        .contains("500"));
}
#[test]
fn startup_settles_legacy_once_and_recovers_habit_threshold() {
    let (_d, store, root) = sandbox();
    let now = Local::now().timestamp_millis();
    let start = now - 25 * 60_000 - 1;
    let end = start + 25 * 60_000;
    let day = focus::date_at(end).unwrap();
    let mut settings = Settings::default();
    settings
        .habits
        .focus_thresholds
        .insert("Read a chapter".into(), 25);
    atomic(&root.join(SETTINGS), &encode(&settings).unwrap()).unwrap();
    let data = FocusData {
        state: Some(TimerState {
            r#type: "focus".into(),
            minutes: 25,
            start,
            end,
            task: Some("Read a chapter".into()),
        }),
        days: BTreeMap::from([(
            day.clone(),
            FocusDay {
                count: 1,
                minutes: 25,
            },
        )]),
        ..Default::default()
    };
    atomic(&root.join(FOCUS), &encode(&data).unwrap()).unwrap();
    let s = store.snapshot().unwrap();
    assert!(s.focus.state.is_none());
    assert_eq!(s.focus.days[&day].minutes, 50);
    assert!(s.daily_log[&day].contains(&"Read a chapter".into()));
    assert_eq!(store.snapshot().unwrap().focus.days[&day].minutes, 50);
    // Simulate interruption after the focus ledger commit, before the daily-log write.
    write(&root, "daily-log-Daily_Tasks.json", "{}");
    assert!(store.snapshot().unwrap().daily_log[&day].contains(&"Read a chapter".into()));
    let mut d = s.focus;
    d.state = data.state;
    atomic(&root.join(FOCUS), &encode(&d).unwrap()).unwrap();
    assert_eq!(store.snapshot().unwrap().focus.days[&day].minutes, 50);
}
#[test]
fn rename_transfers_every_log_and_sessions_archive_keeps_history() {
    let (_d, store, root) = sandbox();
    let now = 1_800_000_000_000;
    store
        .mutate_at(
            Operation::StartTimer {
                timer_type: "focus".into(),
                minutes: 25,
                task: Some("Read a chapter".into()), space: None
            },
            now,
        )
        .unwrap();
    store
        .mutate_at(Operation::StopTimer, now + 120_000)
        .unwrap();
    write(
        &root,
        "daily-log-Other.json",
        r#"{"2026-11-01":["Read a chapter","old archived name"]}"#,
    );
    let s = store
        .mutate(Operation::RenameTask {
            from: "Read a chapter".into(),
            to: "Study".into(), space: None
        })
        .unwrap()
        .snapshot;
    assert_eq!(
        s.focus
            .sessions
            .unwrap()
            .values()
            .next()
            .unwrap()
            .task
            .as_deref(),
        Some("Study")
    );
    let log: DailyLog =
        serde_json::from_slice(&fs::read(root.join("daily-log-Other.json")).unwrap()).unwrap();
    assert_eq!(log["2026-11-01"], vec!["Study", "old archived name"]);
    store.mutate(task("2026-11-15", "Study")).unwrap();
    let s = store
        .mutate(Operation::ArchiveTask {
            task: "Study".into(), space: None
        })
        .unwrap()
        .snapshot;
    assert!(s.settings.habits.archived_tasks.contains(&"Study".into()));
    assert!(s.daily_log["2026-11-15"].contains(&"Study".into()));
}
#[test]
fn conflicts_union_logs_backup_discard_and_refuse_ambiguous_sleep() {
    let (_d, store, root) = sandbox();
    write(
        &root,
        "daily-log-Daily_Tasks.json",
        r#"{"2026-11-15":["Read a chapter"]}"#,
    );
    write(
        &root,
        "daily-log-Daily_Tasks 2.json",
        r#"{"2026-11-15":["Sketch a scene"]}"#,
    );
    assert_eq!(store.snapshot().unwrap().conflicts.len(), 1);
    let s = store
        .resolve_conflict("daily-log-Daily_Tasks 2.json".into(), "merge".into())
        .unwrap();
    assert_eq!(s.daily_log["2026-11-15"].len(), 2);
    assert!(!root.join("daily-log-Daily_Tasks 2.json").exists());
    write(
        &root,
        SLEEP,
        r#"{"wakes":{"2026-11-15":480},"beds":{},"plan":null}"#,
    );
    write(
        &root,
        "sleep-data 2.json",
        r#"{"wakes":{"2026-11-15":600},"beds":{},"plan":null}"#,
    );
    assert!(store
        .resolve_conflict("sleep-data 2.json".into(), "merge".into())
        .is_err());
    assert!(root.join("sleep-data 2.json").exists());
    store
        .resolve_conflict("sleep-data 2.json".into(), "discard".into())
        .unwrap();
    assert!(all_backups(&root)
        .iter()
        .any(|p| p.join("sleep-data 2.json").exists()));
}
#[test]
fn conflict_sessions_deduplicate_and_baselines_must_agree() {
    let (_d, store, root) = sandbox();
    let now = 1_800_000_000_000;
    store
        .mutate_at(
            Operation::StartTimer {
                timer_type: "focus".into(),
                minutes: 25,
                task: None, space: None
            },
            now,
        )
        .unwrap();
    store
        .mutate_at(Operation::StopTimer, now + 120_000)
        .unwrap();
    let raw = fs::read(root.join(FOCUS)).unwrap();
    fs::write(root.join("focus-timer 2.json"), &raw).unwrap();
    let before = store.snapshot().unwrap().focus;
    let merged = store
        .resolve_conflict("focus-timer 2.json".into(), "merge".into())
        .unwrap()
        .focus;
    assert!(same(&before, &merged));
    write(
        &root,
        "focus-timer 2.json",
        r#"{"state":null,"days":{"2026-11-15":{"count":1,"minutes":25}}}"#,
    );
    assert!(store
        .resolve_conflict("focus-timer 2.json".into(), "merge".into())
        .is_err());
}
#[test]
fn path_traversal_symlinks_and_unconsented_folder_are_rejected() {
    #[cfg_attr(not(unix), allow(unused_variables))]
    let (_d, store, root) = sandbox();
    for file in ["../focus-timer.json", "/tmp/focus-timer 2.json", ".", ".."] {
        assert!(store
            .resolve_conflict(file.into(), "discard".into())
            .is_err());
    }
    let other = tempfile::tempdir().unwrap();
    let mut prefs = store.preferences().unwrap();
    prefs.data_folder = other
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into();
    assert!(store.set_preferences(prefs).is_err());
    #[cfg(unix)]
    {
        fs::remove_file(root.join(SLEEP)).unwrap();
        std::os::unix::fs::symlink(other.path().join("victim"), root.join(SLEEP)).unwrap();
        assert!(!store.snapshot().unwrap().issues.is_empty());
        assert!(store.mutate(task("2026-11-15", "Read a chapter")).is_err());
        assert!(!other.path().join("victim").exists());
    }
}
#[test]
#[cfg(debug_assertions)]
fn debug_restart_revokes_persisted_real_folder_without_probing_it() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().canonicalize().unwrap();
    let root = base.join("sandbox");
    let prefs = base.join("preferences.json");
    let p = Preferences {
        data_folder: "/this/path/does/not/exist/and/must/not/be/probed".into(),
        real_data: true,
        launch_at_login: false,
        hide_dock: false,
        global_shortcut: String::new(),
        theme_mode: ThemeMode::Night,
        tray_display: TrayDisplay::Auto,
        features: Features::default(),
        features_version: FEATURES_VERSION,
        setup_done: true,
    };
    atomic(&prefs, &encode(&p).unwrap()).unwrap();
    let store = Store::open(root.clone(), Some(prefs)).unwrap();
    assert_eq!(store.root().unwrap(), root);
    assert!(!store.preferences().unwrap().real_data);
}
#[test]
fn placeholder_download_is_bounded_and_never_replaced_with_empty_data() {
    let (_d, store, root) = sandbox();
    fs::remove_file(root.join(SLEEP)).unwrap();
    write(&root, ".sleep-data.json.icloud", "placeholder");
    let start = Instant::now();
    assert!(!store.snapshot().unwrap().issues.is_empty());
    assert!(start.elapsed() < Duration::from_secs(8));
    assert!(!root.join(SLEEP).exists());
    assert!(root.join(".sleep-data.json.icloud").exists());
}
#[test]
fn existing_placeholder_is_not_shadowed_by_sandbox_seeding() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    write(&root, ".sleep-data.json.icloud", "placeholder");
    let store = Store::open(root.clone(), None).unwrap();
    assert!(!root.join(SLEEP).exists());
    assert!(store
        .snapshot()
        .unwrap()
        .issues
        .iter()
        .any(|i| i.file == SLEEP));
}
#[test]
fn evicted_conflict_is_visible_and_discarded_only_with_backup() {
    let (_d, store, root) = sandbox();
    write(&root, ".focus-timer 2.json.icloud", "placeholder");
    let s = store.snapshot().unwrap();
    assert!(s.conflicts.iter().any(|c| c.file == "focus-timer 2.json"));
    store
        .resolve_conflict("focus-timer 2.json".into(), "discard".into())
        .unwrap();
    assert!(!root.join(".focus-timer 2.json.icloud").exists());
    assert!(all_backups(&root)
        .iter()
        .any(|p| p.join(".focus-timer 2.json.icloud").exists()));
}
#[test]
fn real_folder_discard_also_backs_up_all_managed_files_first() {
    let (_d, store, _root) = sandbox();
    let real = tempfile::tempdir().unwrap();
    let root = real.path().canonicalize().unwrap();
    write(&root, FOCUS, r#"{"state":null,"days":{}}"#);
    write(&root, "focus-timer 2.json", "broken conflict");
    write(&root, SLEEP, r#"{"wakes":{},"beds":{},"plan":null}"#);
    let mut p = store.preferences().unwrap();
    p.real_data = true;
    p.data_folder = root.to_string_lossy().into();
    store.set_preferences(p).unwrap();
    store
        .resolve_conflict("focus-timer 2.json".into(), "discard".into())
        .unwrap();
    assert!(all_backups(&root).iter().any(|b| b.join(FOCUS).exists()
        && b.join(SLEEP).exists()
        && b.join("focus-timer 2.json").exists()));
}
#[test]
fn session_date_and_unknown_nested_fields_are_rejected() {
    let (_d, store, root) = sandbox();
    write(
        &root,
        FOCUS,
        r#"{"state":null,"days":{},"sessions":{"1800000000000":{"type":"focus","minutes":25,"creditedMinutes":2,"end":1800000120000,"date":"2020-01-01"}}}"#,
    );
    assert!(!store.snapshot().unwrap().issues.is_empty());
    write(
        &root,
        FOCUS,
        r#"{"state":null,"days":{"2026-11-15":{"count":0,"minutes":0,"extra":1}}}"#,
    );
    assert!(!store.snapshot().unwrap().issues.is_empty());
}
#[test]
fn mutex_serializes_simultaneous_mac_mutations() {
    let (_d, store, _) = sandbox();
    let store = std::sync::Arc::new(store);
    let handles: Vec<_> = [
        "Read a chapter",
        "Sketch a scene",
        "Take a walk",
        "Water the plants",
    ]
    .into_iter()
    .map(|task| {
        let s = store.clone();
        std::thread::spawn(move || s.mutate(task_op(task)).unwrap())
    })
    .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(store.snapshot().unwrap().daily_log["2026-11-15"].len(), 4);
    fn task_op(t: &str) -> Operation {
        task("2026-11-15", t)
    }
}
#[test]
fn feature_toggles_persist_and_legacy_preferences_files_still_load() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().canonicalize().unwrap();
    let root = base.join("sandbox");
    let file = base.join("preferences.json");
    let folder = root.to_string_lossy();
    // A preferences.json written before the `features` key existed.
    let legacy = format!(
        r#"{{"dataFolder":{folder:?},"realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","themeMode":"day"}}"#
    );
    fs::create_dir_all(&root).unwrap();
    fs::write(&file, legacy).unwrap();
    let store = Store::open(root.clone(), Some(file.clone())).unwrap();
    let mut prefs = store.preferences().unwrap();
    assert_eq!(prefs.features, Features::default());
    prefs.features.focus = false;
    prefs.features.radar.enabled = true;
    prefs.features.radar.days_ahead = 30;
    let snapshot = store.set_preferences(prefs.clone()).unwrap();
    assert!(!snapshot.preferences.features.focus);
    let reopened = Store::open(root, Some(file)).unwrap();
    assert_eq!(reopened.preferences().unwrap().features, prefs.features);
    prefs.features.radar.days_ahead = 0;
    assert!(store.check_preferences(&prefs).is_err());
    assert!(store.set_preferences(prefs).is_err());
    assert_eq!(store.preferences().unwrap().features.radar.days_ahead, 30);
}
#[test]
fn a_0_3_0_preferences_file_picks_up_the_new_defaults_once() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().canonicalize().unwrap();
    let root = base.join("sandbox");
    let file = base.join("preferences.json");
    let folder = root.to_string_lossy();
    // 0.3.0 wrote every new feature as off and had no featuresVersion.
    let old = format!(
        r#"{{"dataFolder":{folder:?},"realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","features":{{"sleep":false,"radar":{{"enabled":false}},"checkIns":{{"enabled":false}},"insights":{{"enabled":false}},"hourlyChime":{{"enabled":false}}}}}}"#
    );
    fs::create_dir_all(&root).unwrap();
    fs::write(&file, old).unwrap();
    let store = Store::open(root.clone(), Some(file.clone())).unwrap();
    let mut prefs = store.preferences().unwrap();
    assert_eq!(prefs.features_version, FEATURES_VERSION);
    assert!(prefs.features.radar.enabled && prefs.features.check_ins.enabled && prefs.features.insights.enabled);
    assert!(!prefs.features.sleep && !prefs.features.hourly_chime.enabled);
    // Switched off after the upgrade: stays off across a restart.
    prefs.features.radar.enabled = false;
    store.set_preferences(prefs).unwrap();
    let reopened = Store::open(root, Some(file)).unwrap();
    assert!(!reopened.preferences().unwrap().features.radar.enabled);
}
#[test]
fn a_new_sandbox_starts_blank() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let store = Store::open(root.clone(), None).unwrap();
    let s = store.snapshot().unwrap();
    assert!(s.issues.is_empty(), "{:?}", s.issues);
    assert_eq!(s.settings.habits.tasks, vec!["First habit"]);
    assert_eq!(s.settings.countdown.title, "Countdown");
    let today = Local::now().format("%Y-%m-%d").to_string();
    assert_eq!(s.settings.countdown.start_date, today);
    assert_eq!(s.settings.habits.start_date, today);
    assert!(s.daily_log.is_empty());
    assert!(s.focus.days.is_empty());
    assert!(s.sleep.wakes.is_empty() && s.sleep.beds.is_empty());
    assert!(root.join(STARTER_MARKER).is_file());
    assert!(!fs::read_dir(&root)
        .unwrap()
        .any(|e| e.unwrap().file_name().to_string_lossy().starts_with("sample-data-")));
}
#[test]
fn old_sample_data_is_moved_aside_once_and_never_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    write_fixtures(&root);
    fs::remove_file(root.join(STARTER_MARKER)).unwrap();
    write(&root, "daily-log-Daily_Tasks 2.json", "{}");
    let sample = bytes(&root.join(SETTINGS)).unwrap().unwrap();
    let store = Store::open(root.clone(), None).unwrap();
    let s = store.snapshot().unwrap();
    assert_eq!(s.settings.habits.tasks, vec!["First habit"]);
    assert!(s.daily_log.is_empty() && s.conflicts.is_empty());
    let folders: Vec<PathBuf> = fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("sample-data-"))
        .collect();
    assert_eq!(folders.len(), 1);
    let kept = &folders[0];
    assert_eq!(fs::read(kept.join(SETTINGS)).unwrap(), sample);
    for name in [FOCUS, SLEEP, "daily-log-Daily_Tasks.json", "daily-log-Daily_Tasks 2.json"] {
        assert!(kept.join(name).is_file(), "{name}");
    }
    // The user's own edits after the move survive every later launch.
    store.mutate(task(&Local::now().format("%Y-%m-%d").to_string(), "First habit")).unwrap();
    drop(store);
    let again = Store::open(root.clone(), None).unwrap();
    assert_eq!(again.snapshot().unwrap().daily_log.len(), 1);
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("sample-data-"))
            .count(),
        1
    );
}

fn work_space(store: &Store) -> SpacesFile {
    let mut spaces = store.snapshot().unwrap().spaces;
    spaces.main.subtasks.insert("Read a chapter".into(), vec!["Pick book".into(), "Read".into()]);
    spaces.spaces.push(Space {
        id: "work".into(),
        name: "Work".into(),
        color: "#ff9f43".into(),
        habits: SpaceHabits {
            title: "Work tasks".into(),
            log_id: "Space_work".into(),
            start_date: "2026-11-01".into(),
            end_date: String::new(),
            tasks: vec!["Inbox zero".into(), "Ship it".into()],
            archived_tasks: vec![],
            day_complete_min: 1,
        },
        subtasks: BTreeMap::from([("Ship it".into(), vec!["Write".into(), "Review".into()])]),
        countdowns: vec![],
    });
    spaces
}
fn sub(day: &str, task: &str, subtask: &str, done: bool, space: Option<&str>) -> Operation {
    Operation::SetSubtask {
        date: day.into(),
        task: task.into(),
        subtask: subtask.into(),
        done,
        space: space.map(Into::into),
    }
}
#[test]
fn spaces_keep_their_own_log_and_subtasks_tick_the_parent() {
    let (_d, store, root) = sandbox();
    let spaces = work_space(&store);
    store.mutate(Operation::SaveSpaces { spaces }).unwrap();
    assert!(root.join(SPACES).exists());
    // Saving a space creates no history file until something is ticked.
    assert!(!root.join("daily-log-Space_work.json").exists());
    let day = "2026-11-15";
    store.mutate(sub(day, "Ship it", "Write", true, Some("work"))).unwrap();
    let s = store.snapshot().unwrap();
    assert_eq!(s.space_logs["work"][day], vec!["Ship it › Write"]);
    assert!(!s.space_logs["work"][day].contains(&"Ship it".to_string()));
    store.mutate(sub(day, "Ship it", "Review", true, Some("work"))).unwrap();
    let s = store.snapshot().unwrap();
    assert!(s.space_logs["work"][day].contains(&"Ship it".to_string()), "all subtasks done ticks the parent");
    let main_before = s.daily_log.get(day).cloned();
    store.mutate(sub(day, "Ship it", "Write", false, Some("work"))).unwrap();
    let s = store.snapshot().unwrap();
    assert!(!s.space_logs["work"][day].contains(&"Ship it".to_string()), "unticking one unticks the parent");
    assert_eq!(s.daily_log.get(day).cloned(), main_before, "the main log is untouched");
    let raw: DailyLog = serde_json::from_slice(&fs::read(root.join("daily-log-Space_work.json")).unwrap()).unwrap();
    assert_eq!(raw[day], vec!["Ship it › Review"]);
    // Ticking a parent ticks every subtask; unticking clears them.
    store
        .mutate(Operation::SetTask { date: day.into(), task: "Read a chapter".into(), done: true, space: None })
        .unwrap();
    let s = store.snapshot().unwrap();
    for e in ["Read a chapter", "Read a chapter › Pick book", "Read a chapter › Read"] {
        assert!(s.daily_log[day].contains(&e.to_string()), "{e}");
    }
    store
        .mutate(Operation::SetTask { date: day.into(), task: "Read a chapter".into(), done: false, space: Some("main".into()) })
        .unwrap();
    assert!(!store.snapshot().unwrap().daily_log[day].iter().any(|e| e.starts_with("Read a chapter")));
    // A task from another space, an unknown space or subtask is refused.
    assert!(store.mutate(Operation::SetTask { date: day.into(), task: "Inbox zero".into(), done: true, space: None }).is_err());
    assert!(store.mutate(Operation::SetTask { date: day.into(), task: "Inbox zero".into(), done: true, space: Some("nope".into()) }).is_err());
    assert!(store.mutate(sub(day, "Ship it", "Nope", true, Some("work"))).is_err());
}
#[test]
fn space_rename_archive_and_history_rules() {
    let (_d, store, root) = sandbox();
    store.mutate(Operation::SaveSpaces { spaces: work_space(&store) }).unwrap();
    let day = "2026-11-15";
    store.mutate(sub(day, "Ship it", "Write", true, Some("work"))).unwrap();
    store
        .mutate(Operation::RenameTask { from: "Ship it".into(), to: "Launch".into(), space: Some("work".into()) })
        .unwrap();
    let s = store.snapshot().unwrap();
    assert_eq!(s.space_logs["work"][day], vec!["Launch › Write"]);
    assert!(s.spaces.spaces[0].subtasks.contains_key("Launch"));
    // A main rename leaves space logs alone, even if a name matches.
    let main_log = fs::read(root.join("daily-log-Space_work.json")).unwrap();
    store
        .mutate(Operation::RenameTask { from: "Read a chapter".into(), to: "Study".into(), space: None })
        .unwrap();
    assert_eq!(fs::read(root.join("daily-log-Space_work.json")).unwrap(), main_log);
    assert!(store.snapshot().unwrap().spaces.main.subtasks.contains_key("Study"));
    store.mutate(Operation::ArchiveTask { task: "Inbox zero".into(), space: Some("work".into()) }).unwrap();
    let s = store.snapshot().unwrap();
    assert_eq!(s.spaces.spaces[0].habits.archived_tasks, vec!["Inbox zero"]);
    // Dropping a task without archiving, changing a log ID or reusing the main log is refused.
    let mut bad = s.spaces.clone();
    bad.spaces[0].habits.tasks = vec!["Other".into()];
    assert!(store.mutate(Operation::SaveSpaces { spaces: bad }).is_err());
    let mut bad = s.spaces.clone();
    bad.spaces[0].habits.log_id = "Elsewhere".into();
    assert!(store.mutate(Operation::SaveSpaces { spaces: bad }).is_err());
    let mut bad = s.spaces.clone();
    bad.spaces[0].id = "other".into();
    bad.spaces[0].habits.log_id = "Daily_Tasks".into();
    assert!(store.mutate(Operation::SaveSpaces { spaces: bad }).is_err());
    // Deleting a space keeps its history file.
    let mut gone = s.spaces.clone();
    gone.spaces.clear();
    store.mutate(Operation::SaveSpaces { spaces: gone }).unwrap();
    assert!(root.join("daily-log-Space_work.json").exists());
    assert!(store.snapshot().unwrap().space_logs.is_empty());
}
#[test]
fn a_space_timer_is_linked_beside_the_ledger_not_inside_it() {
    let (_d, store, root) = sandbox();
    store.mutate(Operation::SaveSpaces { spaces: work_space(&store) }).unwrap();
    let now = 1_800_000_000_000;
    let start = |task: Option<&str>, space: Option<&str>| Operation::StartTimer {
        timer_type: "focus".into(),
        minutes: 25,
        task: task.map(Into::into),
        space: space.map(Into::into),
    };
    assert!(store.mutate_at(start(Some("Read a chapter"), Some("work")), now).is_err(), "main task in a space");
    store.mutate_at(start(Some("Ship it"), Some("work")), now).unwrap();
    let s = store.snapshot().unwrap();
    assert!(s.focus.state.as_ref().unwrap().task.is_none(), "space tasks stay out of focus-timer.json");
    let link = &s.spaces.focus[&now.to_string()];
    assert_eq!((link.space.as_str(), link.task.as_deref()), ("work", Some("Ship it")));
    let raw = fs::read_to_string(root.join(FOCUS)).unwrap();
    assert!(!raw.contains("work") && !raw.contains("Ship it"));
    // Editing spaces never drops a focus link.
    let mut edit = s.spaces.clone();
    edit.focus.clear();
    edit.main.name = "Home".into();
    store.mutate_at(Operation::SaveSpaces { spaces: edit }, now + 1000).unwrap();
    assert!(store.snapshot().unwrap().spaces.focus.contains_key(&now.to_string()));
}
#[test]
fn reset_starter_moves_everything_aside_and_refuses_a_real_folder() {
    let (_d, store, root) = sandbox();
    store.mutate(Operation::SaveSpaces { spaces: work_space(&store) }).unwrap();
    store.mutate(sub("2026-11-15", "Ship it", "Write", true, Some("work"))).unwrap();
    let r = store.mutate(Operation::ResetStarter).unwrap();
    assert_eq!(r.snapshot.settings.habits.tasks, vec!["First habit"]);
    assert!(r.snapshot.spaces.spaces.is_empty() && r.snapshot.daily_log.is_empty());
    let moved: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("sample-data-"))
        .collect();
    assert_eq!(moved.len(), 1);
    for f in [SETTINGS, SPACES, "daily-log-Space_work.json", "daily-log-Daily_Tasks.json"] {
        assert!(moved[0].path().join(f).exists(), "{f} kept");
    }
}
#[test]
fn spaces_conflict_copies_merge_only_when_identical() {
    let (_d, store, root) = sandbox();
    store.mutate(Operation::SaveSpaces { spaces: work_space(&store) }).unwrap();
    fs::copy(root.join(SPACES), root.join("daybar-spaces 2.json")).unwrap();
    let s = store.snapshot().unwrap();
    assert_eq!(s.conflicts[0].canonical, SPACES);
    store.resolve_conflict("daybar-spaces 2.json".into(), "merge".into()).unwrap();
    let mut other = work_space(&store);
    other.main.name = "Different".into();
    fs::write(root.join("daybar-spaces 2.json"), serde_json::to_vec(&other).unwrap()).unwrap();
    assert!(store.resolve_conflict("daybar-spaces 2.json".into(), "merge".into()).is_err());
}
#[test]
fn a_brand_new_install_asks_for_setup_and_an_existing_one_does_not() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let prefs = root.join("prefs").join("preferences.json");
    let sandbox = root.join("data");
    fs::create_dir_all(&sandbox).unwrap();
    let store = Store::open(sandbox.clone(), Some(prefs.clone())).unwrap();
    assert!(!store.preferences().unwrap().setup_done);
    drop(store);
    // Quitting before finishing shows it again next time.
    let store = Store::open(sandbox.clone(), Some(prefs.clone())).unwrap();
    assert!(!store.preferences().unwrap().setup_done);
    let mut done = store.preferences().unwrap();
    done.setup_done = true;
    store.set_preferences(done).unwrap();
    drop(store);
    assert!(Store::open(sandbox.clone(), Some(prefs)).unwrap().preferences().unwrap().setup_done);
    // An existing install without a preferences file (never changed a setting) is not asked.
    let other = root.join("prefs2").join("preferences.json");
    assert!(Store::open(sandbox, Some(other)).unwrap().preferences().unwrap().setup_done);
}
