// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: magic;
// Multi-Task Daily Log Widget (Scriptable)
// GitHub-style heatmap: each square's brightness = how many of your tasks
// you finished that day. Tap the widget (or run in the app) to check tasks off.

// ================= SETTINGS =================
// Start date comes first. Format: YYYY-MM-DD
const START_DATE = "2026-10-30";
// Optional end date. Leave "" for a rolling window of recent days.
const END_DATE = "";
const TITLE = "Daily Tasks";

// Your daily tasks. Use as many or as few as you like, for anything.
// e.g. ["Watch video", "Review", "Take notes"]
const TASKS = ["Coursework", "Live Trading", "Trade Review", "Apostles work"];
// How many tasks must be done for a day to count as "completed".
// TASKS.length = all of them. Set a number (e.g. 1) to be more lenient.
const DAY_COMPLETE_MIN = 1;

// Look
const BG_COLOR = "#0d1117";
const TEXT_COLOR = "#ffffff";
const DONE_COLOR = "#39d353";    // every task done (green)
// Partial days fade from the first color (few tasks done) to the last (almost done).
// 4 tasks: 1 = red, 2 = orange, 3 = yellow, 4 = green. Other counts spread evenly.
const PARTIAL_COLORS = ["#ff5c5c", "#ff9f43", "#f2cc60"];  // red, orange, yellow
const EMPTY_COLOR = "#ffffff";   // days with nothing done (drawn dim)
const EMPTY_OPACITY = 0.05;
const MIN_DONE_OPACITY = 0.3;    // brightness when only a little is done (full day = 1.0)
const FUTURE_OPACITY = 0.12;     // days not reached yet (same grey as the days-left widget)

// Layout
const ROWS = 7;
const MAX_CELL_SIZE = 10;
const PADDING = 2;
const BORDER_RADIUS = 2;
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 354;          // medium widget width in points; adjust if the grid does not reach the right edge
// ============================================

const LOG_ID = args.widgetParameter || TITLE; // widget parameter = separate log
const fm = FileManager.local();
const logPath = fm.joinPath(
  fm.documentsDirectory(),
  "daily-log-" + LOG_ID.replace(/[^a-z0-9]/gi, "_") + ".json"
);

const MENLO_REGULAR = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

// ---------- helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function key(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseKey(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }

// Log format: { "2026-10-05": ["Course 1", "Course 3"], ... }
function loadLog() {
  if (!fm.fileExists(logPath)) return {};
  try {
    const raw = JSON.parse(fm.readString(logPath));
    if (Array.isArray(raw)) {          // old format: list of fully-done days
      const out = {};
      raw.forEach(k => out[k] = TASKS.slice());
      return out;
    }
    return raw;
  } catch (e) { return {}; }
}
function saveLog(log) { fm.writeString(logPath, JSON.stringify(log)); }

// Only count tasks that still exist in TASKS
function doneOn(log, k) {
  return (log[k] || []).filter(t => TASKS.includes(t));
}

// ---------- day colors ----------
function hexToRgb(h) {
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex(rgb) {
  return "#" + rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function blend(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
// n = tasks done that day (1 or more)
function dayColor(n) {
  const total = TASKS.length;
  if (n >= total) return DONE_COLOR;
  // position along the partial colors: first step = start, last step = end
  const t = total === 2 ? 0.5 : (n - 1) / (total - 2);
  const segs = PARTIAL_COLORS.length - 1;
  const pos = Math.min(segs, Math.max(0, t * segs));
  const i = Math.min(segs - 1, Math.floor(pos));
  return blend(PARTIAL_COLORS[i], PARTIAL_COLORS[i + 1], pos - i);
}

// ---------- stats ----------
function getStats(log) {
  const start = parseKey(START_DATE);
  const end = END_DATE ? parseKey(END_DATE) : null;
  const today = startOfDay(new Date());

  let elapsed = Math.max(0, daysBetween(today, start) + 1); // includes today
  const total = end ? daysBetween(end, start) + 1 : null;
  if (total !== null) elapsed = Math.min(elapsed, total);

  let completedDays = 0;
  for (const k of Object.keys(log)) {
    const d = parseKey(k);
    if (d < start || d > today || (end && d > end)) continue;
    if (doneOn(log, k).length >= DAY_COMPLETE_MIN) completedDays++;
  }

  return {
    start, end, today, total, elapsed, completedDays,
    missedDays: Math.max(0, elapsed - completedDays),
    todayDone: doneOn(log, key(today)).length,
    daysLeft: end ? Math.max(0, daysBetween(end, today)) : null
  };
}

// ---------- widget ----------
async function createWidget() {
  const log = loadLog();
  const s = getStats(log);

  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);

  let cols, gridStart, cellSize = MAX_CELL_SIZE;
  if (s.end) {
    cols = Math.ceil(s.total / ROWS);
    gridStart = s.start;
    const avail = WIDGET_WIDTH - 2 * SIDE_PADDING;
    cellSize = Math.max(3, Math.min(MAX_CELL_SIZE,
      Math.floor((avail - (cols - 1) * PADDING) / cols)));
  } else {
    // fill the full width with blocks so the row ends where it starts
    const avail = WIDGET_WIDTH - 2 * SIDE_PADDING;
    cols = Math.max(1, Math.round((avail + PADDING) / (MAX_CELL_SIZE + PADDING)));
    cellSize = (avail - (cols - 1) * PADDING) / cols;
    const capacity = cols * ROWS;
    // newest day sits in the bottom-right corner; earlier days (including ones before your
    // start date) are grey blocks
    gridStart = addDays(s.today, -(capacity - 1));
  }

  for (let row = 0; row < ROWS; row++) {
    const rowStack = widget.addStack();
    rowStack.spacing = PADDING;
    rowStack.layoutHorizontally();

    for (let col = 0; col < cols; col++) {
      const date = addDays(gridStart, col * ROWS + row);
      const cell = rowStack.addStack();
      cell.size = new Size(cellSize, cellSize);
      cell.cornerRadius = BORDER_RADIUS;

      if (s.end && (date < s.start || date > s.end)) continue;   // blank outside the range in end-date mode

      const n = doneOn(log, key(date)).length;
      if (n > 0) {
        const frac = n / TASKS.length;
        const opacity = MIN_DONE_OPACITY + frac * (1 - MIN_DONE_OPACITY);
        cell.backgroundColor = new Color(dayColor(n), Math.min(1, opacity));
      } else if (date > s.today) {
        cell.backgroundColor = new Color(EMPTY_COLOR, FUTURE_OPACITY);
      } else {
        cell.backgroundColor = new Color(EMPTY_COLOR, EMPTY_OPACITY);
      }
    }
    if (row < ROWS - 1) widget.addSpacer(PADDING);
  }

  widget.addSpacer(8);

  // Footer: title left, completed days / days elapsed right
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();

  const titleText = footer.addText(TITLE);
  titleText.font = MENLO_BOLD;
  titleText.textColor = new Color(TEXT_COLOR);
  titleText.lineLimit = 1;

  footer.addSpacer();

  const countText = footer.addText(`${s.completedDays}/${s.elapsed}`);
  countText.font = MENLO_BOLD;
  countText.textColor = new Color(DONE_COLOR);

  const pct = s.elapsed > 0 ? Math.round((s.completedDays / s.elapsed) * 100) : 0;
  let subStr = `Today ${s.todayDone}/${TASKS.length}  •  ${pct}%  •  ${s.missedDays} missed`;
  if (s.end) subStr += `  •  ${s.daysLeft}d left`;
  const sub = widget.addText(subStr);
  sub.font = MENLO_REGULAR;
  sub.textColor = new Color(TEXT_COLOR, 0.5);
  sub.lineLimit = 1;

  return widget;
}

// ---------- checklist for one day ----------
async function editDay(log, k) {
  const table = new UITable();
  table.showSeparators = true;

  const render = () => {
    table.removeAllRows();
    const done = new Set(log[k] || []);

    const head = new UITableRow();
    head.isHeader = true;
    head.addText(`${TITLE}  •  ${k}`, `${done.size}/${TASKS.length} done`);
    table.addRow(head);

    for (const t of TASKS) {
      const row = new UITableRow();
      row.height = 52;
      row.dismissOnSelect = false;
      const cell = row.addText((done.has(t) ? "✅  " : "⬜️  ") + t);
      cell.titleFont = Font.systemFont(18);
      row.onSelect = () => {
        const set = new Set(log[k] || []);
        set.has(t) ? set.delete(t) : set.add(t);
        if (set.size === 0) delete log[k]; else log[k] = [...set];
        saveLog(log);
        render();
        table.reload();
      };
      table.addRow(row);
    }
  };

  render();
  await table.present(false);
}

// ---------- in-app menu (runs when you tap the widget) ----------
async function showMenu() {
  const log = loadLog();
  const s = getStats(log);

  const menu = new Alert();
  menu.title = TITLE;
  menu.message = `Today ${s.todayDone}/${TASKS.length} • ${s.completedDays}/${s.elapsed} days completed`;
  menu.addAction("Update today");
  menu.addAction("Edit a past day");
  menu.addAction("Preview widget");
  menu.addCancelAction("Close");

  const choice = await menu.presentSheet();

  if (choice === 0) {
    await editDay(log, key(new Date()));
  } else if (choice === 1) {
    const input = new Alert();
    input.title = "Edit a past day";
    input.message = "Enter date as YYYY-MM-DD";
    input.addTextField("YYYY-MM-DD", key(addDays(new Date(), -1)));
    input.addAction("Open");
    input.addCancelAction("Cancel");
    if ((await input.presentAlert()) === 0) {
      const k = input.textFieldValue(0).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
        await editDay(log, k);
      } else {
        const err = new Alert();
        err.title = "Invalid date";
        err.addAction("OK");
        await err.present();
      }
    }
  }

  if (choice === 0 || choice === 1 || choice === 2) {
    await (await createWidget()).presentMedium();
  }
}

// ---------- run ----------
if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else {
  await showMenu();
}
Script.complete();
