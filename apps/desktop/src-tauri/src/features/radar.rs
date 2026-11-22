//! Deadline Radar: calendar events and due reminders from EventKit and Google, a process-wide cache
//! of them, the "due tomorrow" alert and the menu-bar (or tray) "next deadline" label.
//!
//! * `radar_mac.rs` (imported as `native`) is the only code that touches EventKit; on other
//!   platforms it is a stub that reports "unsupported". On Windows, Google Calendar and Google Tasks
//!   (`google.rs`) are the whole radar.
//! * Nothing asks for permission at startup. [`radar_request_access`] does, and the frontend calls it
//!   when Radar is switched on and access is still undetermined.
//! * The cache refreshes every [`TTL_MS`] while Radar is on, when the configuration that shapes the
//!   query (or the day) changes, and on demand: `radar_items` re-reads when the cache is older than
//!   [`ON_DEMAND_TTL_MS`], so opening the Radar view or the Today card catches up quickly. (The
//!   EventKit change notification is registered too, but the store thread runs no run loop, so do not
//!   rely on it for instant updates.) A refresh that changes anything pokes
//!   the scheduler (`Backend::changed`) so alerts and the tray label are rebuilt.
//! * [`select`] mirrors `selectRadarItems` in `packages/core/src/radar.ts`; keep the two in step.
use super::{Alert, AlertKind};
use crate::contracts::{RadarConfig, Snapshot};
use crate::runtime::Backend;
use chrono::{DateTime, Local, NaiveDate, TimeDelta, TimeZone};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

#[path = "radar_mac.rs"]
mod native;
#[path = "google.rs"]
pub mod google;

pub const ID: &str = "radar";
/// Cached items older than this are re-read.
const TTL_MS: i64 = 5 * 60_000;
/// A `radar_items` call (the view or card mounting, or a native change event) re-reads EventKit when
/// the cache is older than this.
const ON_DEMAND_TTL_MS: i64 = 60_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessState {
    NotDetermined,
    Restricted,
    Denied,
    FullAccess,
    WriteOnly,
    Unsupported,
}
impl From<native::Access> for AccessState {
    fn from(a: native::Access) -> Self {
        match a {
            native::Access::NotDetermined => Self::NotDetermined,
            native::Access::Restricted => Self::Restricted,
            native::Access::Denied => Self::Denied,
            native::Access::FullAccess => Self::FullAccess,
            native::Access::WriteOnly => Self::WriteOnly,
            native::Access::Unsupported => Self::Unsupported,
        }
    }
}

/// Authorization, reported separately for events and reminders.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarStatus {
    pub supported: bool,
    pub events: AccessState,
    pub reminders: AccessState,
    /// Signed in to Google Calendar (read without macOS Calendar access).
    pub google: bool,
    /// Google sign-in is available here (the Mac and Windows apps).
    pub google_supported: bool,
}
impl RadarStatus {
    fn current() -> Self {
        let (events, reminders) = native::authorization();
        Self {
            supported: native::supported(),
            events: events.into(),
            reminders: reminders.into(),
            google: google_connected(),
            google_supported: google::SUPPORTED,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Event,
    Reminder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarItem {
    pub id: String,
    pub title: String,
    /// Epoch milliseconds.
    pub date: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<i64>,
    pub all_day: bool,
    pub source: String,
    pub kind: ItemKind,
}
impl From<native::Item> for RadarItem {
    fn from(i: native::Item) -> Self {
        Self {
            id: i.id,
            title: i.title,
            date: i.date,
            end: i.end,
            all_day: i.all_day,
            source: i.source,
            kind: if i.is_reminder {
                ItemKind::Reminder
            } else {
                ItemKind::Event
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarCalendar {
    pub title: String,
    pub account: String,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarCalendars {
    pub events: Vec<RadarCalendar>,
    pub reminders: Vec<RadarCalendar>,
}
impl From<native::CalendarLists> for RadarCalendars {
    fn from(l: native::CalendarLists) -> Self {
        let map = |v: Vec<native::CalendarInfo>| {
            v.into_iter()
                .map(|c| RadarCalendar {
                    title: c.title,
                    account: c.account,
                })
                .collect()
        };
        Self {
            events: map(l.events),
            reminders: map(l.reminders),
        }
    }
}

/// What `radar_items` returns: the items for the current configuration plus how fresh and permitted they are.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarItems {
    pub items: Vec<RadarItem>,
    pub status: RadarStatus,
    /// When the cache was last read (epoch ms); `None` before the first read.
    pub refreshed_at: Option<i64>,
    /// The last read's error, if it failed.
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Pure rules (mirrors packages/core/src/radar.ts)
// ---------------------------------------------------------------------------------------------

fn start_of_day(day: NaiveDate) -> DateTime<Local> {
    // Midnight can be skipped by a DST change in some zones; fall back to the first valid hour.
    for hour in 0..4 {
        if let Some(t) = day
            .and_hms_opt(hour, 0, 0)
            .and_then(|n| Local.from_local_datetime(&n).earliest())
        {
            return t;
        }
    }
    Local.from_utc_datetime(&day.and_hms_opt(0, 0, 0).unwrap_or_default())
}
fn start_ms(day: NaiveDate) -> i64 {
    start_of_day(day).timestamp_millis()
}
fn plus_days(day: NaiveDate, days: i64) -> NaiveDate {
    day + TimeDelta::days(days)
}
fn local_day(ms: i64) -> Option<NaiveDate> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.date_naive())
}
/// Whole local calendar days from `now`'s day to the day of `ms`; negative when overdue.
pub fn days_until(ms: i64, now: DateTime<Local>) -> i64 {
    local_day(ms).map_or(0, |d| (d - now.date_naive()).num_days())
}

/// Events from today to `days_ahead` out (finished timed events skipped), narrowed by calendar and
/// keywords; incomplete reminders from `overdue_days_back` ago to the same horizon, narrowed by list.
/// Sorted by date.
pub fn select(items: &[RadarItem], cfg: &RadarConfig, now: DateTime<Local>) -> Vec<RadarItem> {
    let today = now.date_naive();
    let from = start_ms(today);
    let horizon = start_ms(plus_days(today, i64::from(cfg.days_ahead)));
    let earliest = start_ms(plus_days(today, -i64::from(cfg.overdue_days_back)));
    let now_ms = now.timestamp_millis();
    let keywords: Vec<String> = cfg
        .keywords
        .iter()
        .map(|k| k.trim().to_lowercase())
        .filter(|k| !k.is_empty())
        .collect();
    let mut out: Vec<RadarItem> = items
        .iter()
        .filter(|i| match i.kind {
            ItemKind::Reminder => {
                cfg.include_reminders
                    && (cfg.reminder_lists.is_empty() || cfg.reminder_lists.contains(&i.source))
                    && i.date >= earliest
                    && i.date <= horizon
            }
            ItemKind::Event => {
                let end = i.end.unwrap_or(i.date);
                (cfg.calendars.is_empty() || cfg.calendars.contains(&i.source))
                    && (keywords.is_empty()
                        || keywords.iter().any(|k| i.title.to_lowercase().contains(k)))
                    && i.date < horizon
                    && (i.all_day || end > now_ms)
                    && end >= from
            }
        })
        .cloned()
        .collect();
    out.sort_by(|a, b| (a.date, &a.title, a.kind).cmp(&(b.date, &b.title, b.kind)));
    out
}

fn shorten(title: &str, max: usize) -> String {
    let title = title.trim();
    if title.chars().count() <= max {
        title.to_string()
    } else {
        let head: String = title.chars().take(max).collect();
        format!("{}…", head.trim_end())
    }
}

/// "Essay · 2d" for the menu bar: the first selected item, how many days away (or late).
pub fn next_deadline_label(
    items: &[RadarItem],
    fetched: bool,
    cfg: &RadarConfig,
    now: DateTime<Local>,
) -> String {
    let Some(next) = select(items, cfg, now).into_iter().next() else {
        return if fetched { "No deadlines" } else { "Deadlines" }.into();
    };
    let days = days_until(next.date, now);
    let when = match days {
        d if d < 0 => format!("{}d late", -d),
        0 => "today".to_string(),
        d => format!("{d}d"),
    };
    format!("{} · {when}", shorten(&next.title, 18))
}

/// The "due tomorrow" notification at `alert_time` on each day that has items due the next day.
/// Looks at today's and tomorrow's alert time, whichever are still ahead of `now`. Depends only on its
/// arguments, as `features::is_current` requires.
pub fn due_alerts(items: &[RadarItem], cfg: &RadarConfig, now: DateTime<Local>) -> Vec<Alert> {
    let Ok(time) = chrono::NaiveTime::parse_from_str(&cfg.alert_time, "%H:%M") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for offset in 0..=1 {
        let day = plus_days(now.date_naive(), offset);
        let Some(at) = Local.from_local_datetime(&day.and_time(time)).earliest() else {
            continue; // that wall-clock time does not exist today (DST gap)
        };
        if at.timestamp_millis() <= now.timestamp_millis() {
            continue;
        }
        let tomorrow = plus_days(day, 1);
        let due: Vec<RadarItem> = select(items, cfg, at)
            .into_iter()
            .filter(|i| local_day(i.date) == Some(tomorrow))
            .collect();
        let Some(first) = due.first() else {
            continue;
        };
        let more = due.len() - 1;
        let title = if more == 0 {
            format!("Due tomorrow: {}", shorten(&first.title, 60))
        } else {
            format!(
                "Due tomorrow: {} (and {more} more)",
                shorten(&first.title, 50)
            )
        };
        let body = due
            .iter()
            .take(3)
            .map(|i| format!("{} · {}", shorten(&i.title, 40), i.source))
            .collect::<Vec<_>>()
            .join("\n");
        let at_ms = at.timestamp_millis();
        out.push(Alert {
            id: format!("radar:due:{at_ms}"),
            at: at_ms,
            title,
            body,
            kind: AlertKind::Feature {
                id: ID,
                key: format!("due:{at_ms}"),
            },
        });
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------------------------

struct Cache {
    /// What the cached items were read for (see [`fetch_key`]).
    key: String,
    /// EventKit items plus the Google ones not already among them.
    items: Vec<RadarItem>,
    native: Vec<RadarItem>,
    google: Vec<RadarItem>,
    google_calendars: Vec<RadarCalendar>,
    /// Google Tasks lists, shown with the reminder lists.
    google_lists: Vec<RadarCalendar>,
    calendars: RadarCalendars,
    fetched_at: Option<i64>,
    error: Option<String>,
}
impl Cache {
    const fn empty() -> Self {
        Self {
            key: String::new(),
            items: Vec::new(),
            native: Vec::new(),
            google: Vec::new(),
            google_calendars: Vec::new(),
            google_lists: Vec::new(),
            calendars: RadarCalendars {
                events: Vec::new(),
                reminders: Vec::new(),
            },
            fetched_at: None,
            error: None,
        }
    }
}
static CACHE: Mutex<Cache> = Mutex::new(Cache::empty());
/// Serialises refreshes so a burst of triggers reads EventKit once.
static REFRESH: Mutex<()> = Mutex::new(());
static FORCE: AtomicBool = AtomicBool::new(false);
static KICK: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn cache() -> MutexGuard<'static, Cache> {
    CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

/// The inputs that decide what is read from EventKit. Keywords and alert settings are applied later
/// and so are not part of it. Includes the day, so the window moves at midnight.
fn fetch_key(cfg: &RadarConfig, now: DateTime<Local>) -> String {
    serde_json::to_string(&(
        &cfg.calendars,
        &cfg.reminder_lists,
        cfg.include_reminders,
        cfg.days_ahead,
        cfg.overdue_days_back,
        now.date_naive().to_string(),
    ))
    .unwrap_or_default()
}
fn is_stale(cache: &Cache, key: &str, now_ms: i64) -> bool {
    is_older_than(cache, key, now_ms, TTL_MS)
}
fn is_older_than(cache: &Cache, key: &str, now_ms: i64, max_age_ms: i64) -> bool {
    cache.key != key
        || cache
            .fetched_at
            .is_none_or(|t| now_ms - t > max_age_ms || now_ms < t)
}

/// Reads EventKit if the cache is stale (or `force`). Returns whether the cached data changed.
fn ensure_fresh(cfg: &RadarConfig, force: bool, now: DateTime<Local>) -> bool {
    ensure_fresh_within(cfg, force, TTL_MS, now)
}
/// [`ensure_fresh`] with a custom maximum age for the cache.
fn ensure_fresh_within(
    cfg: &RadarConfig,
    force: bool,
    max_age_ms: i64,
    now: DateTime<Local>,
) -> bool {
    let key = fetch_key(cfg, now);
    let _only_one = REFRESH.lock().unwrap_or_else(|e| e.into_inner());
    if !force && !is_older_than(&cache(), &key, now.timestamp_millis(), max_age_ms) {
        return false;
    }
    let (events, reminders) = native::authorization();
    let readable = |a: native::Access| a == native::Access::FullAccess;
    let want_events = readable(events);
    let want_reminders = cfg.include_reminders && readable(reminders);
    let today = now.date_naive();
    let query = native::Query {
        from_ms: start_ms(today),
        to_ms: start_ms(plus_days(today, i64::from(cfg.days_ahead))),
        reminders_from_ms: start_ms(plus_days(today, -i64::from(cfg.overdue_days_back))),
        calendars: cfg.calendars.clone(),
        reminder_lists: cfg.reminder_lists.clone(),
        include_reminders: cfg.include_reminders,
    };
    let fetched = if want_events || want_reminders {
        native::fetch(&query)
    } else {
        Ok(Vec::new())
    };
    let lists = if readable(events) || readable(reminders) {
        native::calendars().map(RadarCalendars::from).ok()
    } else {
        Some(RadarCalendars::default())
    };
    let google = google_fetch(&google::Window {
        from_ms: query.from_ms,
        to_ms: query.to_ms,
        calendars: &cfg.calendars,
        tasks_from_ms: query.reminders_from_ms,
        task_lists: &cfg.reminder_lists,
        include_tasks: cfg.include_reminders,
    });
    let mut c = cache();
    let before = (c.items.clone(), c.calendars.clone(), c.error.clone());
    let same_key = c.key == key;
    let mut errors = Vec::new();
    match fetched {
        Ok(items) => c.native = items.into_iter().map(RadarItem::from).collect(),
        Err(e) => {
            if !same_key {
                c.native.clear();
            }
            errors.push(e);
        }
    }
    match google {
        None => {
            c.google.clear();
            c.google_calendars.clear();
            c.google_lists.clear();
        }
        Some(Ok(g)) => {
            c.google = g.items;
            c.google_calendars = g.calendars;
            c.google_lists = g.lists;
        }
        // Offline or a hiccup: keep the last good Google items for the same window.
        Some(Err(e)) => {
            if !same_key {
                c.google.clear();
            }
            errors.push(format!("Google: {e}"));
        }
    }
    c.items = google::merge(c.native.clone(), c.google.clone());
    c.error = (!errors.is_empty()).then(|| errors.join(" · "));
    if let Some(mut lists) = lists {
        lists.events.extend(c.google_calendars.iter().cloned());
        lists.reminders.extend(c.google_lists.iter().cloned());
        c.calendars = lists;
    }
    c.key = key;
    c.fetched_at = Some(now.timestamp_millis());
    (c.items.clone(), c.calendars.clone(), c.error.clone()) != before
}

/// Google events for the window, or `None` when not signed in. Tests substitute their own.
#[cfg(not(test))]
fn google_fetch(window: &google::Window) -> Option<Result<google::Fetched, String>> {
    google::fetch(window)
}
#[cfg(not(test))]
fn google_connected() -> bool {
    google::status().connected
}
#[cfg(test)]
fn google_fetch(_: &google::Window) -> Option<Result<google::Fetched, String>> {
    testing::GOOGLE.lock().unwrap_or_else(|e| e.into_inner()).take()
}
#[cfg(test)]
fn google_connected() -> bool {
    false
}

fn kick() {
    if let Some(tx) = KICK.get() {
        let _ = tx.lock().map(|tx| tx.send(()));
    }
}
fn on_store_changed() {
    FORCE.store(true, Ordering::SeqCst);
    kick();
}
/// Tells the scheduler and the frontend that the radar data changed.
fn announce(app: &tauri::AppHandle) {
    let _ = app.emit("daybar://radar", ());
    if let Some(backend) = app.try_state::<Backend>() {
        backend.changed();
    }
}

/// Starts the background refresher. Called once from `runtime::start`; never asks for permission.
pub fn init(app: tauri::AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    native::set_change_listener(on_store_changed);
    let (tx, rx) = mpsc::channel::<()>();
    let _ = KICK.set(Mutex::new(tx));
    let _ = std::thread::Builder::new()
        .name("daybar-radar".into())
        .spawn(move || {
            // First look a few seconds after startup (the backend is not managed yet at `init`).
            let mut wait = Duration::from_secs(3);
            loop {
                let _ = rx.recv_timeout(wait);
                wait = Duration::from_millis(TTL_MS as u64);
                // Coalesce a burst of change notifications into one read.
                std::thread::sleep(Duration::from_millis(500));
                while rx.try_recv().is_ok() {}
                let Some(backend) = app.try_state::<Backend>() else {
                    continue;
                };
                let Ok(prefs) = backend.store.preferences() else {
                    continue;
                };
                let cfg = prefs.features.radar;
                if cfg.enabled
                    && ensure_fresh(&cfg, FORCE.swap(false, Ordering::SeqCst), Local::now())
                {
                    announce(&app);
                }
            }
        });
}

/// Whether the cache needs a read for this configuration; if so, wakes the refresher.
fn nudge(cfg: &RadarConfig, now: DateTime<Local>) {
    if is_stale(&cache(), &fetch_key(cfg, now), now.timestamp_millis()) {
        kick();
    }
}

fn items_for(cfg: &RadarConfig, now: DateTime<Local>) -> RadarItems {
    let c = cache();
    RadarItems {
        items: select(&c.items, cfg, now),
        status: RadarStatus::current(),
        refreshed_at: c.fetched_at,
        error: c.error.clone(),
    }
}

// ---------------------------------------------------------------------------------------------
// Hooks used by the scheduler and the tray
// ---------------------------------------------------------------------------------------------

/// Alerts wanted from `now` onwards. Called only while the feature is active. Reads the cache, so it
/// is deterministic for a given cache, snapshot and `now`.
pub fn alerts(s: &Snapshot, now: DateTime<Local>) -> Vec<Alert> {
    let cfg = &s.preferences.features.radar;
    if !cfg.due_alerts {
        return Vec::new();
    }
    nudge(cfg, now);
    due_alerts(&cache().items, cfg, now)
}

/// The menu-bar text for the `nextDeadline` display mode.
pub fn tray_label(s: &Snapshot, now: DateTime<Local>) -> String {
    let cfg = &s.preferences.features.radar;
    nudge(cfg, now);
    let c = cache();
    next_deadline_label(&c.items, c.fetched_at.is_some(), cfg, now)
}

// ---------------------------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------------------------

type CommandResult<T> = std::result::Result<T, String>;
fn blocking_failed(e: tauri::Error) -> String {
    e.to_string()
}

/// Authorization for events and reminders, and whether this platform has EventKit at all.
#[tauri::command]
pub async fn radar_status() -> CommandResult<RadarStatus> {
    Ok(RadarStatus::current())
}

/// Asks macOS for events access, then reminders access when `includeReminders` is on. Shows the
/// system prompt only for a kind that is still undetermined. Returns the resulting status.
#[tauri::command]
pub async fn radar_request_access(backend: State<'_, Backend>) -> CommandResult<RadarStatus> {
    let cfg = backend.store.preferences()?.features.radar;
    let asked = tauri::async_runtime::spawn_blocking(move || {
        let asked = native::request_access(true, cfg.include_reminders);
        ensure_fresh(&cfg, true, Local::now());
        asked
    })
    .await
    .map_err(blocking_failed)?;
    backend.changed();
    match asked {
        Err(e) if native::supported() => Err(e),
        _ => Ok(RadarStatus::current()),
    }
}

/// The event calendars and reminder lists, for the Settings pickers (empty without access).
#[tauri::command]
pub async fn radar_calendars() -> CommandResult<RadarCalendars> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut lists = native::calendars()
            .map(RadarCalendars::from)
            .unwrap_or_default();
        let c = cache();
        lists.events.extend(c.google_calendars.iter().cloned());
        lists.reminders.extend(c.google_lists.iter().cloned());
        lists
    })
    .await
    .map_err(blocking_failed)
}

/// The items for the current `preferences.features.radar` configuration. Reads EventKit first when the
/// cache is older than [`ON_DEMAND_TTL_MS`], the configuration or day changed, or `refresh` is true.
#[tauri::command]
pub async fn radar_items(
    backend: State<'_, Backend>,
    refresh: Option<bool>,
) -> CommandResult<RadarItems> {
    let cfg = backend.store.preferences()?.features.radar;
    let (changed, result) = tauri::async_runtime::spawn_blocking(move || {
        let now = Local::now();
        let changed = ensure_fresh_within(&cfg, refresh.unwrap_or(false), ON_DEMAND_TTL_MS, now);
        (changed, items_for(&cfg, now))
    })
    .await
    .map_err(blocking_failed)?;
    if changed {
        backend.changed();
    }
    Ok(result)
}

/// Whether Google Calendar is signed in, and to which account.
#[tauri::command]
pub async fn radar_google_status() -> CommandResult<google::GoogleStatus> {
    tauri::async_runtime::spawn_blocking(google::status)
        .await
        .map_err(blocking_failed)
}

/// Opens Google's consent page in the browser and waits (up to five minutes) for the reply, then
/// stores the sign-in in the Keychain and re-reads the radar.
#[tauri::command]
pub async fn radar_google_connect(
    app: tauri::AppHandle,
    backend: State<'_, Backend>,
    client_id: String,
    client_secret: String,
) -> CommandResult<google::GoogleStatus> {
    let cfg = backend.store.preferences()?.features.radar;
    let status = tauri::async_runtime::spawn_blocking(move || {
        let status = google::connect(&client_id, &client_secret)?;
        ensure_fresh(&cfg, true, Local::now());
        Ok::<_, String>(status)
    })
    .await
    .map_err(blocking_failed)??;
    announce(&app);
    Ok(status)
}

/// Revokes and forgets the Google sign-in; Google events leave the radar.
#[tauri::command]
pub async fn radar_google_disconnect(
    app: tauri::AppHandle,
    backend: State<'_, Backend>,
) -> CommandResult<google::GoogleStatus> {
    let cfg = backend.store.preferences()?.features.radar;
    let status = tauri::async_runtime::spawn_blocking(move || {
        let status = google::disconnect()?;
        ensure_fresh(&cfg, true, Local::now());
        Ok::<_, String>(status)
    })
    .await
    .map_err(blocking_failed)??;
    announce(&app);
    Ok(status)
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    static LOCK: Mutex<()> = Mutex::new(());
    /// What the next Google read returns (`None`: not signed in).
    pub static GOOGLE: Mutex<Option<Result<google::Fetched, String>>> = Mutex::new(None);

    /// Tests that touch the process-wide cache hold this for their whole body.
    pub fn lock() -> MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Replaces the cache with `items`, marked as freshly read for `cfg`.
    pub fn set_items(items: Vec<RadarItem>, cfg: &RadarConfig, now: DateTime<Local>) {
        let mut c = cache();
        c.items = items;
        c.key = fetch_key(cfg, now);
        c.fetched_at = Some(now.timestamp_millis());
        c.error = None;
    }
    pub fn clear() {
        *cache() = Cache::empty();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features;
    use serde_json::json;

    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .earliest()
            .unwrap()
    }
    /// Epoch ms of `h:m` local, `day` days after the fixed "now" (Mon 16 Nov 2026, 12:00).
    fn at(day: i64, h: u32, m: u32) -> i64 {
        let d = plus_days(NOW.date_naive(), day);
        Local
            .from_local_datetime(&d.and_hms_opt(h, m, 0).unwrap())
            .earliest()
            .unwrap()
            .timestamp_millis()
    }
    static NOW: std::sync::LazyLock<DateTime<Local>> =
        std::sync::LazyLock::new(|| local(2026, 11, 16, 12, 0));
    fn testing_snapshot() -> Snapshot {
        let mut preferences: crate::contracts::Preferences = serde_json::from_str(
            r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#,
        )
        .unwrap();
        preferences.features = crate::contracts::Features::all_optional_off();
        Snapshot {
            settings: Default::default(),
            daily_log: Default::default(),
            focus: Default::default(),
            sleep: Default::default(),
            spaces: Default::default(),
            space_logs: Default::default(),
            preferences,
            issues: vec![],
            conflicts: vec![],
        }
    }

    fn cfg() -> RadarConfig {
        RadarConfig {
            enabled: true,
            due_alerts: true,
            ..RadarConfig::default()
        }
    }
    fn event(title: &str, date: i64, source: &str) -> RadarItem {
        RadarItem {
            id: format!("{title}:{date}"),
            title: title.into(),
            date,
            end: Some(date + 3_600_000),
            all_day: false,
            source: source.into(),
            kind: ItemKind::Event,
        }
    }
    fn reminder(title: &str, date: i64, source: &str) -> RadarItem {
        RadarItem {
            id: format!("{title}:{date}"),
            title: title.into(),
            date,
            end: None,
            all_day: true,
            source: source.into(),
            kind: ItemKind::Reminder,
        }
    }
    fn titles(items: &[RadarItem]) -> Vec<&str> {
        items.iter().map(|i| i.title.as_str()).collect()
    }

    #[test]
    fn select_matches_the_phone_rules() {
        let now = *NOW;
        let items = vec![
            event("Done", at(0, 9, 0), "Work"),
            event("Running", at(0, 11, 30), "Work"),
            event("Soon", at(2, 9, 0), "Home"),
            event("Far", at(70, 9, 0), "Work"),
            reminder("Late", at(-3, 0, 0), "School"),
            reminder("Ancient", at(-20, 0, 0), "School"),
            reminder("Due", at(1, 0, 0), "Other"),
        ];
        let all = select(&items, &cfg(), now);
        assert_eq!(titles(&all), ["Late", "Running", "Due", "Soon"]);
        let mut only = cfg();
        only.calendars = vec!["Home".into()];
        only.reminder_lists = vec!["School".into()];
        assert_eq!(titles(&select(&items, &only, now)), ["Late", "Soon"]);
        let mut no_reminders = cfg();
        no_reminders.include_reminders = false;
        assert_eq!(
            titles(&select(&items, &no_reminders, now)),
            ["Running", "Soon"]
        );
        let mut words = cfg();
        words.keywords = vec!["  SOO".into(), "".into()];
        assert_eq!(
            titles(&select(&items, &words, now)),
            ["Late", "Due", "Soon"]
        );
    }

    #[test]
    fn days_are_local_calendar_days() {
        let now = *NOW;
        assert_eq!(days_until(at(0, 23, 59), now), 0);
        assert_eq!(days_until(at(1, 0, 1), now), 1);
        assert_eq!(days_until(at(-1, 23, 0), now), -1);
        assert_eq!(days_until(at(30, 8, 0), now), 30);
    }

    #[test]
    fn tray_label_shows_title_and_days_and_truncates() {
        let now = *NOW;
        let c = cfg();
        let items = vec![
            event("Essay", at(2, 9, 0), "Work"),
            event("A very long deadline title indeed", at(5, 9, 0), "Work"),
        ];
        assert_eq!(next_deadline_label(&items, true, &c, now), "Essay · 2d");
        assert_eq!(
            next_deadline_label(&items[1..], true, &c, now),
            "A very long deadli… · 5d"
        );
        assert_eq!(
            next_deadline_label(&[reminder("Form", at(-2, 0, 0), "S")], true, &c, now),
            "Form · 2d late"
        );
        assert_eq!(
            next_deadline_label(&[reminder("Form", at(0, 0, 0), "S")], true, &c, now),
            "Form · today"
        );
        assert_eq!(next_deadline_label(&[], true, &c, now), "No deadlines");
        assert_eq!(next_deadline_label(&[], false, &c, now), "Deadlines");
    }

    #[test]
    fn due_alert_fires_at_alert_time_when_something_is_due_tomorrow() {
        let now = *NOW; // Mon 12:00, alert time 09:00 so today's has passed
        let items = vec![
            event("Essay", at(2, 10, 0), "Work"),
            event("Quiz", at(1, 9, 0), "School"),
            reminder("Form", at(1, 0, 0), "Admin"),
        ];
        let out = due_alerts(&items, &cfg(), now);
        // Today's 09:00 has passed. Tomorrow's 09:00 looks at the day after, where only Essay is due.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].at, at(1, 9, 0));
        assert_eq!(out[0].title, "Due tomorrow: Essay");
    }

    #[test]
    fn due_alert_counts_the_others_and_is_skipped_when_nothing_is_due() {
        let early = local(2026, 11, 16, 7, 0);
        let items = vec![
            event("Quiz", at(1, 9, 0), "School"),
            reminder("Form", at(1, 0, 0), "Admin"),
            event("Lab", at(1, 14, 0), "School"),
        ];
        let out = due_alerts(&items, &cfg(), early);
        assert_eq!(out[0].at, at(0, 9, 0));
        assert_eq!(out[0].title, "Due tomorrow: Form (and 2 more)");
        assert!(out[0].body.contains("Quiz · School"));
        assert_eq!(out[0].id, format!("radar:due:{}", at(0, 9, 0)));
        assert!(due_alerts(&[], &cfg(), early).is_empty());
        let mut bad = cfg();
        bad.alert_time = "nope".into();
        assert!(due_alerts(&items, &bad, early).is_empty());
    }

    #[test]
    fn alerts_read_the_cache_and_revalidate_through_the_aggregator() {
        let _guard = testing::lock();
        let early = local(2026, 11, 16, 7, 0);
        let mut s = testing_snapshot();
        s.preferences.features.radar = cfg();
        testing::set_items(vec![event("Quiz", at(1, 9, 0), "School")], &cfg(), early);
        let out = features::alerts(&s, early);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Due tomorrow: Quiz");
        assert!(features::is_current(&out[0], &s));
        // Not current once the item disappears, the alert is switched off, or Radar is off.
        testing::set_items(vec![], &cfg(), early);
        assert!(!features::is_current(&out[0], &s));
        testing::set_items(vec![event("Quiz", at(1, 9, 0), "School")], &cfg(), early);
        let mut off = s.clone();
        off.preferences.features.radar.due_alerts = false;
        assert!(features::alerts(&off, early).is_empty());
        assert!(!features::is_current(&out[0], &off));
        off.preferences.features.radar = RadarConfig {
            enabled: false,
            ..cfg()
        };
        assert!(!features::is_current(&out[0], &off));
        testing::clear();
    }

    #[test]
    fn stale_cache_rules() {
        let c = cfg();
        let now = *NOW;
        let mut cache = Cache::empty();
        let key = fetch_key(&c, now);
        assert!(is_stale(&cache, &key, 0));
        cache.key = key.clone();
        cache.fetched_at = Some(1_000);
        assert!(!is_stale(&cache, &key, 1_000 + TTL_MS));
        assert!(is_stale(&cache, &key, 1_001 + TTL_MS));
        // On demand (a view opening) the cache counts as stale after a minute.
        assert!(!is_older_than(&cache, &key, 1_000 + ON_DEMAND_TTL_MS, ON_DEMAND_TTL_MS));
        assert!(is_older_than(&cache, &key, 1_001 + ON_DEMAND_TTL_MS, ON_DEMAND_TTL_MS));
        let mut other = c.clone();
        other.days_ahead = 30;
        assert!(is_stale(&cache, &fetch_key(&other, now), 1_000));
        let mut words = c.clone();
        words.keywords = vec!["x".into()];
        assert!(!is_stale(&cache, &fetch_key(&words, now), 1_000));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn off_mac_everything_reports_unsupported() {
        // Windows signs in to Google instead; elsewhere (Linux tests) there is nothing at all.
        assert_eq!(google::SUPPORTED, cfg!(windows));
        let status = RadarStatus::current();
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            json!({"supported": false, "events": "unsupported", "reminders": "unsupported", "google": false, "googleSupported": google::SUPPORTED})
        );
        assert!(native::request_access(true, true).is_err());
        assert!(native::fetch(&native::Query {
            from_ms: 0,
            to_ms: 1,
            reminders_from_ms: 0,
            calendars: vec![],
            reminder_lists: vec![],
            include_reminders: true
        })
        .is_err());
        // A failed read is remembered, not retried in a loop, and yields no items.
        let _guard = testing::lock();
        testing::clear();
        let c = cfg();
        let now = *NOW;
        ensure_fresh(&c, false, now);
        let out = items_for(&c, now);
        assert!(out.items.is_empty());
        assert!(out.error.is_some() || out.refreshed_at.is_some());
        assert!(!is_stale(
            &cache(),
            &fetch_key(&c, now),
            now.timestamp_millis()
        ));
        testing::clear();
    }

    #[test]
    fn google_events_join_the_radar_and_survive_a_failed_read() {
        let _guard = testing::lock();
        testing::clear();
        let c = cfg();
        let now = *NOW;
        let soon = now.timestamp_millis() + 86_400_000;
        let set = |next: Option<Result<google::Fetched, String>>| {
            *testing::GOOGLE.lock().unwrap() = next;
        };
        set(Some(Ok(google::Fetched {
            items: vec![event("Board meeting", soon, "Team")],
            calendars: vec![RadarCalendar { title: "Team".into(), account: "Google · me@example.com".into() }],
            lists: vec![RadarCalendar { title: "My Tasks".into(), account: "Google · me@example.com".into() }],
        })));
        ensure_fresh(&c, true, now);
        assert_eq!(titles(&items_for(&c, now).items), ["Board meeting"]);
        assert!(cache().calendars.events.iter().any(|cal| cal.title == "Team"));
        assert!(cache().calendars.reminders.iter().any(|l| l.title == "My Tasks"));

        // Offline: the last Google items stay, with an error that names Google.
        set(Some(Err("Could not reach Google".into())));
        ensure_fresh(&c, true, now);
        let out = items_for(&c, now);
        assert_eq!(titles(&out.items), ["Board meeting"]);
        assert!(out.error.unwrap().contains("Google: Could not reach Google"));

        // Signed out: they go.
        set(None);
        ensure_fresh(&c, true, now);
        assert!(items_for(&c, now).items.is_empty());
        assert!(!cache().calendars.events.iter().any(|cal| cal.title == "Team"));
        assert!(!cache().calendars.reminders.iter().any(|l| l.title == "My Tasks"));
        testing::clear();
    }

    #[test]
    fn command_payloads_are_camel_case() {
        let item = event("Essay", 1_000, "Work");
        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            json!({"id":"Essay:1000","title":"Essay","date":1000,"end":3601000,"allDay":false,"source":"Work","kind":"event"})
        );
        let r = reminder("Form", 5, "Admin");
        assert_eq!(serde_json::to_value(&r).unwrap()["kind"], "reminder");
        assert!(serde_json::to_value(&r).unwrap().get("end").is_none());
        let all = RadarItems {
            items: vec![item],
            status: RadarStatus {
                supported: true,
                events: AccessState::FullAccess,
                reminders: AccessState::NotDetermined,
                google: false,
                google_supported: true,
            },
            refreshed_at: Some(7),
            error: None,
        };
        let json = serde_json::to_value(&all).unwrap();
        assert_eq!(
            json["status"],
            json!({"supported":true,"events":"fullAccess","reminders":"notDetermined","google":false,"googleSupported":true})
        );
        assert_eq!(json["refreshedAt"], 7);
        assert_eq!(json["error"], serde_json::Value::Null);
        let calendars = RadarCalendars {
            events: vec![RadarCalendar {
                title: "Work".into(),
                account: "iCloud".into(),
            }],
            reminders: vec![],
        };
        assert_eq!(
            serde_json::to_value(calendars).unwrap(),
            json!({"events":[{"title":"Work","account":"iCloud"}],"reminders":[]})
        );
        for (state, name) in [
            (AccessState::Denied, "denied"),
            (AccessState::Restricted, "restricted"),
            (AccessState::WriteOnly, "writeOnly"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), name);
        }
    }
}
