use crate::{
    contracts::*,
    focus, sleep,
    validation::{date, ensure, name, Result, Validate},
};
use chrono::Local;
use serde::{de::DeserializeOwned, Serialize};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

const SETTINGS: &str = "daybar-settings.json";
const FOCUS: &str = "focus-timer.json";
const SLEEP: &str = "sleep-data.json";
const SPACES: &str = "daybar-spaces.json";
const LIMIT: u64 = 8 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn same<T: Serialize>(a: &T, b: &T) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}
fn basename(name: &str) -> Result<()> {
    ensure(
        !name.is_empty()
            && Path::new(name).components().count() == 1
            && matches!(
                Path::new(name).components().next(),
                Some(Component::Normal(_))
            ),
        "Unsafe file name",
    )
}
pub fn no_symlinks(path: &Path) -> Result<()> {
    ensure(path.is_absolute(), "Folder must be absolute")?;
    let mut part = PathBuf::new();
    for c in path.components() {
        ensure(
            !matches!(c, Component::ParentDir | Component::CurDir),
            "Unsafe path component",
        )?;
        part.push(c);
        // A Windows drive prefix (`C:`, `\\?\C:`) on its own is not something to stat.
        if matches!(c, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&part) {
            Ok(m) => ensure(!m.file_type().is_symlink(), "Symlinks are not allowed")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(io(e)),
        }
    }
    Ok(())
}
/// Renames `temp` over `path`. Windows refuses while another program (an antivirus scan, Google
/// Drive uploading the old copy) briefly has the target open, so it retries for about a second.
fn replace(temp: &Path, path: &Path) -> Result<()> {
    let mut tries = 0;
    loop {
        match fs::rename(temp, path) {
            Ok(()) => return Ok(()),
            Err(e)
                if cfg!(windows)
                    && tries < 10
                    && e.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(io(e)),
        }
    }
}
/// Flushes a directory's entries (renames, new files) to disk. Windows cannot open a directory as a
/// file and journals NTFS metadata itself, so there it is a no-op.
#[cfg(unix)]
fn sync_dir(dir: &Path) -> Result<()> {
    fs::File::open(dir).and_then(|d| d.sync_all()).map_err(io)
}
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> Result<()> {
    Ok(())
}
fn bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    no_symlinks(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let file = match options.open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(e)),
    };
    let meta = file.metadata().map_err(io)?;
    ensure(
        meta.is_file() && meta.len() <= LIMIT,
        "Not a regular file or file exceeds 8 MiB",
    )?;
    let mut out = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut out).map_err(io)?;
    ensure(out.len() as u64 <= LIMIT, "File exceeds 8 MiB")?;
    Ok(Some(out))
}
fn atomic(path: &Path, content: &[u8]) -> Result<()> {
    no_symlinks(path)?;
    let parent = path.parent().ok_or("Missing parent")?;
    let temp = parent.join(format!(
        ".daybar-write-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.custom_flags(libc::O_NOFOLLOW).mode(0o600);
        let mut f = options.open(&temp).map_err(io)?;
        f.write_all(content).map_err(io)?;
        f.sync_all().map_err(io)?;
        no_symlinks(path)?;
        replace(&temp, path)?;
        sync_dir(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec_pretty(value).map_err(io)
}
fn decode<T: DeserializeOwned + Validate>(content: &[u8]) -> Result<T> {
    let mut d: T = serde_json::from_slice(content).map_err(io)?;
    d.validate()?;
    Ok(d)
}
fn decode_current<T: DeserializeOwned + Validate>(
    files: &BTreeMap<String, Vec<u8>>,
    name: &str,
) -> Result<Option<T>> {
    files.get(name).map(|b| decode(b)).transpose()
}
/// Present in a sandbox that holds the blank starter, not the pre-0.3.3 fictional sample data.
pub(crate) const STARTER_MARKER: &str = ".daybar-starter";

/// The sandbox's first files: one placeholder habit and a year-long countdown from today, no history.
fn starter_files(today: chrono::NaiveDate) -> Result<Vec<(String, Vec<u8>)>> {
    let mut settings = Settings::default();
    let day = |d: chrono::NaiveDate| d.format("%Y-%m-%d").to_string();
    settings.countdown.title = "Countdown".into();
    settings.countdown.start_date = day(today);
    settings.countdown.end_date = day(today + chrono::Duration::days(365));
    settings.habits.start_date = day(today);
    settings.habits.tasks = vec!["First habit".into()];
    let log = format!("daily-log-{}.json", settings.habits.log_id);
    Ok(vec![
        (SETTINGS.into(), encode(&settings)?),
        (FOCUS.into(), br#"{"state":null,"days":{},"sessions":{}}"#.to_vec()),
        (SLEEP.into(), br#"{"wakes":{},"beds":{},"plan":null}"#.to_vec()),
        (log, b"{}".to_vec()),
    ])
}

/// Tests that exercise the store against the fictional fixtures write them before opening it.
#[cfg(test)]
pub(crate) fn write_fixtures(root: &Path) {
    for (name, content) in [
        (SETTINGS, include_str!("../../../../packages/core/tests/fixtures/daybar-settings.json")),
        (FOCUS, include_str!("../../../../packages/core/tests/fixtures/focus-timer.json")),
        (SLEEP, include_str!("../../../../packages/core/tests/fixtures/sleep-data.json")),
        (
            "daily-log-Daily_Tasks.json",
            include_str!("../../../../packages/core/tests/fixtures/daily-log-Daily_Tasks.json"),
        ),
        (STARTER_MARKER, "fixtures\n"),
    ] {
        fs::write(root.join(name), content).unwrap();
    }
}

/// Moves every managed file in the sandbox into `sample-data-<stamp>/`. Run once, before the starter.
fn retire_sample_data(sandbox: &Path, stamp: &str) -> Result<()> {
    let mut found = Vec::new();
    for entry in fs::read_dir(sandbox).map_err(io)? {
        let entry = entry.map_err(io)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (managed(&name) || canonical(&name).is_some()) && entry.file_type().map_err(io)?.is_file() {
            found.push(name);
        }
    }
    if found.is_empty() {
        return Ok(());
    }
    let folder = sandbox.join(format!("sample-data-{stamp}"));
    no_symlinks(&folder)?;
    fs::create_dir_all(&folder).map_err(io)?;
    for name in found {
        fs::rename(sandbox.join(&name), folder.join(&name)).map_err(io)?;
    }
    sync_dir(sandbox)
}

fn managed(name: &str) -> bool {
    matches!(name, SETTINGS | FOCUS | SLEEP | SPACES)
        || name.starts_with("daily-log-") && name.ends_with(".json")
}
fn logical_name(name: &str) -> &str {
    name.strip_prefix('.')
        .and_then(|s| s.strip_suffix(".icloud"))
        .unwrap_or(name)
}
fn canonical(name: &str) -> Option<String> {
    for base in [SETTINGS, FOCUS, SLEEP, SPACES] {
        let stem = base.trim_end_matches(".json");
        if name.ends_with(".json")
            && (name.starts_with(&format!("{stem} ")) || name.starts_with(&format!("{stem}(")))
        {
            return Some(base.into());
        }
    }
    if name.starts_with("daily-log-") && name.ends_with(".json") {
        let stem = name.trim_end_matches(".json");
        if let Some(i) = stem.find([' ', '(']) {
            return Some(format!("{}.json", &stem[..i]));
        }
    }
    None
}
fn validate_file(file: &str, content: &[u8]) -> Result<()> {
    if file == SETTINGS {
        decode::<Settings>(content)?;
    } else if file == FOCUS {
        let raw: serde_json::Value = serde_json::from_slice(content).map_err(io)?;
        ensure(raw.get("state").is_some(), "Missing required state")?;
        for field in ["sessions", "baseline"] {
            ensure(
                raw.get(field).is_none_or(|v| !v.is_null()),
                "Optional focus fields cannot be null",
            )?;
        }
        if let Some(state) = raw.get("state").filter(|v| !v.is_null()) {
            ensure(
                state.get("task").is_none_or(|v| !v.is_null()),
                "Optional task cannot be null",
            )?;
        }
        if let Some(sessions) = raw.get("sessions").and_then(|v| v.as_object()) {
            for session in sessions.values() {
                ensure(
                    session.get("task").is_none_or(|v| !v.is_null()),
                    "Optional task cannot be null",
                )?;
            }
        }
        decode::<FocusData>(content)?;
    } else if file == SLEEP {
        let raw: serde_json::Value = serde_json::from_slice(content).map_err(io)?;
        ensure(raw.get("plan").is_some(), "Missing required plan")?;
        decode::<SleepData>(content)?;
    } else if file == SPACES {
        decode::<SpacesFile>(content)?;
    } else if file.starts_with("daily-log-") {
        decode::<DailyLogFile>(content)?;
    } else {
        return Err("Unknown managed file".into());
    }
    Ok(())
}
fn normalize_log(raw: DailyLogFile, tasks: &[String]) -> DailyLog {
    match raw {
        DailyLogFile::Current(map) => map,
        DailyLogFile::Legacy(days) => days.into_iter().map(|d| (d, tasks.to_vec())).collect(),
    }
}
fn union_log(a: &mut DailyLog, b: DailyLog) {
    for (day, tasks) in b {
        let dest = a.entry(day).or_default();
        for t in tasks {
            if !dest.contains(&t) {
                dest.push(t);
            }
        }
    }
}

/// A focus.json change that was just committed (by a mutation or by the settle-on-read recovery).
/// Reported once per commit, so a ledger entry is seen exactly once even if settlement is retried.
pub struct FocusChange<'a> {
    pub before: &'a FocusData,
    pub after: &'a FocusData,
    pub preferences: &'a Preferences,
}
/// Runs while the store mutex is held: it must only enqueue work and never call back into the Store.
pub type FocusObserver = Box<dyn Fn(&FocusChange) + Send + Sync>;

pub struct Store {
    inner: Mutex<Inner>,
    sandbox: PathBuf,
    preference_file: Option<PathBuf>,
    focus_observer: OnceLock<FocusObserver>,
}
struct Inner {
    prefs: Preferences,
    backed_up: BTreeSet<PathBuf>,
    errors: BTreeMap<String, String>,
}
impl Store {
    pub fn open(sandbox: PathBuf, preference_file: Option<PathBuf>) -> Result<Self> {
        no_symlinks(&sandbox)?;
        fs::create_dir_all(&sandbox).map_err(io)?;
        let mut prefs = Preferences {
            data_folder: sandbox.to_string_lossy().into(),
            real_data: false,
            launch_at_login: false,
            hide_dock: false,
            global_shortcut: "CommandOrControl+Shift+F".into(),
            theme_mode: ThemeMode::Night,
            tray_display: TrayDisplay::Auto,
            features: Features::default(),
            features_version: FEATURES_VERSION,
            // A brand-new install (no preferences and a sandbox never seeded) gets the guided setup.
            setup_done: preference_file.is_none()
                || bytes(&sandbox.join(STARTER_MARKER))?.is_some(),
        };
        if let Some(path) = &preference_file {
            if let Some(raw) = bytes(path)? {
                prefs = decode(&raw)?;
                // In memory only: the next save writes the upgraded switches and version.
                prefs.upgrade_features();
            } else if !prefs.setup_done {
                // Remember that setup is still owed, so quitting before finishing shows it again.
                if let Some(parent) = path.parent() {
                    no_symlinks(parent)?;
                    fs::create_dir_all(parent).map_err(io)?;
                }
                atomic(path, &encode(&prefs)?)?;
            }
        }
        // A debug restart always revokes folder consent BEFORE any selected-folder metadata/read.
        let persisted_real = prefs.real_data || prefs.data_folder != sandbox.to_string_lossy();
        if cfg!(debug_assertions) || !prefs.real_data {
            prefs.data_folder = sandbox.to_string_lossy().into();
            prefs.real_data = false;
        }
        if cfg!(debug_assertions) && persisted_real {
            if let Some(path) = &preference_file {
                atomic(path, &encode(&prefs)?)?;
            }
        }
        let root = Path::new(&prefs.data_folder);
        no_symlinks(root)?;
        ensure(root.is_dir(), "Data folder does not exist")?;
        let store = Self {
            inner: Mutex::new(Inner {
                prefs,
                backed_up: BTreeSet::new(),
                errors: BTreeMap::new(),
            }),
            sandbox,
            preference_file,
            focus_observer: OnceLock::new(),
        };
        store.seed()?;
        Ok(store)
    }
    /// Registers the single observer told about every committed focus change (features::shortcuts).
    pub fn observe_focus(&self, observer: FocusObserver) {
        let _ = self.focus_observer.set(observer);
    }
    fn notify_focus(&self, state: &Inner, before: &FocusData, after: &FocusData) {
        if let Some(observer) = self.focus_observer.get().filter(|_| !same(before, after)) {
            observer(&FocusChange {
                before,
                after,
                preferences: &state.prefs,
            });
        }
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| "DataStore mutex poisoned".into())
    }
    /// Fills the private sandbox with a blank starting point; a connected real folder is never touched.
    /// Builds before 0.3.3 seeded fictional sample data instead. The first launch of a newer build
    /// moves those files into a `sample-data-*` folder beside them (nothing is deleted), once.
    fn seed(&self) -> Result<()> {
        let state = self.lock()?;
        if state.prefs.real_data {
            return Ok(());
        }
        let marker = self.sandbox.join(STARTER_MARKER);
        let fresh = bytes(&marker)?.is_none();
        if fresh {
            retire_sample_data(&self.sandbox, &Local::now().format("%Y%m%d-%H%M%S").to_string())?;
        }
        for (name, content) in starter_files(Local::now().date_naive())? {
            let path = self.sandbox.join(&name);
            if bytes(&path)?.is_none()
                && bytes(&self.sandbox.join(format!(".{name}.icloud")))?.is_none()
            {
                validate_file(&name, &content)?;
                atomic(&path, &content)?;
            }
        }
        if fresh {
            atomic(&marker, b"blank start\n")?;
        }
        Ok(())
    }
    /// "Remove sample data": moves everything in the private folder into `sample-data-<stamp>/`
    /// (nothing is deleted) and writes the blank starter again. A connected real folder is refused.
    fn reset_starter(&self) -> Result<MutationResult> {
        {
            let state = self.lock()?;
            ensure(
                !state.prefs.real_data,
                "Daybar only clears its private folder. Edit a connected folder's tasks instead",
            )?;
            retire_sample_data(&self.sandbox, &Local::now().format("%Y%m%d-%H%M%S").to_string())?;
            for (name, content) in starter_files(Local::now().date_naive())? {
                validate_file(&name, &content)?;
                atomic(&self.sandbox.join(&name), &content)?;
            }
            atomic(&self.sandbox.join(STARTER_MARKER), b"blank start\n")?;
        }
        Ok(MutationResult {
            snapshot: self.snapshot()?,
            credited_minutes: None,
            message: Some("Cleared. The old files are kept in a sample-data folder.".into()),
        })
    }
    pub fn root(&self) -> Result<PathBuf> {
        Ok(PathBuf::from(&self.lock()?.prefs.data_folder))
    }
    pub fn preferences(&self) -> Result<Preferences> {
        Ok(self.lock()?.prefs.clone())
    }
    pub fn report(&self, source: &str, error: Option<String>) {
        if let Ok(mut s) = self.lock() {
            if let Some(e) = error {
                s.errors.insert(format!("runtime:{source}"), e);
            } else {
                s.errors.remove(&format!("runtime:{source}"));
            }
        }
    }
    pub fn check_preferences(&self, prefs: &Preferences) -> Result<()> {
        prefs.clone().validate()?;
        let root = PathBuf::from(&prefs.data_folder);
        // Consent is checked before even symlink_metadata: rejected paths must never be probed.
        ensure(
            prefs.real_data || root == self.sandbox,
            "Non-sandbox folders require explicit real-data consent",
        )?;
        no_symlinks(&root)?;
        ensure(
            root.is_dir(),
            "Select an existing data folder; Daybar will not create it",
        )
    }
    pub fn set_preferences(&self, prefs: Preferences) -> Result<Snapshot> {
        let mut state = self.lock()?;
        self.check_preferences(&prefs)?;
        if let Some(path) = &self.preference_file {
            if let Some(raw) = bytes(path)? {
                decode::<Preferences>(&raw)?;
            }
        }
        let old = std::mem::replace(&mut state.prefs, prefs.clone());
        let result = (|| {
            let snapshot = self.snapshot_locked(&mut state)?;
            if let Some(path) = &self.preference_file {
                if let Some(parent) = path.parent() {
                    no_symlinks(parent)?;
                    fs::create_dir_all(parent).map_err(io)?;
                }
                atomic(path, &encode(&prefs)?)?;
            }
            Ok(snapshot)
        })();
        if result.is_err() {
            state.prefs = old;
        }
        result
    }
    fn materialize(&self, root: &Path, file: &str) -> Result<Option<Vec<u8>>> {
        basename(file)?;
        if let Some(raw) = bytes(&root.join(file))? {
            return Ok(Some(raw));
        }
        let placeholder = root.join(format!(".{file}.icloud"));
        if bytes(&placeholder)?.is_none() {
            return Ok(None);
        }
        #[cfg(target_os = "macos")]
        {
            let mut child = std::process::Command::new("/usr/bin/brctl")
                .arg("download")
                .arg(&placeholder)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(io)?;
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if let Some(raw) = bytes(&root.join(file))? {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(Some(raw));
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                if let Some(status) = child.try_wait().map_err(io)? {
                    if !status.success() {
                        return Err(
                            "iCloud download failed; choose Keep Downloaded for this folder".into(),
                        );
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        Err("iCloud placeholder is not downloaded; choose Keep Downloaded and retry".into())
    }
    fn load(&self, state: &Inner) -> Result<(Snapshot, BTreeMap<String, Vec<u8>>)> {
        let root = Path::new(&state.prefs.data_folder);
        no_symlinks(root)?;
        let mut snap = Snapshot {
            settings: Settings::default(),
            daily_log: DailyLog::new(),
            focus: FocusData::default(),
            sleep: SleepData::default(),
            spaces: SpacesFile::default(),
            space_logs: BTreeMap::new(),
            preferences: state.prefs.clone(),
            issues: vec![],
            conflicts: vec![],
        };
        let mut files = BTreeMap::new();
        let mut candidates = BTreeSet::from([SETTINGS.into(), FOCUS.into(), SLEEP.into()]);
        for entry in fs::read_dir(root).map_err(io)? {
            let entry = entry.map_err(io)?;
            let disk_name = entry.file_name().to_string_lossy().into_owned();
            let name = logical_name(&disk_name).to_owned();
            if let Some(base) = canonical(&name) {
                if !snap.conflicts.iter().any(|c| c.file == name) {
                    snap.conflicts.push(Conflict {
                        file: name.clone(),
                        canonical: base.clone(),
                    });
                    match self
                        .materialize(root, &name)
                        .and_then(|b| b.ok_or("Conflict disappeared".into()))
                        .and_then(|b| validate_file(&base, &b))
                    {
                        Ok(()) => (),
                        Err(e) => snap.issues.push(DataIssue {
                            file: name,
                            message: e,
                        }),
                    }
                }
            } else if managed(&name) {
                candidates.insert(name);
            }
        }
        // Settings must be read first so legacy logs use the configured task list.
        let mut ordered = vec![SETTINGS.to_string()];
        ordered.extend(candidates.into_iter().filter(|f| f != SETTINGS));
        for file in ordered {
            match self.materialize(root, &file).and_then(|b| {
                if let Some(raw) = b {
                    validate_file(&file, &raw)?;
                    files.insert(file.clone(), raw);
                }
                Ok(())
            }) {
                Ok(()) => (),
                Err(e) => snap.issues.push(DataIssue {
                    file: file.clone(),
                    message: e,
                }),
            }
        }
        if let Some(raw) = files.get(SETTINGS) {
            snap.settings = decode(raw)?;
        }
        if let Some(raw) = files.get(FOCUS) {
            snap.focus = decode(raw)?;
        }
        if let Some(raw) = files.get(SLEEP) {
            snap.sleep = decode(raw)?;
        }
        if let Some(raw) = files.get(&format!("daily-log-{}.json", snap.settings.habits.log_id)) {
            snap.daily_log = normalize_log(decode(raw)?, &snap.settings.habits.tasks);
        }
        if let Some(raw) = files.get(SPACES) {
            snap.spaces = decode(raw)?;
        }
        for space in &snap.spaces.spaces {
            let log = match files.get(&log_name(&space.habits.log_id)) {
                Some(raw) => normalize_log(decode(raw)?, &space.habits.tasks),
                None => DailyLog::new(),
            };
            snap.space_logs.insert(space.id.clone(), log);
        }
        snap.issues
            .extend(state.errors.iter().map(|(file, message)| DataIssue {
                file: file.clone(),
                message: message.clone(),
            }));
        Ok((snap, files))
    }
    fn backup(
        &self,
        state: &mut Inner,
        names: impl IntoIterator<Item = String>,
    ) -> Result<PathBuf> {
        let root = PathBuf::from(&state.prefs.data_folder);
        no_symlinks(&root)?;
        let base = root.join(".daybar-backups");
        no_symlinks(&base)?;
        fs::create_dir_all(&base).map_err(io)?;
        let dest = base.join(format!(
            "{}-{}-{}",
            Local::now().format("%Y%m%dT%H%M%S%.3f"),
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dest).map_err(io)?;
        for name in names {
            basename(&name)?;
            if let Some(content) = bytes(&root.join(&name))? {
                atomic(&dest.join(name), &content)?;
            }
        }
        sync_dir(&base)?;
        sync_dir(&root)?;
        Ok(dest)
    }
    fn first_backup(&self, state: &mut Inner) -> Result<()> {
        let root = PathBuf::from(&state.prefs.data_folder);
        if state.prefs.real_data && !state.backed_up.contains(&root) {
            let names = fs::read_dir(&root)
                .map_err(io)?
                .map(|e| {
                    e.map(|e| e.file_name().to_string_lossy().into_owned())
                        .map_err(io)
                })
                .collect::<Result<Vec<_>>>()?;
            self.backup(
                state,
                names
                    .into_iter()
                    .filter(|n| managed(logical_name(n)) || canonical(logical_name(n)).is_some()),
            )?;
            state.backed_up.insert(root);
        }
        Ok(())
    }
    fn commit(
        &self,
        state: &mut Inner,
        previous: &BTreeMap<String, Vec<u8>>,
        updates: BTreeMap<String, Vec<u8>>,
    ) -> Result<()> {
        let root = PathBuf::from(&state.prefs.data_folder);
        let updates: Vec<_> = updates
            .into_iter()
            .filter(|(f, b)| previous.get(f) != Some(b))
            .collect();
        if updates.is_empty() {
            return Ok(());
        }
        for (file, content) in &updates {
            basename(file)?;
            validate_file(file, content)?;
            ensure(
                bytes(&root.join(file))?.as_ref() == previous.get(file),
                "File changed during mutation; retry to include the phone edit",
            )?;
        }
        self.first_backup(state)?;
        // Cross-file edits are backed up even in the sandbox. Atomicity is per file, not a distributed transaction.
        if updates.len() > 1 {
            self.backup(state, updates.iter().map(|(f, _)| f.clone()))?;
        }
        for (file, content) in updates {
            ensure(
                bytes(&root.join(&file))?.as_ref() == previous.get(&file),
                "File changed during mutation; retry",
            )?;
            atomic(&root.join(file), &content)?;
        }
        Ok(())
    }
    fn recover(
        &self,
        state: &mut Inner,
        snap: &mut Snapshot,
        files: &BTreeMap<String, Vec<u8>>,
        now: i64,
    ) -> Result<()> {
        if snap.issues.iter().any(|i| !i.file.starts_with("runtime:")) {
            return Ok(());
        }
        let before = snap.focus.clone();
        if snap.focus.sessions.is_some() {
            focus::normalize(&mut snap.focus, snap.settings.focus.block_minutes)?;
        }
        focus::settle(&mut snap.focus, now, snap.settings.focus.block_minutes)?;
        let mut updates = BTreeMap::new();
        if !same(&before, &snap.focus) {
            updates.insert(FOCUS.into(), encode(&snap.focus)?);
        }
        let old_log = snap.daily_log.clone();
        union_log(
            &mut snap.daily_log,
            focus::linked(&snap.focus, &snap.settings),
        );
        if old_log != snap.daily_log {
            updates.insert(
                format!("daily-log-{}.json", snap.settings.habits.log_id),
                encode(&snap.daily_log)?,
            );
        }
        self.commit(state, files, updates)?;
        self.notify_focus(state, &before, &snap.focus);
        Ok(())
    }
    pub fn inspect(&self) -> Result<Snapshot> {
        let state = self.lock()?;
        self.load(&state).map(|(snapshot, _)| snapshot)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut state = self.lock()?;
        self.snapshot_locked(&mut state)
    }
    fn snapshot_locked(&self, state: &mut Inner) -> Result<Snapshot> {
        let (mut snap, files) = self.load(state)?;
        if let Err(e) = self.recover(state, &mut snap, &files, Local::now().timestamp_millis()) {
            snap.issues.push(DataIssue {
                file: "recovery".into(),
                message: e,
            });
        }
        Ok(snap)
    }
    pub fn mutate(&self, op: Operation) -> Result<MutationResult> {
        self.mutate_at(op, Local::now().timestamp_millis())
    }
    pub(crate) fn mutate_at(&self, op: Operation, now: i64) -> Result<MutationResult> {
        if matches!(op, Operation::ResetStarter) {
            return self.reset_starter();
        }
        let mut state = self.lock()?;
        let (mut snap, files) = self.load(&state)?;
        ensure(
            snap.issues.iter().all(|i| i.file.starts_with("runtime:")),
            "Fix data errors before writing; original files have been preserved",
        )?;
        let old_settings = snap.settings.clone();
        let old_focus = snap.focus.clone();
        let old_sleep = snap.sleep.clone();
        let old_log = snap.daily_log.clone();
        let old_spaces = snap.spaces.clone();
        let old_space_logs = snap.space_logs.clone();
        let mut updates = BTreeMap::new();
        let mut credit = None;
        let mut message = None;
        let settled = focus::settle(&mut snap.focus, now, snap.settings.focus.block_minutes)?;
        match op {
            Operation::SetTask {
                date: day,
                mut task,
                done,
                space,
            } => {
                date(&day)?;
                name(&mut task)?;
                let (tasks, subs, log) = target(&mut snap, &space)?;
                ensure(tasks.contains(&task), "Unknown active task")?;
                let subs = subs.get(&task).cloned().unwrap_or_default();
                toggle_task(log, &day, &task, done, &subs);
            }
            Operation::SetSubtask {
                date: day,
                mut task,
                mut subtask,
                done,
                space,
            } => {
                date(&day)?;
                name(&mut task)?;
                name(&mut subtask)?;
                let (tasks, subs, log) = target(&mut snap, &space)?;
                ensure(tasks.contains(&task), "Unknown active task")?;
                let subs = subs.get(&task).cloned().unwrap_or_default();
                ensure(subs.contains(&subtask), "Unknown subtask")?;
                toggle_subtask(log, &day, &task, &subtask, done, &subs);
            }
            Operation::RenameTask {
                mut from,
                mut to,
                space: Some(id),
            } if id != MAIN_SPACE => {
                name(&mut from)?;
                name(&mut to)?;
                let space = snap
                    .spaces
                    .spaces
                    .iter_mut()
                    .find(|s| s.id == id)
                    .ok_or("Unknown space")?;
                let h = &mut space.habits;
                ensure(h.tasks.contains(&from), "Unknown active task")?;
                ensure(
                    from == to || !h.tasks.contains(&to) && !h.archived_tasks.contains(&to),
                    "Task name already exists",
                )?;
                for t in &mut h.tasks {
                    if *t == from {
                        *t = to.clone();
                    }
                }
                if let Some(subs) = space.subtasks.remove(&from) {
                    space.subtasks.insert(to.clone(), subs);
                }
                if let Some(log) = snap.space_logs.get_mut(&id) {
                    rename_log(log, &from, &to);
                }
                for link in snap.spaces.focus.values_mut() {
                    if link.space == id && link.task.as_ref() == Some(&from) {
                        link.task = Some(to.clone());
                    }
                }
            }
            Operation::ArchiveTask {
                mut task,
                space: Some(id),
            } if id != MAIN_SPACE => {
                name(&mut task)?;
                let space = snap
                    .spaces
                    .spaces
                    .iter_mut()
                    .find(|s| s.id == id)
                    .ok_or("Unknown space")?;
                let h = &mut space.habits;
                ensure(h.tasks.contains(&task), "Unknown active task")?;
                ensure(h.tasks.len() > 1, "Keep at least one active task")?;
                h.tasks.retain(|t| t != &task);
                if !h.archived_tasks.contains(&task) {
                    h.archived_tasks.push(task);
                }
                h.day_complete_min = h.day_complete_min.min(h.tasks.len() as u32);
            }
            Operation::RenameTask {
                mut from, mut to, ..
            } => {
                name(&mut from)?;
                name(&mut to)?;
                ensure(
                    snap.settings.habits.tasks.contains(&from),
                    "Unknown active task",
                )?;
                ensure(
                    from == to
                        || !snap.settings.habits.tasks.contains(&to)
                            && !snap.settings.habits.archived_tasks.contains(&to),
                    "Task name already exists",
                )?;
                for t in &mut snap.settings.habits.tasks {
                    if *t == from {
                        *t = to.clone();
                    }
                }
                if let Some(n) = snap.settings.habits.focus_thresholds.remove(&from) {
                    snap.settings.habits.focus_thresholds.insert(to.clone(), n);
                }
                // Every log that shares the main task list (phone widget logs too); spaces keep their own.
                let space_files: BTreeSet<String> = snap
                    .spaces
                    .spaces
                    .iter()
                    .map(|s| log_name(&s.habits.log_id))
                    .collect();
                if let Some(subs) = snap.spaces.main.subtasks.remove(&from) {
                    snap.spaces.main.subtasks.insert(to.clone(), subs);
                }
                for (file, raw) in &files {
                    if file.starts_with("daily-log-") && !space_files.contains(file) {
                        let mut log = normalize_log(decode(raw)?, &old_settings.habits.tasks);
                        rename_log(&mut log, &from, &to);
                        updates.insert(file.clone(), encode(&log)?);
                    }
                }
                rename_log(&mut snap.daily_log, &from, &to);
                if let Some(s) = &mut snap.focus.state {
                    if s.task.as_ref() == Some(&from) {
                        s.task = Some(to.clone());
                    }
                }
                for s in snap.focus.sessions.iter_mut().flat_map(|m| m.values_mut()) {
                    if s.task.as_ref() == Some(&from) {
                        s.task = Some(to.clone());
                    }
                }
            }
            Operation::ArchiveTask { mut task, .. } => {
                name(&mut task)?;
                ensure(
                    snap.settings.habits.tasks.contains(&task),
                    "Unknown active task",
                )?;
                ensure(
                    snap.settings.habits.tasks.len() > 1,
                    "Keep at least one active task",
                )?;
                snap.settings.habits.tasks.retain(|t| t != &task);
                if !snap.settings.habits.archived_tasks.contains(&task) {
                    snap.settings.habits.archived_tasks.push(task.clone());
                }
                snap.settings.habits.focus_thresholds.remove(&task);
                snap.settings.habits.day_complete_min = snap
                    .settings
                    .habits
                    .day_complete_min
                    .min(snap.settings.habits.tasks.len() as u32);
            }
            Operation::StartTimer {
                timer_type,
                minutes,
                mut task,
                space,
            } => {
                let space = space.filter(|id| id != MAIN_SPACE);
                if let Some(t) = &mut task {
                    name(t)?;
                }
                let link = match &space {
                    Some(id) => {
                        let s = snap
                            .spaces
                            .spaces
                            .iter()
                            .find(|s| &s.id == id)
                            .ok_or("Unknown space")?;
                        if let Some(t) = &task {
                            ensure(s.habits.tasks.contains(t), "Unknown timer task")?;
                        }
                        // The space's task is kept beside the ledger, never in focus-timer.json.
                        Some(SpaceFocus {
                            space: id.clone(),
                            task: task.take(),
                        })
                    }
                    None => {
                        if let Some(t) = &task {
                            ensure(snap.settings.habits.tasks.contains(t), "Unknown timer task")?;
                        }
                        None
                    }
                };
                focus::start(
                    &mut snap.focus,
                    timer_type,
                    minutes,
                    task,
                    now,
                    snap.settings.focus.block_minutes,
                )?;
                if let (Some(link), Some(state)) = (link, &snap.focus.state) {
                    snap.spaces.focus.insert(state.start.to_string(), link);
                }
            }
            Operation::StopTimer => {
                let n =
                    settled + focus::stop(&mut snap.focus, now, snap.settings.focus.block_minutes)?;
                credit = Some(n);
                message = Some(if n == 0 {
                    "Less than a minute or no uncredited focus; nothing counted.".into()
                } else {
                    format!("Counted {n} min of focus.")
                });
            }
            Operation::SettleTimer => (),
            Operation::LogSleep { entry, timestamp } => {
                sleep::log(&mut snap.sleep, &entry, timestamp)?
            }
            Operation::StartPlan => {
                let (wake, bed) = sleep::baseline(&snap.sleep, &snap.settings.sleep)
                    .ok_or("Log a wake time before starting a plan")?;
                snap.sleep.plan = Some(SleepPlan {
                    start: focus::date_at(now)?,
                    wake,
                    bed,
                });
            }
            Operation::StopPlan => snap.sleep.plan = None,
            Operation::ClearSleep => snap.sleep = SleepData::default(),
            Operation::SaveSettings { mut settings } => {
                settings.validate()?;
                ensure(
                    settings.habits.log_id == snap.settings.habits.log_id,
                    "Log ID cannot be changed; preserve the existing history file",
                )?;
                for task in &snap.settings.habits.tasks {
                    ensure(
                        settings.habits.tasks.contains(task)
                            || settings.habits.archived_tasks.contains(task),
                        "Use archive or rename to preserve task history",
                    )?;
                }
                snap.settings = settings;
                focus::normalize(&mut snap.focus, snap.settings.focus.block_minutes)?;
            }
            Operation::SaveSpaces { mut spaces } => {
                spaces.validate()?;
                // Focus links are written only by starting a timer.
                spaces.focus = std::mem::take(&mut snap.spaces.focus);
                for space in &spaces.spaces {
                    ensure(
                        space.habits.log_id != snap.settings.habits.log_id,
                        "A space cannot use the main task log",
                    )?;
                    if let Some(old) = snap.spaces.spaces.iter().find(|s| s.id == space.id) {
                        ensure(
                            old.habits.log_id == space.habits.log_id,
                            "Log ID cannot be changed; preserve the existing history file",
                        )?;
                        for task in &old.habits.tasks {
                            ensure(
                                space.habits.tasks.contains(task)
                                    || space.habits.archived_tasks.contains(task),
                                "Use archive or rename to preserve task history",
                            )?;
                        }
                    }
                }
                snap.space_logs.retain(|id, _| spaces.spaces.iter().any(|s| &s.id == id));
                for space in &spaces.spaces {
                    if !snap.space_logs.contains_key(&space.id) {
                        let log = match files.get(&log_name(&space.habits.log_id)) {
                            Some(raw) => normalize_log(decode(raw)?, &space.habits.tasks),
                            None => DailyLog::new(),
                        };
                        snap.space_logs.insert(space.id.clone(), log);
                    }
                }
                snap.spaces = spaces;
            }
            Operation::ResetStarter => unreachable!("handled before loading"),
        }
        snap.settings.validate()?;
        snap.focus.validate()?;
        snap.sleep.validate()?;
        snap.spaces.validate()?;
        union_log(
            &mut snap.daily_log,
            focus::linked(&snap.focus, &snap.settings),
        );
        if !same(&old_settings, &snap.settings) {
            updates.insert(SETTINGS.into(), encode(&snap.settings)?);
        }
        if !same(&old_focus, &snap.focus) {
            updates.insert(FOCUS.into(), encode(&snap.focus)?);
        }
        if !same(&old_sleep, &snap.sleep) {
            updates.insert(SLEEP.into(), encode(&snap.sleep)?);
        }
        let log_file = format!("daily-log-{}.json", snap.settings.habits.log_id);
        if old_log != snap.daily_log || updates.contains_key(&log_file) {
            updates.insert(log_file, encode(&snap.daily_log)?);
        }
        if !same(&old_spaces, &snap.spaces) {
            updates.insert(SPACES.into(), encode(&snap.spaces)?);
        }
        for space in &snap.spaces.spaces {
            let log = snap.space_logs.get(&space.id);
            if log != old_space_logs.get(&space.id) && log.is_some_and(|l| !l.is_empty() || files.contains_key(&log_name(&space.habits.log_id))) {
                updates.insert(log_name(&space.habits.log_id), encode(log.unwrap())?);
            }
        }
        self.commit(&mut state, &files, updates)?;
        self.notify_focus(&state, &old_focus, &snap.focus);
        Ok(MutationResult {
            snapshot: snap,
            credited_minutes: credit,
            message,
        })
    }
    pub fn resolve_conflict(&self, file: String, action: String) -> Result<Snapshot> {
        basename(&file)?;
        ensure(
            action == "merge" || action == "discard",
            "Unknown conflict action",
        )?;
        let mut state = self.lock()?;
        let (snap, files) = self.load(&state)?;
        let conflict = snap
            .conflicts
            .iter()
            .find(|c| c.file == file)
            .ok_or("Unknown conflict copy")?;
        let root = PathBuf::from(&state.prefs.data_folder);
        let actual = if bytes(&root.join(&file))?.is_some() {
            file.clone()
        } else {
            format!(".{file}.icloud")
        };
        let original = bytes(&root.join(&actual))?.ok_or("Conflict disappeared")?;
        self.first_backup(&mut state)?;
        self.backup(&mut state, [actual.clone(), conflict.canonical.clone()])?;
        if action == "merge" {
            ensure(actual == file, "Download the conflict copy before merging")?;
            ensure(
                snap.issues.iter().all(|i| i.file.starts_with("runtime:")),
                "Fix malformed files before merging",
            )?;
            let base = &conflict.canonical;
            validate_file(base, &original)?;
            let merged = if base == FOCUS {
                let mut a: FocusData = decode_current(&files, base)?.unwrap_or_default();
                let mut b: FocusData = decode(&original)?;
                focus::normalize(&mut a, snap.settings.focus.block_minutes)?;
                focus::normalize(&mut b, snap.settings.focus.block_minutes)?;
                ensure(
                    same(&a.baseline, &b.baseline),
                    "Different legacy baselines; automatic focus merge would lose or double credit",
                )?;
                if a.state.is_none() {
                    a.state = b.state;
                } else if b.state.is_some() {
                    ensure(
                        same(&a.state, &b.state),
                        "Both copies have different running timers",
                    )?;
                }
                let dest = a.sessions.as_mut().unwrap();
                for (id, s) in b.sessions.unwrap() {
                    if let Some(existing) = dest.get(&id) {
                        ensure(
                            same(existing, &s),
                            "Same session key has different content; manual review needed",
                        )?;
                    } else {
                        dest.insert(id, s);
                    }
                }
                focus::normalize(&mut a, snap.settings.focus.block_minutes)?;
                encode(&a)?
            } else if base.starts_with("daily-log-") {
                let mut a = decode_current(&files, base)?
                    .map(|d| normalize_log(d, &snap.settings.habits.tasks))
                    .unwrap_or_default();
                union_log(
                    &mut a,
                    normalize_log(decode(&original)?, &snap.settings.habits.tasks),
                );
                encode(&a)?
            } else if base == SLEEP {
                let mut a: SleepData = decode_current(&files, base)?.unwrap_or_default();
                let b: SleepData = decode(&original)?;
                merge_map(&mut a.wakes, b.wakes)?;
                merge_map(&mut a.beds, b.beds)?;
                if a.plan.is_none() {
                    a.plan = b.plan;
                } else if b.plan.is_some() {
                    ensure(
                        same(&a.plan, &b.plan),
                        "Different sleep plans; manual review needed",
                    )?;
                }
                encode(&a)?
            } else if base == SPACES {
                let b: SpacesFile = decode(&original)?;
                ensure(
                    same(&snap.spaces, &b),
                    "Spaces differ; pick the copy you want and discard the other",
                )?;
                encode(&b)?
            } else {
                let b: Settings = decode(&original)?;
                ensure(
                    same(&snap.settings, &b),
                    "Settings differ; select the desired values manually before discarding",
                )?;
                encode(&b)?
            };
            self.commit(&mut state, &files, BTreeMap::from([(base.clone(), merged)]))?;
        }
        ensure(
            bytes(&root.join(&actual))?.as_ref() == Some(&original),
            "Conflict changed during resolution; retry",
        )?;
        no_symlinks(&root.join(&actual))?;
        fs::remove_file(root.join(actual)).map_err(io)?;
        drop(state);
        self.snapshot()
    }
}
fn log_name(log_id: &str) -> String {
    format!("daily-log-{log_id}.json")
}
/// Id of the main space in operations (`None` means the same).
pub const MAIN_SPACE: &str = "main";
/// The task list, subtask definitions and log an operation addresses.
fn target<'a>(
    snap: &'a mut Snapshot,
    space: &Option<String>,
) -> Result<(&'a [String], &'a SubtaskMap, &'a mut DailyLog)> {
    match space.as_deref().filter(|id| *id != MAIN_SPACE) {
        None => Ok((
            &snap.settings.habits.tasks,
            &snap.spaces.main.subtasks,
            &mut snap.daily_log,
        )),
        Some(id) => {
            let s = snap
                .spaces
                .spaces
                .iter()
                .find(|s| s.id == id)
                .ok_or("Unknown space")?;
            Ok((
                &s.habits.tasks,
                &s.subtasks,
                snap.space_logs.entry(id.to_string()).or_default(),
            ))
        }
    }
}
fn set_entry(day: &mut Vec<String>, entry: &str, done: bool) {
    day.retain(|t| t != entry);
    if done {
        day.push(entry.into());
    }
}
/// A task with subtasks takes them along: ticking it ticks all of them, unticking clears them.
/// Mirrors `toggleTask` in packages/core/src/spaces.ts.
pub(crate) fn toggle_task(log: &mut DailyLog, day: &str, task: &str, done: bool, subs: &[String]) {
    let entries = log.entry(day.into()).or_default();
    set_entry(entries, task, done);
    for sub in subs {
        set_entry(entries, &subtask_entry(task, sub), done);
    }
}
/// The parent is done exactly when every subtask is. Mirrors `toggleSubtask`.
pub(crate) fn toggle_subtask(
    log: &mut DailyLog,
    day: &str,
    task: &str,
    sub: &str,
    done: bool,
    subs: &[String],
) {
    let entries = log.entry(day.into()).or_default();
    set_entry(entries, &subtask_entry(task, sub), done);
    let all = subs
        .iter()
        .all(|s| entries.contains(&subtask_entry(task, s)));
    set_entry(entries, task, all);
}
fn rename_log(log: &mut DailyLog, from: &str, to: &str) {
    let prefix = format!("{from}{SUBTASK_SEPARATOR}");
    for tasks in log.values_mut() {
        for t in tasks.iter_mut() {
            if t == from {
                *t = to.into();
            } else if let Some(sub) = t.strip_prefix(&prefix) {
                *t = subtask_entry(to, sub);
            }
        }
        let mut seen = BTreeSet::new();
        tasks.retain(|t| seen.insert(t.clone()));
    }
}
fn merge_map(a: &mut BTreeMap<String, u32>, b: BTreeMap<String, u32>) -> Result<()> {
    for (k, v) in b {
        if let Some(old) = a.get(&k) {
            ensure(
                *old == v,
                "Different sleep values for the same date; manual review needed",
            )?;
        } else {
            a.insert(k, v);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
