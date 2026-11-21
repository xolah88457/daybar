// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: magic;
// Days Left Widget (Scriptable)
// GitHub-style grid counting down to an end date. Every square is one day.

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
  const fm = FileManager.iCloud();
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
  return {settings};
})();
const shared = await DB.settings();
const setting = (section,key,fallback) => shared[section]?.[key] ?? fallback;
// ---------- End Daybar boundary ----------

// ================= SETTINGS =================
// Dates in YYYY-MM-DD
const START_DATE = setting("countdown", "startDate", "2026-09-09");
const END_DATE = setting("countdown", "endDate", "2027-05-24");
const TITLE = setting("countdown", "title", "End of University");

// Appearance, like Daybar's: "night" (the default), "day", or "auto" to follow the iPhone's light/dark mode.
const THEME = "night";

// Look
const BG_COLOR = setting("appearance", "background", "#0d1117");
const TEXT_COLOR = setting("appearance", "text", "#ffffff");
const DONE_COLOR = setting("appearance", "green", "#39d353");    // days already passed
const TODAY_COLOR = setting("appearance", "text", "#ffffff");   // today (fades in over the 24h day)
const REMAINING_COLOR = setting("appearance", "text", "#ffffff");
const REMAINING_OPACITY = setting("appearance", "emptyOpacity", 0.05);  // days still to come

// Layout
const ROWS = setting("appearance", "rows", 7);
const MAX_CELL_SIZE = setting("appearance", "cellSize", 10);        // cells shrink automatically to fit the range
const PADDING = setting("appearance", "gap", 2);               // gap between cells
const BORDER_RADIUS = setting("appearance", "radius", 2);
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 320;
const SMALL_WIDTH = 150;           // small widget width in points; adjust if the bar does not reach the edge
// ============================================

const MENLO = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

// Daybar's Day palette. Colors you changed in the shared settings stay as you set them.
const DAY = {"#0d1117":"#f4f3ed","#ffffff":"#202820","#39d353":"#18764b","#58a6ff":"#286a9f","#ff5c5c":"#b43737","#ff9f43":"#a65410","#f2cc60":"#80620b"};
function C(hex, alpha = 1) {
  const night = new Color(hex, alpha);
  if (THEME === "night") return night;
  const day = new Color(DAY[hex.toLowerCase()] || hex, alpha);
  return THEME === "day" ? day : Color.dynamic(day, night);
}
// Tapping the widget runs this script (whatever you named it) straight into its details.
function runURL(action) {
  return "scriptable:///run/" + encodeURIComponent(Script.name()) + (action ? "?action=" + action : "");
}

function parseKey(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function fmt(d, format) { const f = new DateFormatter(); f.dateFormat = format; return f.string(d); }
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function getStats(now) {
  const start = parseKey(START_DATE);
  const end = parseKey(END_DATE);
  const today = startOfDay(now);
  const dayFraction = (now - today) / 86400000; // 0 at midnight, 1 at next midnight
  const total = daysBetween(end, start) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(today, start) + 1)); // includes today
  const daysLeft = Math.max(0, daysBetween(end, today));
  const progress = Math.min(1, Math.max(0, (elapsed - 1 + dayFraction) / total));
  return { start, end, today, dayFraction, total, elapsed, daysLeft, progress,
    pct: Math.round(progress * 100), weeksLeft: Math.floor(daysLeft / 7) };
}
// Weekdays and weekend days from tomorrow to the end date.
function splitLeft(s) {
  let weekdays = 0, weekend = 0;
  for (let d = addDays(s.today, 1); d <= s.end; d = addDays(d, 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) weekend++; else weekdays++;
  }
  return { weekdays, weekend };
}
// The day each quarter of the range is reached.
function milestones(s) {
  return [25, 50, 75, 100].map(p => {
    const date = addDays(s.start, Math.max(0, Math.ceil(s.total * p / 100) - 1));
    return { p, date, inDays: daysBetween(date, s.today) };
  });
}

function addBar(stack, width, progress, color) {
  const bar = stack.addStack();
  bar.layoutHorizontally();
  bar.size = new Size(width, 6);
  bar.cornerRadius = 3;
  bar.backgroundColor = C(REMAINING_COLOR, setting("appearance", "futureOpacity", 0.12));
  const fill = bar.addStack();
  fill.size = new Size(Math.max(1, width * progress), 6);
  fill.cornerRadius = 3;
  fill.backgroundColor = color;
  bar.addSpacer();
}

function smallWidget(widget, s) {
  const title = widget.addText(TITLE);
  title.font = MENLO_BOLD;
  title.textColor = C(TEXT_COLOR);
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;
  widget.addSpacer();
  const big = widget.addText(String(s.daysLeft));
  big.font = new Font("Menlo-Bold", 36);
  big.textColor = C(DONE_COLOR);
  big.minimumScaleFactor = 0.5;
  const unit = widget.addText(s.daysLeft === 1 ? "day left" : "days left");
  unit.font = MENLO;
  unit.textColor = C(TEXT_COLOR, 0.5);
  widget.addSpacer(8);
  addBar(widget, SMALL_WIDTH - 2 * SIDE_PADDING, s.progress, C(DONE_COLOR));
  widget.addSpacer(6);
  const sub = widget.addText(`${s.pct}% • Day ${s.elapsed}/${s.total}`);
  sub.font = new Font("Menlo", 10);
  sub.textColor = C(TEXT_COLOR, 0.5);
  sub.lineLimit = 1;
  sub.minimumScaleFactor = 0.7;
  return widget;
}

function createWidget(family = config.widgetFamily, now = new Date()) {
  const s = getStats(now);
  const { start, end, today, dayFraction, total, elapsed, daysLeft, pct, weeksLeft } = s;

  const widget = new ListWidget();
  widget.backgroundColor = C(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  widget.url = runURL();
  if (family === "small") return smallWidget(widget, s);

  // Grid covering the whole range (column-major, like GitHub)
  const cols = Math.ceil(total / ROWS);
  const avail = WIDGET_WIDTH - 2 * SIDE_PADDING;
  const cellSize = Math.max(3, Math.min(MAX_CELL_SIZE,
    Math.floor((avail - (cols - 1) * PADDING) / cols)));

  for (let row = 0; row < ROWS; row++) {
    const rowStack = widget.addStack();
    rowStack.spacing = PADDING;
    rowStack.layoutHorizontally();

    for (let col = 0; col < cols; col++) {
      const date = addDays(start, col * ROWS + row);
      const cell = rowStack.addStack();
      cell.size = new Size(cellSize, cellSize);
      cell.cornerRadius = BORDER_RADIUS;

      if (date > end) continue; // blank after the end date

      const diff = daysBetween(date, today);
      if (diff < 0) {
        cell.backgroundColor = C(DONE_COLOR, 1);
      } else if (diff === 0) {
        // today is white and fades in from the dim "remaining" level to full across the 24h day
        const opacity = REMAINING_OPACITY + dayFraction * (1 - REMAINING_OPACITY);
        cell.backgroundColor = C(TODAY_COLOR, opacity);
      } else {
        cell.backgroundColor = C(REMAINING_COLOR, REMAINING_OPACITY);
      }
    }
    if (row < ROWS - 1) widget.addSpacer(PADDING);
  }

  widget.addSpacer(8);

  // Footer: title left, days left right
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();

  const titleText = footer.addText(TITLE);
  titleText.font = MENLO_BOLD;
  titleText.textColor = C(TEXT_COLOR);
  titleText.lineLimit = 1;

  footer.addSpacer();

  const countText = footer.addText(`${daysLeft} days left`);
  countText.font = MENLO_BOLD;
  countText.textColor = C(DONE_COLOR);

  const sub = widget.addText(`${pct}% done  •  Day ${elapsed}/${total}  •  ${weeksLeft} weeks left`);
  sub.font = MENLO;
  sub.textColor = C(TEXT_COLOR, 0.5);
  sub.lineLimit = 1;

  if (family === "large") addDetails(widget, s);
  return widget;
}

// Large widget: the same grid and footer, then a progress bar, what's left and the milestones.
function addDetails(widget, s) {
  widget.addSpacer(14);
  addBar(widget, WIDGET_WIDTH - 2 * SIDE_PADDING, s.progress, C(DONE_COLOR));
  widget.addSpacer(12);
  const left = splitLeft(s);
  const line = (label, value, color) => {
    const row = widget.addStack();
    row.layoutHorizontally();
    const a = row.addText(label);
    a.font = MENLO;
    a.textColor = C(TEXT_COLOR, 0.5);
    row.addSpacer();
    const b = row.addText(value);
    b.font = MENLO_BOLD;
    b.textColor = color || C(TEXT_COLOR);
    widget.addSpacer(5);
  };
  line("Weekdays left", String(left.weekdays));
  line("Weekend days left", String(left.weekend));
  for (const m of milestones(s)) {
    line(`${m.p}%  ${fmt(m.date, "EEE, MMM d")}`, m.inDays < 0 ? "passed" : m.inDays === 0 ? "today" : `in ${m.inDays}d`,
      m.inDays < 0 ? C(DONE_COLOR) : undefined);
  }
  widget.addSpacer();
}

// ---------- in the app: details, then an optional preview ----------
async function showDetails() {
  const s = getStats(new Date());
  const left = splitLeft(s);
  const table = new UITable();
  table.showSeparators = true;
  const head = new UITableRow();
  head.isHeader = true;
  head.addText(TITLE, `${s.daysLeft} days left`);
  table.addRow(head);
  const row = (title, subtitle, onSelect) => {
    const r = new UITableRow();
    r.height = 56;
    r.addText(title, subtitle);
    if (onSelect) { r.onSelect = onSelect; r.dismissOnSelect = true; }
    table.addRow(r);
  };
  row(`${s.pct}% done`, `Day ${s.elapsed} of ${s.total}  •  ${fmt(s.start, "MMM d, yyyy")} → ${fmt(s.end, "MMM d, yyyy")}`);
  row(`${plural(s.weeksLeft, "week")}, ${plural(s.daysLeft % 7, "day")} left`, `${left.weekdays} weekdays  •  ${left.weekend} weekend days`);
  for (const m of milestones(s)) {
    row(`${m.p}%  ${fmt(m.date, "EEE, MMM d")}`, m.inDays < 0 ? "Passed" : m.inDays === 0 ? "Today" : `In ${plural(m.inDays, "day")}`);
  }
  let preview = null;
  for (const size of ["small", "medium", "large"]) row(`Preview ${size} widget`, "", () => { preview = size; });
  await table.present(false);
  if (preview) {
    const w = createWidget(preview);
    await (preview === "small" ? w.presentSmall() : preview === "large" ? w.presentLarge() : w.presentMedium());
  }
}

const widget = createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await showDetails();
}
Script.complete();
