//! EventKit access for Deadline Radar.
//!
//! Self-contained on purpose: it has no `crate::` imports and exposes only plain Rust types, so it
//! can be type-checked for macOS on its own. On other platforms the same API exists as stubs that
//! report "unsupported", which keeps Linux builds and tests working.
//!
//! On macOS every EventKit call runs on one dedicated thread that owns a single long-lived
//! `EKEventStore` (created on first use, never at startup). Callers talk to it through channels and
//! wait with a timeout. Nothing here ever asks for permission unless [`request_access`] is called.

/// Authorization for one kind of data (events or reminders).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    NotDetermined,
    Restricted,
    Denied,
    FullAccess,
    WriteOnly,
    /// This platform has no EventKit.
    Unsupported,
}

/// A calendar event occurrence or a due reminder. Times are epoch milliseconds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub date: i64,
    pub end: Option<i64>,
    pub all_day: bool,
    /// Calendar or reminder-list title.
    pub source: String,
    pub is_reminder: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarInfo {
    pub title: String,
    /// The account it lives in (iCloud, Google, ...), for telling duplicates apart.
    pub account: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarLists {
    pub events: Vec<CalendarInfo>,
    pub reminders: Vec<CalendarInfo>,
}

/// What to read. Empty name lists mean "all calendars".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Query {
    pub from_ms: i64,
    pub to_ms: i64,
    pub reminders_from_ms: i64,
    pub calendars: Vec<String>,
    pub reminder_lists: Vec<String>,
    pub include_reminders: bool,
}

#[cfg(target_os = "macos")]
pub use imp::*;
#[cfg(not(target_os = "macos"))]
pub use stub::*;

#[cfg(not(target_os = "macos"))]
mod stub {
    use super::*;

    pub fn supported() -> bool {
        false
    }
    pub fn authorization() -> (Access, Access) {
        (Access::Unsupported, Access::Unsupported)
    }
    /// Registers a function called when the calendar database changes (never, here).
    pub fn set_change_listener(_listener: fn()) {}
    pub fn request_access(_events: bool, _reminders: bool) -> Result<(), String> {
        Err("Calendar access is only available on macOS.".into())
    }
    pub fn fetch(_query: &Query) -> Result<Vec<Item>, String> {
        Err("Calendar access is only available on macOS.".into())
    }
    pub fn calendars() -> Result<CalendarLists, String> {
        Err("Calendar access is only available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2::sel;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore,
        EKEventStoreChangedNotification, EKReminder,
    };
    use objc2_foundation::{
        NSArray, NSCalendar, NSDate, NSDateComponentUndefined, NSError, NSNotification,
        NSNotificationCenter,
    };
    use std::ptr::NonNull;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    /// How long a fetch may take before the caller gives up (EventKit normally answers in ms).
    const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
    /// The permission prompt waits for a person, so allow plenty of time.
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(600);

    type Reply<T> = Sender<Result<T, String>>;
    enum Cmd {
        Request {
            events: bool,
            reminders: bool,
            reply: Reply<()>,
        },
        Fetch {
            query: Query,
            reply: Reply<Vec<Item>>,
        },
        Calendars {
            reply: Reply<CalendarLists>,
        },
    }

    static WORKER: OnceLock<Mutex<Sender<Cmd>>> = OnceLock::new();
    static LISTENER: OnceLock<fn()> = OnceLock::new();

    pub fn supported() -> bool {
        true
    }

    fn convert(status: EKAuthorizationStatus) -> Access {
        match status {
            EKAuthorizationStatus::NotDetermined => Access::NotDetermined,
            EKAuthorizationStatus::Restricted => Access::Restricted,
            EKAuthorizationStatus::Denied => Access::Denied,
            EKAuthorizationStatus::FullAccess => Access::FullAccess,
            EKAuthorizationStatus::WriteOnly => Access::WriteOnly,
            // An unknown future value is the safe reading: no access.
            _ => Access::Denied,
        }
    }

    /// Current authorization for events and reminders. A class method: needs no store and never prompts.
    pub fn authorization() -> (Access, Access) {
        // SAFETY: a plain class method with an enum argument.
        unsafe {
            (
                convert(EKEventStore::authorizationStatusForEntityType(
                    EKEntityType::Event,
                )),
                convert(EKEventStore::authorizationStatusForEntityType(
                    EKEntityType::Reminder,
                )),
            )
        }
    }

    /// Registers a function called (on an arbitrary thread) when EventKit says the calendar
    /// database changed, including when access is granted or revoked. Set it once, before first use.
    pub fn set_change_listener(listener: fn()) {
        let _ = LISTENER.set(listener);
    }

    fn send<T>(make: impl FnOnce(Reply<T>) -> Cmd, timeout: Duration) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        let worker = WORKER.get_or_init(|| {
            let (cmd_tx, cmd_rx) = mpsc::channel();
            let _ = std::thread::Builder::new()
                .name("daybar-eventkit".into())
                .spawn(move || run(cmd_rx));
            Mutex::new(cmd_tx)
        });
        worker
            .lock()
            .map_err(|_| "Calendar worker is unavailable".to_string())?
            .send(make(tx))
            .map_err(|_| "Calendar worker stopped".to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| "Calendar did not answer in time".to_string())?
    }

    /// Asks macOS for access. Shows the system prompt only for a kind that is still undetermined.
    /// Returns once both answers are in (or an error / timeout); read [`authorization`] afterwards.
    pub fn request_access(events: bool, reminders: bool) -> Result<(), String> {
        send(
            |reply| Cmd::Request {
                events,
                reminders,
                reply,
            },
            PROMPT_TIMEOUT,
        )
    }

    /// Events (and, when asked, incomplete reminders) matching the query. Kinds without full access are skipped.
    pub fn fetch(query: &Query) -> Result<Vec<Item>, String> {
        send(
            |reply| Cmd::Fetch {
                query: query.clone(),
                reply,
            },
            FETCH_TIMEOUT * 2,
        )
    }

    /// The calendar and reminder-list names, for pickers.
    pub fn calendars() -> Result<CalendarLists, String> {
        send(|reply| Cmd::Calendars { reply }, FETCH_TIMEOUT)
    }

    fn run(rx: Receiver<Cmd>) {
        // SAFETY: creating a store is a plain alloc/init; it does not prompt.
        let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };
        // Keep the observer token alive for the life of the thread.
        let _observer = observe_changes(&store);
        for cmd in rx {
            match cmd {
                Cmd::Request {
                    events,
                    reminders,
                    reply,
                } => {
                    let _ = reply.send(request(&store, events, reminders));
                }
                Cmd::Fetch { query, reply } => {
                    let _ = reply.send(read_items(&store, &query));
                }
                Cmd::Calendars { reply } => {
                    let _ = reply.send(Ok(read_calendars(&store)));
                }
            }
        }
    }

    fn observe_changes(
        store: &EKEventStore,
    ) -> Retained<objc2::runtime::ProtocolObject<dyn NSObjectProtocol>> {
        let block: RcBlock<dyn Fn(NonNull<NSNotification>)> =
            RcBlock::new(|_note: NonNull<NSNotification>| {
                if let Some(listener) = LISTENER.get() {
                    listener();
                }
            });
        // SAFETY: the name is a valid notification name, `store` is an object, a nil queue runs
        // the block on the posting thread, and the block only calls a plain `fn()`.
        unsafe {
            NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
                Some(EKEventStoreChangedNotification),
                Some(store),
                None,
                &block,
            )
        }
    }

    fn request(store: &EKEventStore, events: bool, reminders: bool) -> Result<(), String> {
        let (events_now, reminders_now) = authorization();
        if events && events_now == Access::NotDetermined {
            request_one(store, EKEntityType::Event)?;
        }
        if reminders && reminders_now == Access::NotDetermined {
            request_one(store, EKEntityType::Reminder)?;
        }
        Ok(())
    }

    fn request_one(store: &EKEventStore, kind: EKEntityType) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<bool, String>>();
        let block: RcBlock<dyn Fn(Bool, *mut NSError)> =
            RcBlock::new(move |granted: Bool, error: *mut NSError| {
                let result = if error.is_null() {
                    Ok(granted.as_bool())
                } else {
                    // SAFETY: EventKit passes a valid NSError when non-null.
                    Err(unsafe { &*error }.localizedDescription().to_string())
                };
                let _ = tx.send(result);
            });
        let handler = RcBlock::as_ptr(&block);
        // SAFETY: `handler` points at a live block that outlives the call (EventKit copies it).
        // macOS 14 and later have the "full access" requests; 12.3 to 13 only have the old one,
        // which would crash with an unrecognised selector if called the new way.
        unsafe {
            let is_event = kind == EKEntityType::Event;
            let new_api = if is_event {
                sel!(requestFullAccessToEventsWithCompletion:)
            } else {
                sel!(requestFullAccessToRemindersWithCompletion:)
            };
            if store.respondsToSelector(new_api) {
                if is_event {
                    store.requestFullAccessToEventsWithCompletion(handler);
                } else {
                    store.requestFullAccessToRemindersWithCompletion(handler);
                }
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(kind, handler);
            }
        }
        // The answer is read back through `authorization()`; a "no" is not an error here.
        rx.recv_timeout(PROMPT_TIMEOUT)
            .map_err(|_| "Timed out waiting for the permission prompt".to_string())?
            .map(|_| ())
    }

    fn millis(date: &NSDate) -> i64 {
        (date.timeIntervalSince1970() * 1000.0).round() as i64
    }
    fn ns_date(ms: i64) -> Retained<NSDate> {
        NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0)
    }

    fn calendar_title(calendar: &EKCalendar) -> String {
        // SAFETY: plain property getter.
        unsafe { calendar.title() }.to_string()
    }

    fn lists(store: &EKEventStore, kind: EKEntityType) -> Vec<Retained<EKCalendar>> {
        // SAFETY: plain method with an enum argument.
        unsafe { store.calendarsForEntityType(kind) }.to_vec()
    }

    /// `None` means "all calendars"; `Some(vec![])` means the filter matched nothing.
    fn pick(all: Vec<Retained<EKCalendar>>, names: &[String]) -> Option<Vec<Retained<EKCalendar>>> {
        if names.is_empty() {
            return None;
        }
        Some(
            all.into_iter()
                .filter(|c| names.contains(&calendar_title(c)))
                .collect(),
        )
    }

    fn read_calendars(store: &EKEventStore) -> CalendarLists {
        let (events_access, reminders_access) = authorization();
        let describe = |kind| {
            let mut out: Vec<CalendarInfo> = lists(store, kind)
                .iter()
                .map(|c| CalendarInfo {
                    title: calendar_title(c),
                    // SAFETY: plain property getters.
                    account: unsafe { c.source() }
                        .map(|s| unsafe { s.title() }.to_string())
                        .unwrap_or_default(),
                })
                .collect();
            out.sort_by(|a, b| a.title.cmp(&b.title).then(a.account.cmp(&b.account)));
            out
        };
        CalendarLists {
            events: if events_access == Access::FullAccess {
                describe(EKEntityType::Event)
            } else {
                Vec::new()
            },
            reminders: if reminders_access == Access::FullAccess {
                describe(EKEntityType::Reminder)
            } else {
                Vec::new()
            },
        }
    }

    fn read_items(store: &EKEventStore, query: &Query) -> Result<Vec<Item>, String> {
        let (events_access, reminders_access) = authorization();
        let mut out = Vec::new();
        if events_access == Access::FullAccess {
            out.extend(read_events(store, query));
        }
        if query.include_reminders && reminders_access == Access::FullAccess {
            out.extend(read_reminders(store, query)?);
        }
        Ok(out)
    }

    fn read_events(store: &EKEventStore, query: &Query) -> Vec<Item> {
        let Some(calendars) = filtered(lists(store, EKEntityType::Event), &query.calendars) else {
            return Vec::new();
        };
        let start = ns_date(query.from_ms);
        let end = ns_date(query.to_ms);
        // SAFETY: the predicate comes from this store and is used with the same store.
        let events = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(
                &start,
                &end,
                calendars.as_deref(),
            );
            store.eventsMatchingPredicate(&predicate)
        };
        events.to_vec().iter().map(|e| event_item(e)).collect()
    }

    /// Resolves name filters into an array to hand to EventKit. `None` result: nothing can match.
    fn filtered(
        all: Vec<Retained<EKCalendar>>,
        names: &[String],
    ) -> Option<Option<Retained<NSArray<EKCalendar>>>> {
        match pick(all, names) {
            None => Some(None),
            Some(chosen) if chosen.is_empty() => None,
            Some(chosen) => Some(Some(NSArray::from_retained_slice(&chosen))),
        }
    }

    fn event_item(event: &EKEvent) -> Item {
        // SAFETY: plain property getters on a live event.
        unsafe {
            let start = millis(&event.startDate());
            let id = event
                .eventIdentifier()
                .map(|s| s.to_string())
                .unwrap_or_default();
            Item {
                id: format!("{id}:{start}"),
                title: event.title().to_string(),
                date: start,
                end: Some(millis(&event.endDate())),
                all_day: event.isAllDay(),
                source: event
                    .calendar()
                    .map(|c| calendar_title(&c))
                    .unwrap_or_default(),
                is_reminder: false,
            }
        }
    }

    fn read_reminders(store: &EKEventStore, query: &Query) -> Result<Vec<Item>, String> {
        let Some(calendars) = filtered(lists(store, EKEntityType::Reminder), &query.reminder_lists)
        else {
            return Ok(Vec::new());
        };
        let start = ns_date(query.reminders_from_ms);
        let end = ns_date(query.to_ms);
        let (tx, rx) = mpsc::channel::<Vec<Item>>();
        let block: RcBlock<dyn Fn(*mut NSArray<EKReminder>)> =
            RcBlock::new(move |reminders: *mut NSArray<EKReminder>| {
                let items = if reminders.is_null() {
                    Vec::new()
                } else {
                    // SAFETY: EventKit passes a valid array for the duration of the block.
                    unsafe { &*reminders }
                        .to_vec()
                        .iter()
                        .filter_map(|r| reminder_item(r))
                        .collect()
                };
                let _ = tx.send(items);
            });
        // SAFETY: predicate and store match; the block lives until the call returns and is copied.
        let token = unsafe {
            let predicate = store
                .predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(
                    Some(&start),
                    Some(&end),
                    calendars.as_deref(),
                );
            store.fetchRemindersMatchingPredicate_completion(&predicate, &block)
        };
        match rx.recv_timeout(FETCH_TIMEOUT) {
            Ok(items) => Ok(items),
            Err(_) => {
                // SAFETY: `token` is the value returned by the fetch above.
                unsafe { store.cancelFetchRequest(&token) };
                Err("Reminders did not answer in time".into())
            }
        }
    }

    fn reminder_item(reminder: &EKReminder) -> Option<Item> {
        // SAFETY: plain property getters on a live reminder.
        unsafe {
            let components = reminder.dueDateComponents()?;
            let date = NSCalendar::currentCalendar().dateFromComponents(&components)?;
            let ms = millis(&date);
            Some(Item {
                id: format!("{}:{ms}", reminder.calendarItemIdentifier()),
                title: reminder.title().to_string(),
                date: ms,
                end: None,
                // A due date with no hour is a "day" reminder, like the phone's dueDateIncludesTime.
                all_day: components.hour() == NSDateComponentUndefined,
                source: reminder
                    .calendar()
                    .map(|c| calendar_title(&c))
                    .unwrap_or_default(),
                is_reminder: true,
            })
        }
    }
}
