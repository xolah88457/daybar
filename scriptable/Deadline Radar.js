// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: magic;
// Deadline Radar Widget (Scriptable)
// Shows your next few deadlines from your calendar (and optionally Reminders),
// colored by urgency. Tap the widget to see the full list.

// ================= SETTINGS =================
const TITLE = "Deadlines";
const MAX_ITEMS_MEDIUM = 3;         // deadlines shown on a medium widget
const MAX_ITEMS_LARGE = 7;          // deadlines shown on a large widget
const DAYS_AHEAD = 60;

// Calendar events
// Everything in these iCloud calendars is included. [] = all calendars.
// Delete a name from the list to leave that category out.
const CALENDAR_NAMES = [
  "Home", "Work", "School", "Errands", "Headspace",
  "Relationships", "Free time", "Night", "Gym"
];
// Optional filter: only keep events whose title contains one of these words.
// [] = keep every event from the calendars above.
const KEYWORDS = [];

// Reminders with due dates
const INCLUDE_REMINDERS = true;
const REMINDER_LISTS = [];          // e.g. ["School"]. [] = all lists
const OVERDUE_DAYS_BACK = 14;       // still show overdue reminders this far back

// Look
const BG_COLOR = "#0d1117";
const TEXT_COLOR = "#ffffff";
const RED = "#ff5c5c";
const ORANGE = "#ff9f43";
const YELLOW = "#f2cc60";
const GREEN = "#39d353";
const SIDE_PADDING = 12;
const SMALL_WIDTH = 150;            // small widget width in points

// Appearance, like Daybar's: "night" (the default), "day", or "auto" to follow the iPhone's light/dark mode.
const THEME = "night";
// ============================================

const MENLO = new Font("Menlo", 10);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

// Daybar's Day palette. Colors you changed above stay as you set them.
const DAY = {"#0d1117":"#f4f3ed","#ffffff":"#202820","#39d353":"#18764b","#58a6ff":"#286a9f","#ff5c5c":"#b43737","#ff9f43":"#a65410","#f2cc60":"#80620b"};
function C(hex, alpha = 1) {
  const night = new Color(hex, alpha);
  if (THEME === "night") return night;
  const day = new Color(DAY[hex.toLowerCase()] || hex, alpha);
  return THEME === "day" ? day : Color.dynamic(day, night);
}
// Tapping the widget runs this script (whatever you named it) and opens the full list.
function runURL(action) {
  return "scriptable:///run/" + encodeURIComponent(Script.name()) + (action ? "?action=" + action : "");
}
// Events open Calendar at their start time; reminders open Reminders.
function openURL(item) {
  return item.kind === "event"
    ? "calshow:" + Math.floor(item.date.getTime() / 1000 - 978307200)
    : "x-apple-reminderkit://";
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysUntil(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
// Days to count and color an item by: a multi-day event that already began but has not ended is
// happening now (0), never overdue. Reminders keep their overdue days.
function itemDays(item) {
  const days = daysUntil(item.date);
  const now = new Date();
  return days < 0 && item.kind === "event" && item.end && item.end > now && item.date <= now ? 0 : days;
}
function fmt(d, format) {
  const f = new DateFormatter();
  f.dateFormat = format;
  return f.string(d);
}
function urgencyColor(days) {
  if (days <= 0) return C(RED);
  if (days <= 2) return C(ORANGE);
  if (days <= 7) return C(YELLOW);
  return C(GREEN);
}
function label(item) {
  const days = itemDays(item);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0 && daysUntil(item.date) < 0) return item.allDay ? "Today" : "Now";
  if (days === 0) return item.allDay ? "Today" : `Today ${fmt(item.date, "h:mm a")}`;
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}
function byDate(a, b) {
  return a.date - b.date || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
}
function countText(items, short) {
  const overdue = items.filter(i => itemDays(i) < 0).length;
  if (short) return String(items.length);
  return overdue ? `${overdue} overdue \u2022 ${items.length - overdue} upcoming` : `${items.length} upcoming`;
}

async function getItems() {
  const now = new Date();
  const from = startOfDay(now);
  const to = addDays(from, DAYS_AHEAD);
  const items = [];

  let cals = await Calendar.forEvents();
  if (CALENDAR_NAMES.length) cals = cals.filter(c => CALENDAR_NAMES.includes(c.title));
  const events = await CalendarEvent.between(from, to, cals);
  for (const e of events) {
    if (!e.isAllDay && e.endDate < now) continue; // skip events already finished today
    if (e.startDate >= to) continue;               // starts at or after the horizon
    const t = e.title.toLowerCase();
    if (KEYWORDS.length && !KEYWORDS.some(k => t.includes(k))) continue;
    items.push({ title: e.title, date: e.startDate, end: e.endDate, allDay: e.isAllDay, source: e.calendar.title, kind: "event" });
  }

  if (INCLUDE_REMINDERS) {
    const earliest = addDays(from, -OVERDUE_DAYS_BACK);
    const reminders = await Reminder.allIncomplete();
    for (const r of reminders) {
      if (!r.dueDate) continue;
      if (REMINDER_LISTS.length && !REMINDER_LISTS.includes(r.calendar.title)) continue;
      if (r.dueDate < earliest || r.dueDate > to) continue;
      items.push({ title: r.title, date: r.dueDate, allDay: !r.dueDateIncludesTime, source: r.calendar.title, kind: "reminder" });
    }
  }

  return items.sort(byDate);
}

function smallWidget(widget, items) {
  const head = widget.addStack();
  head.layoutHorizontally();
  head.size = new Size(SMALL_WIDTH - 2 * SIDE_PADDING, 16);
  const title = head.addText(TITLE);
  title.font = MENLO_BOLD;
  title.textColor = C(TEXT_COLOR);
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;
  head.addSpacer();
  const count = head.addText(countText(items, true));
  count.font = MENLO;
  count.textColor = C(TEXT_COLOR, 0.5);
  widget.addSpacer(8);

  if (!items.length) {
    const t = widget.addText("Nothing due.");
    t.font = MENLO_BOLD;
    t.textColor = C(GREEN);
    return widget;
  }
  const item = items[0];
  const col = urgencyColor(itemDays(item));
  const lab = widget.addText(label(item));
  lab.font = new Font("Menlo-Bold", 18);
  lab.textColor = col;
  lab.lineLimit = 1;
  lab.minimumScaleFactor = 0.5;
  widget.addSpacer(4);
  const name = widget.addText(item.title);
  name.font = MENLO_BOLD;
  name.textColor = C(TEXT_COLOR);
  name.lineLimit = 2;
  name.minimumScaleFactor = 0.8;
  const dt = widget.addText(fmt(item.date, "EEE, MMM d"));
  dt.font = MENLO;
  dt.textColor = C(TEXT_COLOR, 0.45);
  dt.lineLimit = 1;
  widget.addSpacer();
  if (items.length > 1) {
    const more = widget.addText(`+${items.length - 1} more`);
    more.font = MENLO;
    more.textColor = C(TEXT_COLOR, 0.5);
    more.lineLimit = 1;
  }
  return widget;
}

async function createWidget(family = config.widgetFamily) {
  const items = await getItems();
  const maxItems = (family === "large" || family === "extraLarge") ? MAX_ITEMS_LARGE : MAX_ITEMS_MEDIUM;
  const widget = new ListWidget();
  widget.backgroundColor = C(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60000);
  widget.url = runURL();
  if (family === "small") return smallWidget(widget, items);

  const head = widget.addStack();
  head.layoutHorizontally();
  const title = head.addText(TITLE);
  title.font = MENLO_BOLD;
  title.textColor = C(TEXT_COLOR);
  title.lineLimit = 1;
  head.addSpacer();
  const count = head.addText(countText(items));
  count.font = MENLO;
  count.textColor = C(TEXT_COLOR, 0.5);
  count.lineLimit = 1;
  count.minimumScaleFactor = 0.7;

  widget.addSpacer(8);

  if (!items.length) {
    const t = widget.addText("Nothing due.");
    t.font = MENLO_BOLD;
    t.textColor = C(GREEN);
    return widget;
  }

  items.slice(0, maxItems).forEach((item, i) => {
    const col = urgencyColor(itemDays(item));

    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.url = openURL(item);

    const accent = row.addStack();
    accent.size = new Size(4, 30);
    accent.cornerRadius = 2;
    accent.backgroundColor = col;

    row.addSpacer(8);

    const left = row.addStack();
    left.layoutVertically();
    const name = left.addText(item.title);
    name.font = MENLO_BOLD;
    name.textColor = C(TEXT_COLOR);
    name.lineLimit = 1;
    const src = left.addText(item.source);
    src.font = MENLO;
    src.textColor = C(TEXT_COLOR, 0.45);
    src.lineLimit = 1;

    row.addSpacer();

    const right = row.addStack();
    right.layoutVertically();
    const lab = right.addText(label(item));
    lab.font = MENLO_BOLD;
    lab.textColor = col;
    lab.lineLimit = 1;
    lab.rightAlignText();
    const dt = right.addText(fmt(item.date, "EEE, MMM d"));
    dt.font = MENLO;
    dt.textColor = C(TEXT_COLOR, 0.45);
    dt.rightAlignText();

    if (i < Math.min(items.length, maxItems) - 1) widget.addSpacer(8);
  });

  return widget;
}

async function showList() {
  const items = await getItems();
  const table = new UITable();
  table.showSeparators = true;

  const head = new UITableRow();
  head.isHeader = true;
  head.addText(TITLE, countText(items));
  table.addRow(head);

  for (const item of items) {
    const row = new UITableRow();
    row.height = 56;
    row.addText(item.title, `${item.source} \u2022 ${fmt(item.date, "EEE, MMM d")}`).widthWeight = 70;
    const l = row.addText(label(item));
    l.rightAligned();
    l.titleColor = urgencyColor(itemDays(item));
    l.widthWeight = 30;
    row.onSelect = () => Safari.open(openURL(item));
    row.dismissOnSelect = false;
    table.addRow(row);
  }
  await table.present(false);
}

// ---------- run ----------
if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else {
  await showList();
}
Script.complete();
