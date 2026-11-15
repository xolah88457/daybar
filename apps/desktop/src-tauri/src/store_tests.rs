use super::*;
use tempfile::TempDir;
fn sandbox() -> (TempDir, Store, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
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
        done: true,
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
        assert!(store.mutate(task("2026-11-15", "Coursework")).is_err());
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
    store.mutate(task("2026-11-15", "Coursework")).unwrap();
    let backups = all_backups(&root);
    assert_eq!(backups.len(), 1);
    for (n, b) in originals {
        assert_eq!(fs::read(backups[0].join(n)).unwrap(), b);
    }
    store.mutate(task("2026-11-15", "Live Trading")).unwrap();
    assert_eq!(all_backups(&root).len(), 1);
}
#[test]
fn interleaved_external_edit_is_preserved_and_stale_commit_rejected() {
    let (_d, store, root) = sandbox();
    store.mutate(task("2026-11-15", "Coursework")).unwrap();
    write(
        &root,
        "daily-log-Daily_Tasks.json",
        r#"{"2026-11-15":["Coursework","Live Trading"],"2026-11-14":["Trade Review"]}"#,
    );
    let s = store
        .mutate(task("2026-11-15", "Apostles work"))
        .unwrap()
        .snapshot;
    assert_eq!(s.daily_log["2026-11-15"].len(), 3);
    assert_eq!(s.daily_log["2026-11-14"], vec!["Trade Review"]);
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
        .insert("Coursework".into(), 25);
    atomic(&root.join(SETTINGS), &encode(&settings).unwrap()).unwrap();
    let data = FocusData {
        state: Some(TimerState {
            r#type: "focus".into(),
            minutes: 25,
            start,
            end,
            task: Some("Coursework".into()),
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
    assert!(s.daily_log[&day].contains(&"Coursework".into()));
    assert_eq!(store.snapshot().unwrap().focus.days[&day].minutes, 50);
    // Simulate interruption after the focus ledger commit, before the daily-log write.
    write(&root, "daily-log-Daily_Tasks.json", "{}");
    assert!(store.snapshot().unwrap().daily_log[&day].contains(&"Coursework".into()));
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
                task: Some("Coursework".into()),
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
        r#"{"2026-11-01":["Coursework","old archived name"]}"#,
    );
    let s = store
        .mutate(Operation::RenameTask {
            from: "Coursework".into(),
            to: "Study".into(),
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
            task: "Study".into(),
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
        r#"{"2026-11-15":["Coursework"]}"#,
    );
    write(
        &root,
        "daily-log-Daily_Tasks 2.json",
        r#"{"2026-11-15":["Live Trading"]}"#,
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
                task: None,
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
        assert!(store.mutate(task("2026-11-15", "Coursework")).is_err());
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
        "Coursework",
        "Live Trading",
        "Trade Review",
        "Apostles work",
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
