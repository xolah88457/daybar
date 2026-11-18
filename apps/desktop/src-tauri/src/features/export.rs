//! Export history: writes a copy of the user's data to `~/Downloads/Daybar export YYYY-MM-DD/`.
//!
//! The export only ever reads. It takes its data from [`Store::inspect`], which loads the files
//! without the recovery step that `snapshot()` runs (that step may rewrite a data file), and it
//! writes exclusively into a freshly created folder of its own. Formatting lives in pure functions
//! (`csv_*`, `json_export`, `folder_name`) so it can be tested without a filesystem.

use crate::contracts::Snapshot;
use crate::runtime::Backend;
use chrono::{DateTime, Local, NaiveDate};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::State;

/// Highest ` (N)` suffix tried before giving up on finding a free folder name.
const MAX_FOLDER_SUFFIX: u32 = 999;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Csv,
    Json,
}

impl Format {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "csv" => Ok(Self::Csv),
            "json" => Ok(Self::Json),
            other => Err(format!("Unknown export format “{other}”. Choose csv or json.")),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Pure formatting
// ---------------------------------------------------------------------------------------------

/// One CSV field per RFC 4180: quoted when it holds a comma, quote, CR or LF, with `"` doubled.
/// A leading `=`, `+`, `-` or `@` is NOT altered: the file is a faithful record, not a spreadsheet.
pub fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// A CSV record terminated by CRLF, as RFC 4180 specifies.
pub fn csv_row<S: AsRef<str>>(fields: &[S]) -> String {
    let mut row = fields
        .iter()
        .map(|f| csv_field(f.as_ref()))
        .collect::<Vec<_>>()
        .join(",");
    row.push_str("\r\n");
    row
}

/// `HH:MM` for a minute of the day (values past 24 h wrap, so malformed data cannot panic).
pub fn clock(minutes: u32) -> String {
    let m = minutes % 1440;
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// UTC timestamp such as `2026-11-15T14:30:00Z`; empty when out of range.
pub fn iso_utc(epoch_ms: i64) -> String {
    DateTime::from_timestamp_millis(epoch_ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

/// `focus-sessions.csv`: one row per credited or planned session, oldest first.
pub fn csv_focus_sessions(s: &Snapshot) -> String {
    let mut out = csv_row(&[
        "date",
        "type",
        "planned_minutes",
        "credited_minutes",
        "start_utc",
        "end_utc",
        "task",
    ]);
    let mut rows: Vec<(i64, &crate::contracts::FocusSession)> = s
        .focus
        .sessions
        .iter()
        .flatten()
        .map(|(id, session)| (id.parse::<i64>().unwrap_or(0), session))
        .collect();
    rows.sort_by_key(|(start, _)| *start);
    for (start, session) in rows {
        out.push_str(&csv_row(&[
            session.date.clone(),
            session.r#type.clone(),
            session.minutes.to_string(),
            session.credited_minutes.to_string(),
            iso_utc(start),
            iso_utc(session.end),
            session.task.clone().unwrap_or_default(),
        ]));
    }
    out
}

/// `focus-days.csv`: blocks and minutes per day.
pub fn csv_focus_days(s: &Snapshot) -> String {
    let mut out = csv_row(&["date", "blocks", "minutes"]);
    for (date, day) in &s.focus.days {
        out.push_str(&csv_row(&[
            date.clone(),
            day.count.to_string(),
            day.minutes.to_string(),
        ]));
    }
    out
}

/// `habits.csv` (date, task, done).
///
/// Every active task gets a row for every day from the habit start date up to `today` (or the
/// habit end date, whichever comes first) so missed days are explicit. Dates logged outside that
/// range, and archived or renamed tasks, appear only where they were actually done.
pub fn csv_habits(s: &Snapshot, today: NaiveDate) -> String {
    let mut out = csv_row(&["date", "task", "done"]);
    let tasks = &s.settings.habits.tasks;
    let done_on = |date: &str, task: &str| {
        s.daily_log
            .get(date)
            .is_some_and(|done| done.iter().any(|t| t == task))
    };
    let start = NaiveDate::parse_from_str(&s.settings.habits.start_date, "%Y-%m-%d").ok();
    let end = NaiveDate::parse_from_str(&s.settings.habits.end_date, "%Y-%m-%d")
        .ok()
        .map_or(today, |e| e.min(today));
    let mut dates: BTreeSet<String> = s.daily_log.keys().cloned().collect();
    if let Some(start) = start {
        for day in start.iter_days().take_while(|d| *d <= end) {
            dates.insert(day.format("%Y-%m-%d").to_string());
        }
    }
    for date in &dates {
        let in_range = start.is_some_and(|st| {
            NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|d| d >= st && d <= end)
        });
        for task in tasks {
            if in_range || done_on(date, task) {
                out.push_str(&csv_row(&[
                    date.as_str(),
                    task.as_str(),
                    if done_on(date, task) { "true" } else { "false" },
                ]));
            }
        }
        // Tasks no longer active: only the days they were done.
        if let Some(done) = s.daily_log.get(date) {
            let mut seen = BTreeSet::new();
            for task in done {
                if !tasks.contains(task) && seen.insert(task.as_str()) {
                    out.push_str(&csv_row(&[date.as_str(), task.as_str(), "true"]));
                }
            }
        }
    }
    out
}

/// `sleep.csv` (date, wake, bed) with `HH:MM` clocks; a missing entry is left empty.
pub fn csv_sleep(s: &Snapshot) -> String {
    let mut out = csv_row(&["date", "wake", "bed"]);
    let dates: BTreeSet<&String> = s.sleep.wakes.keys().chain(s.sleep.beds.keys()).collect();
    for date in dates {
        out.push_str(&csv_row(&[
            date.clone(),
            s.sleep.wakes.get(date).map(|m| clock(*m)).unwrap_or_default(),
            s.sleep.beds.get(date).map(|m| clock(*m)).unwrap_or_default(),
        ]));
    }
    out
}

/// The four CSV files, `(file name, contents)`.
pub fn csv_files(s: &Snapshot, today: NaiveDate) -> Vec<(&'static str, String)> {
    vec![
        ("focus-sessions.csv", csv_focus_sessions(s)),
        ("focus-days.csv", csv_focus_days(s)),
        ("habits.csv", csv_habits(s, today)),
        ("sleep.csv", csv_sleep(s)),
    ]
}

/// `daybar-export.json`: settings, daily log, focus and sleep in one pretty-printed document.
pub fn json_export(s: &Snapshot, exported_at_ms: i64) -> Result<String, String> {
    let sorted: BTreeMap<_, _> = s.daily_log.iter().collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "app": "Daybar",
        "exportVersion": 1,
        "exportedAt": iso_utc(exported_at_ms),
        "settings": s.settings,
        "dailyLog": sorted,
        "focus": s.focus,
        "sleep": s.sleep,
    }))
    .map_err(|e| format!("Could not format the export: {e}"))?;
    text.push('\n');
    Ok(text)
}

/// The folder name for the nth attempt: `Daybar export 2026-11-16`, then ` (2)`, ` (3)`, ...
pub fn folder_name(date: NaiveDate, attempt: u32) -> String {
    let base = format!("Daybar export {}", date.format("%Y-%m-%d"));
    if attempt <= 1 {
        base
    } else {
        format!("{base} ({attempt})")
    }
}

/// `$HOME/Downloads` when it is a directory, otherwise `$HOME` itself.
pub fn downloads_dir(home: &Path) -> PathBuf {
    let downloads = home.join("Downloads");
    if downloads.is_dir() {
        downloads
    } else {
        home.to_path_buf()
    }
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/// Creates the first free `Daybar export <date>[ (n)]` folder inside `parent`. `create_dir` is
/// atomic, so two exports in the same instant can never share a folder.
fn create_unique_folder(parent: &Path, date: NaiveDate) -> Result<PathBuf, String> {
    for attempt in 1..=MAX_FOLDER_SUFFIX {
        let path = parent.join(folder_name(date, attempt));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Could not create {}: {e}", path.display())),
        }
    }
    Err("Too many earlier exports with today’s date. Move some out of Downloads and try again.".into())
}

/// Writes the export into a new folder under `downloads` and returns that folder.
pub fn export_to(
    snapshot: &Snapshot,
    format: Format,
    downloads: &Path,
    today: NaiveDate,
    now_ms: i64,
) -> Result<PathBuf, String> {
    let files = match format {
        Format::Csv => csv_files(snapshot, today),
        Format::Json => vec![("daybar-export.json", json_export(snapshot, now_ms)?)],
    };
    let folder = create_unique_folder(downloads, today)?;
    let mut written = Vec::new();
    for (name, contents) in &files {
        let path = folder.join(name);
        if let Err(e) = fs::write(&path, contents) {
            // Undo our own partial output; the folder was created by this call.
            written.push(path.clone());
            for file in &written {
                let _ = fs::remove_file(file);
            }
            let _ = fs::remove_dir(&folder);
            return Err(format!("Could not write {}: {e}", path.display()));
        }
        written.push(path);
    }
    Ok(folder)
}

/// Shows the folder in Finder. Best effort: a failure to reveal never fails the export.
#[cfg(target_os = "macos")]
fn reveal(path: &Path) {
    let _ = std::process::Command::new("open").arg("-R").arg(path).status();
}
#[cfg(not(target_os = "macos"))]
fn reveal(_path: &Path) {}

/// Tauri command: `export_history(format: "csv" | "json")` resolves with the new folder's path.
#[tauri::command]
pub async fn export_history(
    backend: State<'_, Backend>,
    format: String,
) -> Result<String, String> {
    let format = Format::parse(&format)?;
    let store = backend.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = store.inspect()?;
        run(&snapshot, format)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Refuses to export while a data file has a problem. `runtime:*` entries are the app's own
/// transient errors (a failed notification or shortcut), not problems with the data, so they are
/// ignored, like everywhere else issues are checked.
fn check_data(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot
        .issues
        .iter()
        .any(|i| !i.file.starts_with("runtime:"))
    {
        return Err(
            "Some data files have problems. Resolve them in Daybar before exporting.".into(),
        );
    }
    Ok(())
}

/// Everything after the read: gating, folder choice, writing and revealing.
fn run(snapshot: &Snapshot, format: Format) -> Result<String, String> {
    check_data(snapshot)?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|h| !h.as_os_str().is_empty())
        .ok_or("Could not find your home folder.")?;
    let now = Local::now();
    let folder = export_to(
        snapshot,
        format,
        &downloads_dir(&home),
        now.date_naive(),
        now.timestamp_millis(),
    )?;
    reveal(&folder);
    Ok(folder.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{FocusDay, FocusSession, SleepData};
    use crate::store::Store;
    use std::collections::BTreeMap;

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn snapshot() -> Snapshot {
        Snapshot {
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

    #[test]
    fn csv_fields_are_escaped_per_rfc_4180() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_field("two\nlines"), "\"two\nlines\"");
        assert_eq!(csv_field("cr\rhere"), "\"cr\rhere\"");
        assert_eq!(csv_field(""), "");
        assert_eq!(csv_field("=SUM(A1)"), "=SUM(A1)");
        assert_eq!(csv_row(&["a", "b,c", "d\"e"]), "a,\"b,c\",\"d\"\"e\"\r\n");
    }

    #[test]
    fn awkward_task_names_survive_in_habits_csv() {
        let mut s = snapshot();
        s.settings.habits.start_date = "2026-11-14".into();
        s.settings.habits.tasks = vec!["Read, then \"write\"".into(), "Line\nbreak".into()];
        s.daily_log.insert(
            "2026-11-15".into(),
            vec!["Read, then \"write\"".into(), "Old task, archived".into()],
        );
        let csv = csv_habits(&s, day(2026, 11, 15));
        assert_eq!(
            csv,
            "date,task,done\r\n\
             2026-11-14,\"Read, then \"\"write\"\"\",false\r\n\
             2026-11-14,\"Line\nbreak\",false\r\n\
             2026-11-15,\"Read, then \"\"write\"\"\",true\r\n\
             2026-11-15,\"Line\nbreak\",false\r\n\
             2026-11-15,\"Old task, archived\",true\r\n"
        );
    }

    #[test]
    fn habits_csv_stops_at_today_or_the_end_date_and_keeps_logged_days_outside_the_range() {
        let mut s = snapshot();
        s.settings.habits.start_date = "2026-11-10".into();
        s.settings.habits.end_date = "2026-11-11".into();
        s.settings.habits.tasks = vec!["A".into()];
        s.daily_log.insert("2026-11-01".into(), vec!["A".into()]);
        let csv = csv_habits(&s, day(2026, 11, 20));
        assert_eq!(
            csv,
            "date,task,done\r\n2026-11-01,A,true\r\n2026-11-10,A,false\r\n2026-11-11,A,false\r\n"
        );
        s.settings.habits.end_date = String::new();
        let csv = csv_habits(&s, day(2026, 11, 11));
        assert_eq!(csv.lines().count(), 4); // header, 11-01, 11-10, 11-11
    }

    #[test]
    fn sleep_csv_merges_wakes_and_beds_with_clock_times() {
        let mut s = snapshot();
        s.sleep = SleepData {
            wakes: BTreeMap::from([("2026-11-14".into(), 455), ("2026-11-15".into(), 0)]),
            beds: BTreeMap::from([("2026-11-13".into(), 1410), ("2026-11-14".into(), 30)]),
            plan: None,
        };
        assert_eq!(
            csv_sleep(&s),
            "date,wake,bed\r\n2026-11-13,,23:30\r\n2026-11-14,07:35,00:30\r\n2026-11-15,00:00,\r\n"
        );
        assert_eq!(clock(1440 + 61), "01:01");
    }

    #[test]
    fn focus_csvs_list_sessions_in_start_order_and_days_by_date() {
        let mut s = snapshot();
        let session = |task: Option<&str>, end: i64| FocusSession {
            r#type: "focus".into(),
            minutes: 25,
            credited_minutes: 25,
            end,
            date: "2026-11-15".into(),
            task: task.map(String::from),
        };
        s.focus.sessions = Some(BTreeMap::from([
            // Keys sort as text ("10" < "9"), so the export must order by the numeric start.
            ("1800000000000".into(), session(Some("Deep, work"), 1_800_001_500_000)),
            ("999999999999".into(), session(None, 1_000_000_500_000)),
        ]));
        s.focus.days = BTreeMap::from([
            ("2026-11-15".into(), FocusDay { count: 2, minutes: 50 }),
            ("2026-11-14".into(), FocusDay { count: 0, minutes: 10 }),
        ]);
        let csv = csv_focus_sessions(&s);
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(lines[0], "date,type,planned_minutes,credited_minutes,start_utc,end_utc,task");
        assert_eq!(lines[1], "2026-11-15,focus,25,25,2001-09-09T01:46:39Z,2001-09-09T01:55:00Z,");
        assert_eq!(
            lines[2],
            "2026-11-15,focus,25,25,2027-01-15T08:00:00Z,2027-01-15T08:25:00Z,\"Deep, work\""
        );
        assert_eq!(
            csv_focus_days(&s),
            "date,blocks,minutes\r\n2026-11-14,0,10\r\n2026-11-15,2,50\r\n"
        );
    }

    #[test]
    fn json_export_has_the_four_sections_and_a_trailing_newline() {
        let mut s = snapshot();
        s.daily_log.insert("2026-11-15".into(), vec!["Read, \"x\"".into()]);
        let text = json_export(&s, 1_800_000_000_000).unwrap();
        assert!(text.ends_with("}\n"));
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["app"], "Daybar");
        assert_eq!(v["exportedAt"], "2027-01-15T08:00:00Z");
        assert_eq!(v["dailyLog"]["2026-11-15"][0], "Read, \"x\"");
        assert!(v["settings"]["habits"]["tasks"].is_array());
        assert!(v["focus"]["days"].is_object());
        assert!(v["sleep"]["wakes"].is_object());
        assert!(v.get("preferences").is_none(), "preferences stay private");
    }

    #[test]
    fn folder_names_get_numeric_suffixes() {
        let d = day(2026, 11, 16);
        assert_eq!(folder_name(d, 1), "Daybar export 2026-11-16");
        assert_eq!(folder_name(d, 2), "Daybar export 2026-11-16 (2)");
        assert_eq!(folder_name(d, 10), "Daybar export 2026-11-16 (10)");
    }

    #[test]
    fn downloads_falls_back_to_home() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(downloads_dir(home.path()), home.path());
        fs::create_dir(home.path().join("Downloads")).unwrap();
        assert_eq!(downloads_dir(home.path()), home.path().join("Downloads"));
    }

    #[test]
    fn repeated_exports_never_overwrite_an_earlier_folder() {
        let dir = tempfile::tempdir().unwrap();
        let s = snapshot();
        let today = day(2026, 11, 16);
        let first = export_to(&s, Format::Csv, dir.path(), today, 0).unwrap();
        let second = export_to(&s, Format::Json, dir.path(), today, 0).unwrap();
        let third = export_to(&s, Format::Csv, dir.path(), today, 0).unwrap();
        assert_eq!(first, dir.path().join("Daybar export 2026-11-16"));
        assert_eq!(second, dir.path().join("Daybar export 2026-11-16 (2)"));
        assert_eq!(third, dir.path().join("Daybar export 2026-11-16 (3)"));
        let names = |p: &Path| {
            let mut n: Vec<String> = fs::read_dir(p)
                .unwrap()
                .map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect();
            n.sort();
            n
        };
        assert_eq!(
            names(&first),
            ["focus-days.csv", "focus-sessions.csv", "habits.csv", "sleep.csv"]
        );
        assert_eq!(names(&second), ["daybar-export.json"]);
    }

    #[test]
    fn a_missing_downloads_folder_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("nope");
        let err = export_to(&snapshot(), Format::Csv, &gone, day(2026, 11, 16), 0).unwrap_err();
        assert!(err.contains("Could not create"), "{err}");
    }

    #[test]
    fn unknown_formats_are_rejected() {
        assert_eq!(Format::parse("csv"), Ok(Format::Csv));
        assert_eq!(Format::parse("json"), Ok(Format::Json));
        assert!(Format::parse("xlsx").is_err());
        assert!(Format::parse("CSV").is_err());
    }

    fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        fn walk(dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, out);
                } else {
                    out.insert(path.clone(), fs::read(&path).unwrap());
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(root, &mut out);
        out
    }

    #[test]
    fn exporting_never_modifies_the_data_files() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().canonicalize().unwrap();
        let store = Store::open(root.clone(), None).unwrap();
        // A focus session that has expired but has not been settled: `snapshot()` may rewrite
        // focus.json to settle it; the export must not.
        fs::write(
            root.join("daily-log-Daily_Tasks.json"),
            r#"{"2026-11-15":["Read a chapter"]}"#,
        )
        .unwrap();
        fs::write(
            root.join("sleep-data.json"),
            r#"{"wakes":{"2026-11-15":480},"beds":{"2026-11-14":1380},"plan":null}"#,
        )
        .unwrap();
        fs::write(
            root.join("focus-timer.json"),
            r#"{"state":{"type":"focus","minutes":25,"start":1700000000000,"end":1700001500000},"days":{}}"#,
        )
        .unwrap();
        let before = tree(&root);
        assert!(before.len() >= 3);

        let snap = store.inspect().unwrap();
        assert!(snap.issues.is_empty(), "{:?}", snap.issues);
        let out = tempfile::tempdir().unwrap();
        let folder = export_to(&snap, Format::Json, out.path(), day(2026, 11, 16), 0).unwrap();
        export_to(&snap, Format::Csv, out.path(), day(2026, 11, 16), 0).unwrap();

        assert_eq!(tree(&root), before, "data files and their set are unchanged");
        let text = fs::read_to_string(folder.join("daybar-export.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["dailyLog"]["2026-11-15"][0], "Read a chapter");
        assert_eq!(v["sleep"]["wakes"]["2026-11-15"], 480);
    }

    #[test]
    fn export_is_refused_while_data_has_issues() {
        // Built in: a stored `false` from an older file does not block it.
        let mut s = snapshot();
        s.preferences.features.export_history.enabled = false;
        s.issues.push(crate::contracts::DataIssue {
            file: "focus.json".into(),
            message: "bad".into(),
        });
        assert!(run(&s, Format::Csv).unwrap_err().contains("problems"));
    }

    #[test]
    fn runtime_issues_do_not_block_the_export_but_data_issues_still_do() {
        let issue = |file: &str| crate::contracts::DataIssue {
            file: file.into(),
            message: "x".into(),
        };
        let mut s = snapshot();
        assert!(check_data(&s).is_ok());
        s.issues.push(issue("runtime:auto-cycle"));
        s.issues.push(issue("runtime:notifications"));
        assert!(check_data(&s).is_ok());
        s.issues.push(issue("focus.json"));
        assert!(check_data(&s).unwrap_err().contains("problems"));
    }

    #[test]
    fn a_runtime_issue_from_the_store_does_not_block_the_export() {
        let data = tempfile::tempdir().unwrap();
        let store = Store::open(data.path().canonicalize().unwrap(), None).unwrap();
        store.report("auto-cycle", Some("boom".into()));
        let snap = store.inspect().unwrap();
        assert!(snap.issues.iter().any(|i| i.file == "runtime:auto-cycle"));
        assert!(check_data(&snap).is_ok());
    }
}
