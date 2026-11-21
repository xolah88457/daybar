// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: magic;
// Multi-Task Daily Log Widget (Scriptable)
// GitHub-style heatmap: each square's brightness = how many of your tasks
// you finished that day. Tap the widget (or run in the app) to check tasks off.

// ---------- Daybar standalone boundary (kept inline: no imports) ----------
const DB = (() => {
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const integer = (x, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= lo && x <= hi;
  const number = (x, lo, hi) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  const name = x => typeof x === "string" && x.trim().length > 0 && x.trim().length <= 120;
  const date = x => {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    const [y,m,d] = x.split("-").map(Number), dt = new Date(y,m-1,d);
    return dt.getFullYear() === y && dt.getMonth() === m-1 && dt.getDate() === d;
  };
  const fields = (x, allowed, required = allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k)) && required.every(k => Object.prototype.hasOwnProperty.call(x,k));
  const record = (x, k, v) => object(x) && Object.entries(x).every(([a,b]) => k(a) && v(b));
  const names = x => Array.isArray(x) && x.every(name);
  function valid(kind,x) {
    if (kind === "log") return Array.isArray(x) ? x.every(date) : record(x,date,names);
    return false;
  }
  const clock = x => typeof x === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  const optionalDate = x => x === "" || date(x);
  const options = x => Array.isArray(x) && x.length > 0 && x.every(v => integer(v,1,240));
  const palette = x => typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);
  const rules = {
    countdown: {startDate:date,endDate:date,title:name},
    habits: {startDate:date,endDate:optionalDate,title:name,logId:x => typeof x === "string" && /^[a-zA-Z0-9_]+$/.test(x),tasks:x => names(x) && x.length > 0 && new Set(x).size === x.length,archivedTasks:names,dayCompleteMin:x => integer(x,1),focusThresholds:x => record(x,name,v => integer(v,1,1440))},
    focus: {title:name,focusOptions:options,breakOptions:options,longBreakOptions:options,blockMinutes:x => integer(x,1,240),alerts:x => typeof x === "boolean"},
    sleep: {title:name,awakeHours:x => number(x,1,24),sleepHours:x => number(x,1,24),targetWake:clock,targetBed:x => x === "" || clock(x),stepMinutes:x => integer(x,1,240),averageDays:x => integer(x,1,365),bedtimeAlerts:x => typeof x === "boolean",routineMinutes:x => integer(x,0,1440),noPhoneMinutes:x => integer(x,0,1440)},
    appearance: {background:palette,text:palette,green:palette,blue:palette,red:palette,orange:palette,yellow:palette,emptyOpacity:x => number(x,0,1),minDoneOpacity:x => number(x,0,1),futureOpacity:x => number(x,0,1),rows:x => x === 7,cellSize:x => number(x,3,30),gap:x => number(x,0,10),radius:x => number(x,0,10)}
  };
  function validateSettings(s) {
    if (!fields(s,["schemaVersion",...Object.keys(rules)],[]) || (s.schemaVersion !== undefined && s.schemaVersion !== 1)) throw new Error("Unknown Daybar settings format");
    for (const [section,rule] of Object.entries(rules)) {
      if (s[section] === undefined) continue;
      if (!fields(s[section],Object.keys(rule),[]) || !Object.entries(s[section]).every(([k,v]) => rule[k](v))) throw new Error("Invalid Daybar settings: " + section);
    }
    const c = {startDate:"2026-09-09",endDate:"2027-05-24",...s.countdown};
    const h = {startDate:"2026-10-30",endDate:"",tasks:["Coursework","Live Trading","Trade Review","Apostles work"],dayCompleteMin:1,...s.habits};
    const sl = {routineMinutes:120,noPhoneMinutes:60,...s.sleep};
    if (c.endDate < c.startDate || (h.endDate && h.endDate < h.startDate) || h.dayCompleteMin > h.tasks.length || sl.noPhoneMinutes > sl.routineMinutes) throw new Error("Inconsistent Daybar settings");
    return s;
  }
  const fm = FileManager.iCloud(), local = FileManager.local();
  const path = name => fm.joinPath(fm.documentsDirectory(),name);
  const exists = p => fm.fileExists(p) || fm.fileExists(fm.joinPath(fm.documentsDirectory(),"." + p.split("/").pop() + ".icloud"));
  // Detect interrupted write artifacts (.daybar-backup-* / .daybar-temp-*) for THIS exact canonical name.
  // Includes evicted placeholders (.name.daybar-backup-TOKEN.icloud). Excludes ONLY our exact live temp file.
  async function checkInterrupted(p, excludeTempToken) {
    const base = p.split("/").pop();
    const dir = fm.documentsDirectory();
    let contents;
    try { contents = await fm.listContents(dir); } catch (e) { throw new Error("Cannot list iCloud directory to check for interrupted writes: " + e); }
    const backupPrefix = base + ".daybar-backup-";
    const tempPrefix = base + ".daybar-temp-";
    const evictedBackupPrefix = "." + base + ".daybar-backup-";
    const evictedTempPrefix = "." + base + ".daybar-temp-";
    const found = [];
    for (const f of contents) {
      const isBackup = f.startsWith(backupPrefix) || (f.startsWith(evictedBackupPrefix) && f.endsWith(".icloud"));
      const isTemp = f.startsWith(tempPrefix) || (f.startsWith(evictedTempPrefix) && f.endsWith(".icloud"));
      const isOwnTemp = excludeTempToken && isTemp && (f === tempPrefix + excludeTempToken || f === evictedTempPrefix + excludeTempToken + ".icloud");
      if (isBackup || (isTemp && !isOwnTemp)) found.push(f);
    }
    if (!found.length) return null;
    return "Unrecovered interrupted write for " + base + "; recovery files: " + found.join(", ") + ". Restore from backup before retrying.";
  }
  async function text(p) {
    if (!exists(p)) return null;
    if (!fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
    if (!fm.fileExists(p)) throw new Error("iCloud file unavailable: " + p);
    return fm.readString(p);
  }
  async function settings() {
    const p = path("daybar-settings.json");
    const raw = await text(p);
    if (raw === null) {
      // Before returning empty settings: refuse if interrupted artifacts exist.
      const interrupted = await checkInterrupted(p);
      if (interrupted) throw new Error(interrupted);
    }
    return raw === null ? {} : validateSettings(JSON.parse(raw));
  }
  function check(kind,value) {
    if (!valid(kind,value)) throw new Error("Invalid/unknown " + kind + " file; original preserved");
    return value;
  }
  async function read(name,kind,empty) {
    const p = path(name);
    let raw = await text(p);
    if (raw === null) {
      // Before local migration or default: refuse if interrupted artifacts exist.
      const interrupted = await checkInterrupted(p);
      if (interrupted) throw new Error(interrupted);
      const old = local.joinPath(local.documentsDirectory(),name);
      if (local.fileExists(old)) {
        raw = local.readString(old);
        check(kind,JSON.parse(raw));
        // Recheck both the canonical and evicted placeholder before migrating.
        if (!exists(p)) await commit(name,kind,JSON.parse(raw),null);
        raw = await text(p);
      }
    }
    return {value:raw === null ? empty() : check(kind,JSON.parse(raw)),raw};
  }
  async function commit(name,kind,value,expected) {
    check(kind,value);
    const p = path(name), token = Date.now() + "-" + Math.random().toString(36).slice(2);
    const temp = p + ".daybar-temp-" + token, backup = p + ".daybar-backup-" + token;
    const serialized = JSON.stringify(value);
    fm.writeString(temp,serialized);
    if (await text(p) !== expected) { fm.remove(temp); throw new Error("File changed during edit; retry operation"); }
    // Recheck for pre-existing interrupted artifacts (not our own temp) before creating canonical.
    if (expected === null) {
      const interrupted = await checkInterrupted(p, token);
      if (interrupted) { fm.remove(temp); throw new Error(interrupted); }
    }
    // Scriptable has no replace/CAS. Keep the real original until the new move succeeds.
    let movedOriginal = false;
    try {
      if (exists(p)) {
        if (expected === null) throw new Error("Cloud file appeared; migration/create cancelled");
        fm.move(p,backup); movedOriginal = true;
      }
      fm.move(temp,p);
    } catch (error) {
      if (movedOriginal && !exists(p)) {
        try { fm.copy(backup,p); } catch (_) { /* backup remains available for recovery */ }
      }
      throw new Error("Write failed; original retained at " + (movedOriginal ? backup : p) + ": " + error);
    }
    if (movedOriginal) fm.remove(backup);
    return value;
  }
  async function mutate(name,kind,empty,operation) {
    const latest = await read(name,kind,empty);
    const value = check(kind,await operation(latest.value));
    // Reasserting an earned task or replaying a settled session need not churn iCloud.
    if (JSON.stringify(value) === latest.raw) return value;
    return commit(name,kind,value,latest.raw);
  }
  return {settings,read,mutate,date};
})();
const shared = await DB.settings();
const setting = (section,key,fallback) => shared[section]?.[key] ?? fallback;
// ---------- End Daybar boundary ----------

// ================= SETTINGS =================
// Start date comes first. Format: YYYY-MM-DD
const START_DATE = setting("habits", "startDate", "2026-10-30");
// Optional end date. Leave "" for a rolling window of recent days.
const END_DATE = setting("habits", "endDate", "");
const TITLE = setting("habits", "title", "Daily Tasks");

// Your daily tasks. Use as many or as few as you like, for anything.
// e.g. ["Watch video", "Review", "Take notes"]
const TASKS = setting("habits", "tasks", ["Coursework", "Live Trading", "Trade Review", "Apostles work"]);
// How many tasks must be done for a day to count as "completed".
// TASKS.length = all of them. Set a number (e.g. 1) to be more lenient.
const DAY_COMPLETE_MIN = setting("habits", "dayCompleteMin", 1);

// Appearance, like Daybar's: "night" (the default), "day", or "auto" to follow the iPhone's light/dark mode.
const THEME = "night";

// Look
const BG_COLOR = setting("appearance", "background", "#0d1117");
const TEXT_COLOR = setting("appearance", "text", "#ffffff");
const DONE_COLOR = setting("appearance", "green", "#39d353");    // every task done (green)
// Partial days fade from the first color (few tasks done) to the last (almost done).
// 4 tasks: 1 = red, 2 = orange, 3 = yellow, 4 = green. Other counts spread evenly.
const PARTIAL_COLORS = [setting("appearance", "red", "#ff5c5c"), setting("appearance", "orange", "#ff9f43"), setting("appearance", "yellow", "#f2cc60")];  // red, orange, yellow
const EMPTY_COLOR = setting("appearance", "text", "#ffffff");   // days with nothing done (drawn dim)
const EMPTY_OPACITY = setting("appearance", "emptyOpacity", 0.05);
const MIN_DONE_OPACITY = setting("appearance", "minDoneOpacity", 0.3);    // brightness when only a little is done (full day = 1.0)
const FUTURE_OPACITY = setting("appearance", "futureOpacity", 0.12);     // days not reached yet (same grey as the days-left widget)

// Layout
const ROWS = setting("appearance", "rows", 7);
const MAX_CELL_SIZE = setting("appearance", "cellSize", 10);
const PADDING = setting("appearance", "gap", 2);
const BORDER_RADIUS = setting("appearance", "radius", 2);
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 354;          // medium widget width in points; adjust if the grid does not reach the right edge
const LARGE_TASKS = 8;             // tasks listed under the grid on a large widget
const SMALL_TASKS = 4;             // tasks listed on a small widget
// ============================================

const LOG_ID = args.widgetParameter || setting("habits", "logId", "Daily_Tasks"); // widget parameter = separate log

const MENLO_REGULAR = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

// Daybar's Day palette. Colors you changed in the shared settings stay as you set them.
const DAY = {"#0d1117":"#f4f3ed","#ffffff":"#202820","#39d353":"#18764b","#58a6ff":"#286a9f","#ff5c5c":"#b43737","#ff9f43":"#a65410","#f2cc60":"#80620b"};
const dayHex = hex => DAY[hex.toLowerCase()] || hex;
function C(hex, alpha = 1, light = dayHex(hex)) {
  const night = new Color(hex, alpha);
  if (THEME === "night") return night;
  const day = new Color(light, alpha);
  return THEME === "day" ? day : Color.dynamic(day, night);
}
// Tapping the widget runs this script (whatever you named it) straight into today's checklist.
function runURL(action) {
  return "scriptable:///run/" + encodeURIComponent(Script.name()) + "?action=" + action +
    (args.widgetParameter ? "&log=" + encodeURIComponent(args.widgetParameter) : "");
}

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
// A tap from a widget with a separate log carries that log's id.
const ACTIVE_LOG = (config.runsInWidget ? null : args.queryParameters?.log) || LOG_ID;
const logFile = "daily-log-" + ACTIVE_LOG.replace(/[^a-z0-9]/gi, "_") + ".json";
function normalizeLog(raw) {
  return Array.isArray(raw) ? Object.fromEntries(raw.map(k => [k, TASKS.slice()])) : raw;
}
async function loadLog() {
  return normalizeLog((await DB.read(logFile, "log", () => ({}))).value);
}
async function setTask(k, task, completed) {
  if (!DB.date(k) || !TASKS.includes(task) || typeof completed !== "boolean") throw new Error("Invalid task edit");
  return DB.mutate(logFile, "log", () => ({}), raw => {
    const log = normalizeLog(raw), done = new Set(log[k] || []);
    completed ? done.add(task) : done.delete(task);
    if (done.size) log[k] = [...done]; else delete log[k];
    return log;
  });
}

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
// n = tasks done that day (1 or more); colors = DONE_COLOR then the partial colors
function dayColor(n, done = DONE_COLOR, partial = PARTIAL_COLORS) {
  const total = TASKS.length;
  if (n >= total) return done;
  // position along the partial colors: first step = start, last step = end
  const t = total === 2 ? 0.5 : (n - 1) / (total - 2);
  const segs = partial.length - 1;
  const pos = Math.min(segs, Math.max(0, t * segs));
  const i = Math.min(segs - 1, Math.floor(pos));
  return blend(partial[i], partial[i + 1], pos - i);
}
function dayCellColor(n, opacity) {
  return C(dayColor(n), opacity, dayColor(n, dayHex(DONE_COLOR), PARTIAL_COLORS.map(dayHex)));
}

// ---------- stats ----------
// Same rules as Daybar: a day counts when DAY_COMPLETE_MIN tasks are done, and an unfinished
// today does not break yesterday's streak until the day is over.
function getStats(log) {
  const start = parseKey(START_DATE);
  const end = END_DATE ? parseKey(END_DATE) : null;
  const today = startOfDay(new Date());

  let elapsed = Math.max(0, daysBetween(today, start) + 1); // includes today
  const total = end ? daysBetween(end, start) + 1 : null;
  if (total !== null) elapsed = Math.min(elapsed, total);

  let completedDays = 0, longestStreak = 0, run = 0;
  const complete = d => doneOn(log, key(d)).length >= DAY_COMPLETE_MIN;
  for (let i = 0; i < elapsed; i++) {
    if (complete(addDays(start, i))) { completedDays++; run++; longestStreak = Math.max(longestStreak, run); }
    else run = 0;
  }
  let currentStreak = run;
  if (elapsed > 0 && key(addDays(start, elapsed - 1)) === key(today) && !complete(today)) {
    currentStreak = 0;
    for (let i = elapsed - 2; i >= 0 && complete(addDays(start, i)); i--) currentStreak++;
  }

  return {
    start, end, today, total, elapsed, completedDays, currentStreak, longestStreak,
    missedDays: Math.max(0, elapsed - completedDays),
    todayDone: doneOn(log, key(today)).length,
    daysLeft: end ? Math.max(0, daysBetween(end, today)) : null
  };
}

// ---------- widget ----------
function header(stack, s) {
  const titleText = stack.addText(TITLE);
  titleText.font = MENLO_BOLD;
  titleText.textColor = C(TEXT_COLOR);
  titleText.lineLimit = 1;
}
// One task line: a colored square (done) or a dim one, then the name.
function taskLine(widget, task, done, font) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const box = row.addStack();
  box.size = new Size(8, 8);
  box.cornerRadius = BORDER_RADIUS;
  box.backgroundColor = done ? C(DONE_COLOR) : C(EMPTY_COLOR, FUTURE_OPACITY);
  row.addSpacer(6);
  const t = row.addText(task);
  t.font = font;
  t.textColor = C(TEXT_COLOR, done ? 0.45 : 0.9);
  t.lineLimit = 1;
  return row;
}

function smallWidget(widget, log, s) {
  const done = new Set(doneOn(log, key(s.today)));
  header(widget, s);
  widget.addSpacer(2);
  const count = widget.addText(`${s.todayDone}/${TASKS.length}`);
  count.font = new Font("Menlo-Bold", 26);
  count.textColor = s.todayDone >= TASKS.length ? C(DONE_COLOR) : s.todayDone ? dayCellColor(s.todayDone, 1) : C(TEXT_COLOR, 0.35);
  widget.addSpacer(4);
  for (const t of TASKS.slice(0, SMALL_TASKS)) { taskLine(widget, t, done.has(t), new Font("Menlo", 10)); widget.addSpacer(2); }
  if (TASKS.length > SMALL_TASKS) {
    const more = widget.addText(`+${TASKS.length - SMALL_TASKS} more`);
    more.font = new Font("Menlo", 9);
    more.textColor = C(TEXT_COLOR, 0.4);
  }
  widget.addSpacer();
  const streak = widget.addText(`${s.currentStreak}d streak`);
  streak.font = new Font("Menlo-Bold", 10);
  streak.textColor = C(s.currentStreak ? DONE_COLOR : TEXT_COLOR, s.currentStreak ? 1 : 0.4);
  return widget;
}

async function createWidget(family = config.widgetFamily) {
  const log = await loadLog();
  const s = getStats(log);

  const widget = new ListWidget();
  widget.backgroundColor = C(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.url = runURL("today");
  if (family === "small") return smallWidget(widget, log, s);

  const avail = WIDGET_WIDTH - 2 * SIDE_PADDING;
  let cols, gridStart, cellSize;
  if (s.end) {
    cols = Math.ceil(s.total / ROWS);
    gridStart = s.start;
    cellSize = Math.max(3, Math.min(MAX_CELL_SIZE,
      Math.floor((avail - (cols - 1) * PADDING) / cols)));
  } else {
    // fill the full width with blocks so the row ends where it starts
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
        cell.backgroundColor = dayCellColor(n, Math.min(1, opacity));
      } else if (date > s.today) {
        cell.backgroundColor = C(EMPTY_COLOR, FUTURE_OPACITY);
      } else {
        cell.backgroundColor = C(EMPTY_COLOR, EMPTY_OPACITY);
      }
    }
    if (row < ROWS - 1) widget.addSpacer(PADDING);
  }

  widget.addSpacer(8);

  // Footer: title left, completed days / days elapsed right
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();
  header(footer, s);
  footer.addSpacer();

  const countText = footer.addText(`${s.completedDays}/${s.elapsed}`);
  countText.font = MENLO_BOLD;
  countText.textColor = C(DONE_COLOR);

  const pct = s.elapsed > 0 ? Math.round((s.completedDays / s.elapsed) * 100) : 0;
  let subStr = `Today ${s.todayDone}/${TASKS.length}  •  ${s.currentStreak}d streak  •  ${pct}%`;
  subStr += s.end ? `  •  ${s.daysLeft}d left` : `  •  ${s.missedDays} missed`;
  const sub = widget.addText(subStr);
  sub.font = MENLO_REGULAR;
  sub.textColor = C(TEXT_COLOR, 0.5);
  sub.lineLimit = 1;

  if (family === "large") {
    // Today's checklist under the grid; tapping anywhere opens it to tick tasks off.
    widget.addSpacer(12);
    const done = new Set(doneOn(log, key(s.today)));
    for (const t of TASKS.slice(0, LARGE_TASKS)) { taskLine(widget, t, done.has(t), MENLO_REGULAR); widget.addSpacer(5); }
    if (TASKS.length > LARGE_TASKS) {
      const more = widget.addText(`+${TASKS.length - LARGE_TASKS} more`);
      more.font = MENLO_REGULAR;
      more.textColor = C(TEXT_COLOR, 0.4);
    }
    widget.addSpacer();
    const best = widget.addText(`Best streak ${s.longestStreak}d  •  ${s.completedDays} days completed`);
    best.font = MENLO_REGULAR;
    best.textColor = C(TEXT_COLOR, 0.5);
    best.lineLimit = 1;
  }

  return widget;
}

// ---------- checklist for one day ----------
async function editDay(log, k) {
  const table = new UITable();
  table.showSeparators = true;
  const isToday = k === key(new Date());

  const render = () => {
    table.removeAllRows();
    const done = new Set(doneOn(log, k));

    const head = new UITableRow();
    head.isHeader = true;
    head.addText(`${TITLE}  •  ${isToday ? "Today" : k}`, `${done.size}/${TASKS.length} done`);
    table.addRow(head);

    for (const t of TASKS) {
      const row = new UITableRow();
      row.height = 52;
      row.dismissOnSelect = false;
      const cell = row.addText((done.has(t) ? "✅  " : "⬜️  ") + t);
      cell.titleFont = Font.systemFont(18);
      row.onSelect = async () => {
        log = await setTask(k, t, !done.has(t));
        render();
        table.reload();
      };
      table.addRow(row);
    }

    if (isToday) {
      const s = getStats(log);
      const foot = new UITableRow();
      foot.height = 60;
      const allDone = done.size >= TASKS.length;
      const counts = done.size >= DAY_COMPLETE_MIN;
      const text = foot.addText(allDone ? "All done today" : counts ? "Today counts" : `${DAY_COMPLETE_MIN - done.size} more to count today`,
        `Streak ${s.currentStreak}d  •  best ${s.longestStreak}d`);
      text.titleColor = counts ? C(DONE_COLOR) : C(TEXT_COLOR, 0.6);
      table.addRow(foot);
    }
  };

  render();
  await table.present(false);
}

// ---------- in-app menu (runs when you tap the widget) ----------
async function showMenu() {
  const log = await loadLog();
  const s = getStats(log);

  const menu = new Alert();
  menu.title = TITLE;
  menu.message = `Today ${s.todayDone}/${TASKS.length} • ${s.currentStreak}d streak • ${s.completedDays}/${s.elapsed} days completed`;
  menu.addAction("Update today");
  menu.addAction("Edit yesterday");
  menu.addAction("Edit another day");
  menu.addAction("Preview widget");
  menu.addCancelAction("Close");

  const choice = await menu.presentSheet();

  if (choice === 0) {
    await editDay(log, key(new Date()));
  } else if (choice === 1) {
    await editDay(log, key(addDays(new Date(), -1)));
  } else if (choice === 2) {
    const picker = new DatePicker();
    picker.initialDate = addDays(new Date(), -2);
    picker.maximumDate = new Date();
    const date = await picker.pickDate();
    if (date) await editDay(log, key(date));
  }

  if (choice >= 0 && choice <= 3) {
    await (await createWidget("medium")).presentMedium();
  }
}

// ---------- run ----------
if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else if (args.queryParameters?.action === "today") {
  // tapped the widget: straight to today's checklist
  await editDay(await loadLog(), key(new Date()));
} else {
  await showMenu();
}
Script.complete();
