// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: magic;
// Days Left Widget (Scriptable)
// GitHub-style grid counting down to an end date. Every square is one day.

// ---------- Daybar standalone boundary (kept inline: no imports) ----------
const DB = (() => {
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const integer = (x, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= lo && x <= hi;
  const u32 = x => Number.isInteger(x) && x >= 0 && x <= 4294967295;
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
  const day = x => fields(x,["count","minutes"]) && u32(x.count) && u32(x.minutes);
  const timer = x => fields(x,["type","minutes","start","end","task"],["type","minutes","start","end"]) && ["focus","break"].includes(x.type) && u32(x.minutes) && x.minutes >= 1 && x.minutes <= 240 && integer(x.start) && integer(x.end) && x.end - x.start === x.minutes * 60000 && (x.task === undefined || name(x.task));
  const sessionKey = k => /^(0|[1-9]\d*)$/.test(k);
  const session = x => fields(x,["type","minutes","creditedMinutes","end","date","task"],["type","minutes","creditedMinutes","end","date"]) && ["focus","break"].includes(x.type) && u32(x.minutes) && x.minutes >= 1 && x.minutes <= 240 && u32(x.creditedMinutes) && x.creditedMinutes <= x.minutes && (x.type === "focus" || x.creditedMinutes === 0) && integer(x.end) && date(x.date) && (x.task === undefined || name(x.task)) && (() => {
    const endDate = new Date(x.end);
    const endUTC = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
    const sessionDate = new Date(x.date + 'T00:00:00Z');
    const sessionUTC = Date.UTC(sessionDate.getUTCFullYear(), sessionDate.getUTCMonth(), sessionDate.getUTCDate());
    const diffDays = Math.round((sessionUTC - endUTC) / 86400000);
    return diffDays >= -1 && diffDays <= 1;
  })();
  function valid(kind,x) {
    if (kind === "log") return Array.isArray(x) ? x.every(date) : record(x,date,names);
    if (kind === "focus") {
      if (!fields(x,["state","days","sessions","baseline"],["state","days"])) return false;
      if (x.state !== null && !timer(x.state)) return false;
      if (!record(x.days,date,day)) return false;
      const hasSessions = x.sessions !== undefined;
      const hasBaseline = x.baseline !== undefined;
      if (!hasSessions && hasBaseline) {
        for (const [d, dayData] of Object.entries(x.days)) {
          const baselineDay = x.baseline[d];
          if (dayData.minutes > 0) {
            if (!baselineDay || baselineDay.minutes !== dayData.minutes) return false;
          }
        }
        for (const [d, baselineDay] of Object.entries(x.baseline)) {
          if (baselineDay.minutes > 0 && (!x.days[d] || x.days[d].minutes !== baselineDay.minutes)) return false;
        }
      }
      if (hasSessions) {
        if (!record(x.sessions, sessionKey, session)) return false;
        // Validate key-value relationship: key is start timestamp, value has end, minutes, creditedMinutes
        for (const [startKey, s] of Object.entries(x.sessions)) {
          const start = Number(startKey);
          if (!Number.isSafeInteger(start) || start < 0) return false;
          if (s.end < start || s.end > start + s.minutes * 60000) return false;
          if (s.creditedMinutes * 60000 > s.end - start) return false;
        }
        const derived = {};
        if (hasBaseline) {
          for (const [d, dayData] of Object.entries(x.baseline)) derived[d] = { ...dayData };
        }
        for (const s of Object.values(x.sessions)) {
          if (s.type === "focus" && s.creditedMinutes > 0) {
            const d = s.date;
            derived[d] = derived[d] || { count: 0, minutes: 0 };
            derived[d].minutes += s.creditedMinutes;
          }
        }
        for (const [d, dayData] of Object.entries(x.days)) {
          if (dayData.minutes > 0) {
            const derivedDay = derived[d];
            if (!derivedDay || dayData.minutes > derivedDay.minutes) return false;
          }
        }
        for (const t of Object.values(derived)) if (t.minutes > 4294967295) return false;
      }
      if (hasBaseline && !record(x.baseline,date,day)) return false;
      return true;
    }
    if (kind === "sleep") return fields(x,["wakes","beds","plan"]) && record(x.wakes,date,v => u32(v) && v <= 1439) && record(x.beds,date,v => u32(v) && v <= 1439) && (x.plan === null || (fields(x.plan,["start","wake","bed"]) && date(x.plan.start) && u32(x.plan.wake) && x.plan.wake <= 1439 && u32(x.plan.bed) && x.plan.bed <= 1439));
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
        try { fm.copy(backup,p); } catch (__) { /* backup remains available for recovery */ }
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
  return {settings,read,mutate,valid,date,check};
})();
const shared = await DB.settings();
const setting = (section,key,fallback) => shared[section]?.[key] ?? fallback;
// ---------- End Daybar boundary ----------

// ================= SETTINGS =================
// Dates in YYYY-MM-DD
const START_DATE = setting("countdown", "startDate", "2026-09-09");
const END_DATE = setting("countdown", "endDate", "2027-05-24");
const TITLE = setting("countdown", "title", "End of University");

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
// ============================================

const MENLO = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

function parseKey(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }

function createWidget() {
  const start = parseKey(START_DATE);
  const end = parseKey(END_DATE);
  const now = new Date();
  const today = startOfDay(now);
  const dayFraction = (now - today) / 86400000; // 0 at midnight, 1 at next midnight

  const total = daysBetween(end, start) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(today, start) + 1)); // includes today
  const daysLeft = Math.max(0, daysBetween(end, today));
  const pct = Math.round(Math.min(1, Math.max(0, (elapsed - 1 + dayFraction) / total)) * 100);
  const weeksLeft = Math.floor(daysLeft / 7);

  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60000);

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
        cell.backgroundColor = new Color(DONE_COLOR, 1);
      } else if (diff === 0) {
        // today is white and fades in from the dim "remaining" level to full across the 24h day
        const opacity = REMAINING_OPACITY + dayFraction * (1 - REMAINING_OPACITY);
        cell.backgroundColor = new Color(TODAY_COLOR, opacity);
      } else {
        cell.backgroundColor = new Color(REMAINING_COLOR, REMAINING_OPACITY);
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
  titleText.textColor = new Color(TEXT_COLOR);
  titleText.lineLimit = 1;

  footer.addSpacer();

  const countText = footer.addText(`${daysLeft} days left`);
  countText.font = MENLO_BOLD;
  countText.textColor = new Color(DONE_COLOR);

  const sub = widget.addText(`${pct}% done  •  Day ${elapsed}/${total}  •  ${weeksLeft} weeks left`);
  sub.font = MENLO;
  sub.textColor = new Color(TEXT_COLOR, 0.5);
  sub.lineLimit = 1;

  return widget;
}

const widget = createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
