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
// ============================================

const MENLO = new Font("Menlo", 10);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysUntil(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
function fmt(d, format) {
  const f = new DateFormatter();
  f.dateFormat = format;
  return f.string(d);
}
function urgencyColor(days) {
  if (days <= 0) return new Color(RED);
  if (days <= 2) return new Color(ORANGE);
  if (days <= 7) return new Color(YELLOW);
  return new Color(GREEN);
}
function label(item) {
  const days = daysUntil(item.date);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return item.allDay ? "Today" : `Today ${fmt(item.date, "h:mm a")}`;
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

async function getItems() {
  const now = new Date();
  const from = startOfDay(now);
  const to = new Date(from.getTime() + DAYS_AHEAD * 86400000);
  const items = [];

  let cals = await Calendar.forEvents();
  if (CALENDAR_NAMES.length) cals = cals.filter(c => CALENDAR_NAMES.includes(c.title));
  const events = await CalendarEvent.between(from, to, cals);
  for (const e of events) {
    if (!e.isAllDay && e.endDate < now) continue; // skip events already finished today
    const t = e.title.toLowerCase();
    if (KEYWORDS.length && !KEYWORDS.some(k => t.includes(k))) continue;
    items.push({ title: e.title, date: e.startDate, allDay: e.isAllDay, source: e.calendar.title });
  }

  if (INCLUDE_REMINDERS) {
    const earliest = new Date(from.getTime() - OVERDUE_DAYS_BACK * 86400000);
    const reminders = await Reminder.allIncomplete();
    for (const r of reminders) {
      if (!r.dueDate) continue;
      if (REMINDER_LISTS.length && !REMINDER_LISTS.includes(r.calendar.title)) continue;
      if (r.dueDate < earliest || r.dueDate > to) continue;
      items.push({ title: r.title, date: r.dueDate, allDay: !r.dueDateIncludesTime, source: r.calendar.title });
    }
  }

  return items.sort((a, b) => a.date - b.date);
}

async function createWidget() {
  const items = await getItems();
  const family = config.widgetFamily;
  const maxItems = (family === "large" || family === "extraLarge") ? MAX_ITEMS_LARGE : MAX_ITEMS_MEDIUM;
  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60000);

  const head = widget.addStack();
  head.layoutHorizontally();
  const title = head.addText(TITLE);
  title.font = MENLO_BOLD;
  title.textColor = new Color(TEXT_COLOR);
  head.addSpacer();
  const count = head.addText(`${items.length} upcoming`);
  count.font = MENLO;
  count.textColor = new Color(TEXT_COLOR, 0.5);

  widget.addSpacer(8);

  if (!items.length) {
    const t = widget.addText("Nothing due. Enjoy it.");
    t.font = MENLO_BOLD;
    t.textColor = new Color(GREEN);
    return widget;
  }

  items.slice(0, maxItems).forEach((item, i) => {
    const days = daysUntil(item.date);
    const col = urgencyColor(days);

    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const accent = row.addStack();
    accent.size = new Size(4, 30);
    accent.cornerRadius = 2;
    accent.backgroundColor = col;

    row.addSpacer(8);

    const left = row.addStack();
    left.layoutVertically();
    const name = left.addText(item.title);
    name.font = MENLO_BOLD;
    name.textColor = new Color(TEXT_COLOR);
    name.lineLimit = 1;
    const src = left.addText(item.source);
    src.font = MENLO;
    src.textColor = new Color(TEXT_COLOR, 0.45);
    src.lineLimit = 1;

    row.addSpacer();

    const right = row.addStack();
    right.layoutVertically();
    const lab = right.addText(label(item));
    lab.font = MENLO_BOLD;
    lab.textColor = col;
    lab.rightAlignText();
    const dt = right.addText(fmt(item.date, "EEE, MMM d"));
    dt.font = MENLO;
    dt.textColor = new Color(TEXT_COLOR, 0.45);
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
  head.addText(TITLE, `${items.length} upcoming`);
  table.addRow(head);

  for (const item of items) {
    const row = new UITableRow();
    row.height = 56;
    row.addText(item.title, `${item.source} • ${fmt(item.date, "EEE, MMM d")}`).widthWeight = 70;
    const l = row.addText(label(item));
    l.rightAligned();
    l.titleColor = urgencyColor(daysUntil(item.date));
    l.widthWeight = 30;
    table.addRow(row);
  }
  await table.present(false);
}

if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else {
  await showList();
}
Script.complete();
