// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: magic;
// Time-Blindness + Sleep Plan Widget (Scriptable)
// Day bar runs from when you woke up to bedtime (wake + 16h awake, then 8h sleep).
// Wake/bed times come from Apple Health via a Shortcut (or you can log them by hand).
// Tap the widget to log times or open the sleep plan (15 min/day adjustments).

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
  function valid(kind,x) {
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
        try { fm.copy(backup,p); } catch (___) { /* backup remains available for recovery */ }
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
  return {settings,read,mutate};
})();
const shared = await DB.settings();
const setting = (section,key,fallback) => shared[section]?.[key] ?? fallback;
// ---------- End Daybar boundary ----------

// ================= SETTINGS =================
const TITLE = setting("sleep", "title", "Time");
const AWAKE_HOURS = setting("sleep", "awakeHours", 16);             // awake window after waking
const SLEEP_HOURS = setting("sleep", "sleepHours", 8);              // sleep window

// Your ideal times (24h HH:MM). Leave TARGET_BED as "" to use wake minus SLEEP_HOURS.
const TARGET_WAKE = setting("sleep", "targetWake", "08:00");
const TARGET_BED = setting("sleep", "targetBed", "");

const STEP_MINUTES = setting("sleep", "stepMinutes", 15);            // how much the plan shifts per day
const AVERAGE_DAYS = setting("sleep", "averageDays", 7);             // logged days used for your "current" wake/bed

const BEDTIME_ALERTS = setting("sleep", "bedtimeAlerts", true);        // notifications near bedtime
const ROUTINE_MINUTES = setting("sleep", "routineMinutes", 120);        // night routine + bed prep starts this long before bed
const NO_PHONE_MINUTES = setting("sleep", "noPhoneMinutes", 60);        // no phone time starts this long before bed

// Appearance, like Daybar's: "night" (the default), "day", or "auto" to follow the iPhone's light/dark mode.
const THEME = "night";

// Look
const BG_COLOR = setting("appearance", "background", "#0d1117");
const TEXT_COLOR = setting("appearance", "text", "#ffffff");
const GOOD_COLOR = setting("appearance", "green", "#39d353");
const WARN_COLOR = setting("appearance", "yellow", "#f2cc60");
const URGENT_COLOR = setting("appearance", "red", "#ff5c5c");
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 320;
const SMALL_WIDTH = 150;           // small widget width in points; adjust if the bar does not reach the edge
// ============================================

const STALE_HOURS = AWAKE_HOURS + 6;   // after this long, a logged wake is assumed old
const MENLO = new Font("Menlo", 11);

// Daybar's Day palette. Colors you changed in the shared settings stay as you set them.
const DAY = {"#0d1117":"#f4f3ed","#ffffff":"#202820","#39d353":"#18764b","#58a6ff":"#286a9f","#ff5c5c":"#b43737","#ff9f43":"#a65410","#f2cc60":"#80620b"};
function C(hex, alpha = 1) {
  const night = new Color(hex, alpha);
  if (THEME === "night") return night;
  const day = new Color(DAY[hex.toLowerCase()] || hex, alpha);
  return THEME === "day" ? day : Color.dynamic(day, night);
}
// Tapping the widget runs this script (whatever you named it) straight into its menu.
function runURL(action) {
  return "scriptable:///run/" + encodeURIComponent(Script.name()) + (action ? "?action=" + action : "");
}

// ---------- time helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function key(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseKey(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function minOf(d) { return d.getHours() * 60 + d.getMinutes(); }
function wrap(m) { return ((Math.round(m) % 1440) + 1440) % 1440; }
function signedDiff(from, to) { return ((((to - from + 720) % 1440) + 1440) % 1440) - 720; }
function atMinutes(day, m) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m); }
function fmtClock(d) { const f = new DateFormatter(); f.dateFormat = "h:mm a"; return f.string(d); }
function fmtMin(m) { return fmtClock(atMinutes(new Date(), wrap(m))); }
function fmtDuration(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function circMean(list) {
  if (!list.length) return null;
  let s = 0, c = 0;
  for (const m of list) { const a = (m / 1440) * 2 * Math.PI; s += Math.sin(a); c += Math.cos(a); }
  return wrap((Math.atan2(s, c) / (2 * Math.PI)) * 1440);
}

const TW = toMin(TARGET_WAKE);
const TB = TARGET_BED ? toMin(TARGET_BED) : wrap(TW - SLEEP_HOURS * 60);

// ---------- storage ----------
const emptySleep = () => ({ wakes: {}, beds: {}, plan: null });
async function load() { return (await DB.read("sleep-data.json", "sleep", emptySleep)).value; }
async function mutateSleep(operation) { return DB.mutate("sleep-data.json", "sleep", emptySleep, operation); }
async function logWake(date) {
  return mutateSleep(data => { data.wakes[key(date)] = minOf(date); return data; });
}
async function logBed(date) {
  // A bedtime after midnight belongs to the evening before (calendar, not 24h math).
  const d = date.getHours() < 12 ? addDays(date, -1) : date;
  return mutateSleep(data => { data.beds[key(d)] = minOf(date); return data; });
}
async function startPlan() {
  return mutateSleep(data => {
    const base = baseline(data);
    if (!base) throw new Error("Log wake times before starting a plan");
    data.plan = { start:key(new Date()), wake:base.wake, bed:base.bed };
    return data;
  });
}
async function stopPlan() { return mutateSleep(data => { data.plan = null; return data; }); }
async function clearSleep() { return mutateSleep(() => emptySleep()); }

// Accepts a Date, an ISO string, "HH:MM", or a formatted date from Shortcuts
// Returns { date, hasDay } or null. hasDay=false means only a time of day was found.
function parseWhen(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : { date: v, hasDay: true };
  const s = String(v).trim();
  if (!s) return null;

  const direct = new Date(s.replace(/\s+at\s+/i, " "));
  if (!isNaN(direct) && /\d{4}|\d{1,2}\/\d{1,2}/.test(s)) return { date: direct, hasDay: true };

  // fall back to just the time of day, e.g. "07:12", "7:12 AM"
  const t = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?/);
  if (t) {
    let h = +t[1];
    const ap = t[3] ? t[3].toLowerCase() : null;
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (h > 23 || +t[2] > 59) return null;
    const d = new Date();
    d.setHours(h, +t[2], 0, 0);
    return { date: d, hasDay: false };
  }
  return null;
}

// ---- sleep session detection (used when the Shortcut sends every sleep segment) ----
function toList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return [];
}
// Turns date strings into Dates. If the strings only have times of day, work out the
// days by walking backwards from now (the list is sorted oldest first).
function resolveDates(strs, now) {
  const parsed = strs.map(parseWhen);
  if (!parsed.length || parsed.some(p => !p)) return null;
  const out = new Array(parsed.length);
  let ref = new Date(now.getTime() + 60000);
  for (let i = parsed.length - 1; i >= 0; i--) {
    let d = parsed[i].date;
    if (!parsed[i].hasDay) while (d > ref) d = addDays(d, -1);
    out[i] = d;
    ref = d;
  }
  return out;
}
// Merge segments (gaps up to 2h) into sessions and return every session of 3h or more
function findSleepSessions(starts, ends) {
  const n = Math.min(starts.length, ends.length);
  const segs = [];
  for (let i = 0; i < n; i++) if (ends[i] > starts[i]) segs.push({ s: starts[i], e: ends[i] });
  segs.sort((a, b) => a.s - b.s);
  const sessions = [];
  let cur = null;
  for (const seg of segs) {
    if (cur && seg.s - cur.e <= 2 * 3600000) {
      if (seg.e > cur.e) cur.e = seg.e;
    } else {
      cur = { s: seg.s, e: seg.e };
      sessions.push(cur);
    }
  }
  return sessions.filter(x => x.e - x.s >= 3 * 3600000);
}
function fmtFullDate(d) {
  const f = new DateFormatter();
  f.dateFormat = "EEE MMM d, h:mm a";
  return f.string(d);
}

// Called by the Shortcut: {"starts": "...", "ends": "..."} (all sleep segments),
// or {"wake": "...", "bed": "..."}
async function ingest(param) {
  let obj = param;
  if (typeof param === "string") {
    try { obj = JSON.parse(param); } catch (e) { obj = { wake: param }; }
  }
  if (!obj || typeof obj !== "object") return `no data: ${String(param).slice(0, 80)}`;

  if (obj.starts && obj.ends) {
    const nowT = new Date();
    const st = resolveDates(toList(obj.starts), nowT);
    const en = resolveDates(toList(obj.ends), nowT);
    if (!st || !en) return `could not read: ${JSON.stringify(obj).slice(0, 160)}`;
    const nights = findSleepSessions(st, en);
    if (!nights.length) return `no sleep session of 3h+ found (${st.length} segments)`;
    // log every night found, so a longer look-back fills in earlier days too
    for (const n of nights) { await logWake(n.e); await logBed(n.s); }
    const last = nights[nights.length - 1];
    return `wake ${fmtFullDate(last.e)}\nbed ${fmtFullDate(last.s)}\n(${nights.length} night(s) logged from ${st.length} segments)`;
  }

  const w = parseWhen(obj.wake), b = parseWhen(obj.bed);
  const now = new Date();
  let wakeDate = null, bedDate = null, bedSkipped = null;

  if (w) {
    wakeDate = w.date;
    // time-only wake: assume the most recent occurrence
    if (!w.hasDay && wakeDate > now) wakeDate = addDays(wakeDate, -1);
    await logWake(wakeDate);
  }
  if (b) {
    bedDate = b.date;
    if (!b.hasDay) {
      // time-only bedtime: the latest occurrence before waking (or before now)
      const ref = wakeDate || now;
      while (bedDate > ref) bedDate = addDays(bedDate, -1);
    }
    // ignore a bedtime that can't belong to the same night as the wake time
    if (wakeDate && (bedDate > wakeDate || wakeDate - bedDate > 14 * 3600000)) {
      bedSkipped = bedDate;
      bedDate = null;
    } else {
      await logBed(bedDate);
    }
  }
  if (!w && !b) return `could not read: ${JSON.stringify(obj).slice(0, 120)}`;
  return `wake ${wakeDate ? fmtFullDate(wakeDate) : "-"}\nbed ${bedDate ? fmtFullDate(bedDate) : bedSkipped ? "skipped (" + fmtFullDate(bedSkipped) + " is from an earlier night)" : "-"}`;
}

// ---------- averages and plan ----------
function recentAvg(map) {
  const keys = Object.keys(map).sort().slice(-AVERAGE_DAYS);
  return { mean: circMean(keys.map(k => map[k])), n: keys.length };
}
function baseline(data) {
  const w = recentAvg(data.wakes), b = recentAvg(data.beds);
  if (w.mean === null) return null;
  const bedEst = b.mean === null;
  return {
    wake: w.mean, nWake: w.n,
    bed: bedEst ? wrap(w.mean - SLEEP_HOURS * 60) : b.mean, nBed: b.n, bedEst
  };
}
function shiftToward(start, target, k) {
  const d = signedDiff(start, target);
  return wrap(start + Math.sign(d) * Math.min(Math.abs(d), STEP_MINUTES * k));
}
function planDays(st) {
  const m = Math.max(Math.abs(signedDiff(st.wake, TW)), Math.abs(signedDiff(st.bed, TB)));
  return Math.ceil(m / STEP_MINUTES);
}
function describeShift(d) {
  if (d === 0) return "on target";
  return `${fmtDuration(Math.abs(d))} ${d < 0 ? "earlier" : "later"}`;
}

// ---------- where are you in the day? ----------
function currentState(data, now) {
  let best = null;
  for (const k of Object.keys(data.wakes).sort().slice(-3)) {
    const d = atMinutes(parseKey(k), data.wakes[k]);
    if (d <= now && (now - d) / 3600000 < STALE_HOURS && (!best || d > best)) best = d;
  }
  if (best) return { wake: best, logged: true, asleep: false };

  // no recent log: estimate from plan, average, or target
  const today = startOfDay(now);
  let estMin = TW;
  if (data.plan) {
    const k = Math.max(0, daysBetween(today, parseKey(data.plan.start)));
    estMin = shiftToward(data.plan.wake, TW, k);
  } else {
    const base = baseline(data);
    if (base) estMin = base.wake;
  }
  const est = atMinutes(today, estMin);
  return { wake: est, logged: false, asleep: now < est };
}

// ---------- notifications ----------
async function scheduleBedAlerts(bed, now) {
  Notification.removePending(["bedtime-wind", "bedtime-routine", "bedtime-nophone", "bedtime-now"]);
  if (!BEDTIME_ALERTS) return;

  const alerts = [
    { id: "bedtime-routine", mins: ROUTINE_MINUTES, title: "Night routine",
      body: `Bed prep time. Bedtime is ${fmtClock(bed)}.`, sound: "complete" },
    { id: "bedtime-nophone", mins: NO_PHONE_MINUTES, title: "No phone time",
      body: `Phone away. Bedtime is ${fmtClock(bed)}.`, sound: "complete" },
    { id: "bedtime-now", mins: 0, title: "Bedtime",
      body: "Time to sleep so you get your full night.", sound: "alert" }
  ];
  for (const a of alerts) {
    const when = new Date(bed.getTime() - a.mins * 60000);
    if (when <= now) continue;
    const n = new Notification();
    n.identifier = a.id;
    n.title = a.title;
    n.body = a.body;
    n.sound = a.sound;
    n.setTriggerDate(when);
    await n.schedule();
  }
}

// ---------- widget ----------
async function createWidget(family = config.widgetFamily) {
  const data = await load();
  const now = new Date();
  const st = currentState(data, now);
  // Bedtime: tonight's goal from your sleep plan, or wake + AWAKE_HOURS if there is no plan
  let bed = new Date(st.wake.getTime() + AWAKE_HOURS * 3600000);
  let planK = null;
  if (data.plan) {
    planK = Math.max(0, daysBetween(st.wake, parseKey(data.plan.start)));
    const goalMin = shiftToward(data.plan.bed, TB, planK + 1);
    let dayOffset = 0;
    let cand = atMinutes(addDays(startOfDay(st.wake), dayOffset), goalMin);
    while (cand.getTime() - st.wake.getTime() < 3600000) {   // must be at least 1h after waking
      dayOffset += 1;
      cand = atMinutes(addDays(startOfDay(st.wake), dayOffset), goalMin);
    }
    bed = cand;
  }

  const widget = new ListWidget();
  widget.backgroundColor = C(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.url = runURL();
  widget.refreshAfterDate = new Date(now.getTime() + 5 * 60000);

  const elapsedMin = (now - st.wake) / 60000;
  const leftMin = (bed - now) / 60000;
  const p = st.asleep ? 0 : Math.min(1, Math.max(0, elapsedMin / Math.max(1, (bed - st.wake) / 60000)));
  const col = st.asleep ? C(TEXT_COLOR, 0.4)
    : leftMin <= 0 ? C(URGENT_COLOR)
    : leftMin <= 120 ? C(WARN_COLOR)
    : C(GOOD_COLOR);

  if (!st.asleep) await scheduleBedAlerts(bed, now);

  // in the last two hours, show what to be doing instead of the plan/bed line
  let phase = null;
  if (!st.asleep && leftMin > 0) {
    if (leftMin <= NO_PHONE_MINUTES) phase = { text: "No phone time", color: C(URGENT_COLOR) };
    else if (leftMin <= ROUTINE_MINUTES) phase = { text: "Night routine • bed prep", color: C(WARN_COLOR) };
  }
  const status = st.asleep ? `Wake in ${fmtDuration((st.wake - now) / 60000)}`
    : leftMin <= 0 ? `Past bedtime by ${fmtDuration(-leftMin)}`
    : `${fmtDuration(leftMin)} until bed`;

  if (family === "small") {
    widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
    const clockS = widget.addText(fmtClock(now));
    clockS.font = new Font("Menlo-Bold", 12);
    clockS.textColor = C(TEXT_COLOR, 0.6);
    clockS.lineLimit = 1;
    widget.addSpacer(4);
    const bigS = widget.addText(status);
    bigS.font = new Font("Menlo-Bold", 20);
    bigS.textColor = col;
    bigS.minimumScaleFactor = 0.5;
    widget.addSpacer(8);
    const w = SMALL_WIDTH - 2 * SIDE_PADDING;
    const barS = widget.addStack();
    barS.layoutHorizontally();
    barS.size = new Size(w, 8);
    barS.cornerRadius = 4;
    barS.backgroundColor = C(TEXT_COLOR, setting("appearance", "futureOpacity", 0.12));
    const fillS = barS.addStack();
    fillS.size = new Size(Math.max(1, w * p), 8);
    fillS.cornerRadius = 4;
    fillS.backgroundColor = col;
    barS.addSpacer();
    widget.addSpacer(6);
    const lineS = widget.addText(phase ? phase.text : `Bed ${fmtClock(bed)}`);
    lineS.font = phase ? new Font("Menlo-Bold", 11) : new Font("Menlo", 11);
    lineS.textColor = phase ? phase.color : C(TEXT_COLOR, 0.6);
    lineS.lineLimit = 1;
    lineS.minimumScaleFactor = 0.7;
    widget.addSpacer();
    return widget;
  }

  // Top: clock + awake time
  const top = widget.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  const clock = top.addText(fmtClock(now));
  clock.font = new Font("Menlo-Bold", 20);
  clock.textColor = C(TEXT_COLOR);
  top.addSpacer();
  const right = top.addText(st.asleep ? "Sleeping" : `Awake ${fmtDuration(elapsedMin)}`);
  right.font = MENLO;
  right.textColor = C(TEXT_COLOR, 0.6);

  widget.addSpacer(6);

  // Progress bar (wake to bedtime)
  const barW = WIDGET_WIDTH - 2 * SIDE_PADDING;
  const bar = widget.addStack();
  bar.layoutHorizontally();
  bar.size = new Size(barW, 8);
  bar.cornerRadius = 4;
  bar.backgroundColor = C(TEXT_COLOR, setting("appearance", "futureOpacity", 0.12));
  const fill = bar.addStack();
  fill.size = new Size(Math.max(1, barW * p), 8);
  fill.cornerRadius = 4;
  fill.backgroundColor = col;
  bar.addSpacer();

  widget.addSpacer(8);

  // Woke / bed row
  const times = widget.addStack();
  times.layoutHorizontally();
  const wokeT = times.addText(`${st.asleep ? "Wake" : "Woke"} ${fmtClock(st.wake)}${st.logged ? "" : " (est)"}`);
  wokeT.font = MENLO;
  wokeT.textColor = C(TEXT_COLOR, 0.6);
  times.addSpacer();
  const bedT = times.addText(`Bed ${fmtClock(bed)}`);
  bedT.font = MENLO;
  bedT.textColor = C(TEXT_COLOR, 0.6);

  widget.addSpacer(4);

  // Main status line
  const big = widget.addText(status);
  big.font = new Font("Menlo-Bold", 16);
  big.textColor = col;

  widget.addSpacer(4);

  // Plan line
  let planStr;
  if (data.plan) {
    const k = planK;
    const total = planDays(data.plan);
    const bedGoal = shiftToward(data.plan.bed, TB, k + 1);
    const wakeGoal = shiftToward(data.plan.wake, TW, k + 1);
    planStr = k >= total
      ? `Plan done • bed ${fmtMin(TB)} • wake ${fmtMin(TW)}`
      : `Plan ${k + 1}/${total} • tonight bed ${fmtMin(bedGoal)} → wake ${fmtMin(wakeGoal)}`;
  } else {
    planStr = "No sleep plan • tap to set one up";
  }
  const plan = widget.addText(phase ? phase.text : planStr);
  plan.font = phase ? new Font("Menlo-Bold", 12) : new Font("Menlo", 10);
  plan.textColor = phase ? phase.color : C(TEXT_COLOR, 0.5);
  plan.lineLimit = 1;

  return widget;
}

// ---------- in-app screens ----------
async function pickTime(title) {
  const a = new Alert();
  a.title = title;
  a.addAction("Just now");
  a.addAction("Pick a time");
  a.addCancelAction("Cancel");
  const c = await a.presentSheet();
  if (c === 0) return new Date();
  if (c === 1) {
    const picker = new DatePicker();
    picker.initialDate = new Date();
    return picker.pickTime();
  }
  return null;
}

async function planScreen(data) {
  const table = new UITable();
  table.showSeparators = true;

  const addRow = (title, sub, opts = {}) => {
    const row = new UITableRow();
    row.height = opts.height || 56;
    const cell = row.addText(title, sub);
    if (opts.color) cell.titleColor = opts.color;
    if (opts.onSelect) { row.onSelect = opts.onSelect; row.dismissOnSelect = false; }
    table.addRow(row);
    return row;
  };

  const render = () => {
    table.removeAllRows();
    const head = new UITableRow();
    head.isHeader = true;
    head.addText("Sleep plan", `Target: wake ${fmtMin(TW)} • bed ${fmtMin(TB)}`);
    table.addRow(head);

    const base = baseline(data);
    const start = data.plan || (base ? { wake: base.wake, bed: base.bed } : null);

    const addClearRow = () => {
      if (!Object.keys(data.wakes).length && !Object.keys(data.beds).length && !data.plan) return;
      addRow("Clear all logged sleep data", "Removes logged wake/bed times and the plan, so you can start fresh", {
        color: C(URGENT_COLOR),
        onSelect: async () => {
          const confirm = new Alert();
          confirm.title = "Clear all sleep data?";
          confirm.addDestructiveAction("Clear");
          confirm.addCancelAction("Cancel");
          if (await confirm.presentAlert() !== 0) return;
          data = await clearSleep(); render(); table.reload();
        }
      });
    };

    if (!start) {
      addRow("No data yet", "Log a few wake times (or set up the Shortcut) so I can work out your current schedule.");
      addClearRow();
      return;
    }

    if (base) {
      addRow("Current average",
        `Wake ${fmtMin(base.wake)} • Bed ${fmtMin(base.bed)}${base.bedEst ? " (est)" : ""} • ${base.nWake} day(s) logged`);
    }
    // what has actually been logged (last few days), so odd values are easy to spot
    const loggedKeys = [...new Set([...Object.keys(data.wakes), ...Object.keys(data.beds)])].sort().slice(-AVERAGE_DAYS);
    if (loggedKeys.length) {
      const lines = loggedKeys.map(k =>
        `${k}: wake ${k in data.wakes ? fmtMin(data.wakes[k]) : "-"} • bed ${k in data.beds ? fmtMin(data.beds[k]) : "-"}`);
      addRow("Logged days", lines.join("\n"), { height: 28 + lines.length * 22 });
    }
    if (data.plan) {
      addRow("Plan baseline", `Started ${data.plan.start} from wake ${fmtMin(data.plan.wake)} • bed ${fmtMin(data.plan.bed)}`);
    }

    const dW = signedDiff(start.wake, TW), dB = signedDiff(start.bed, TB);
    const days = planDays(start);
    addRow("Adjustment needed",
      `Wake ${describeShift(dW)} • Bed ${describeShift(dB)}\n${days === 0 ? "Already on target" : `${days} day(s) at ${STEP_MINUTES} min/day`}`,
      { height: 72 });

    const nowK = data.plan ? Math.max(0, daysBetween(new Date(), parseKey(data.plan.start))) : -1;
    for (let k = 1; k <= days; k++) {
      const isCurrent = data.plan && k === nowK + 1;
      addRow(`${isCurrent ? "▶ " : ""}Night ${k}`,
        `Bed ${fmtMin(shiftToward(start.bed, TB, k))} → wake ${fmtMin(shiftToward(start.wake, TW, k))}`,
        { color: isCurrent ? C(GOOD_COLOR) : undefined, height: 48 });
    }

    if (base) {
      addRow(data.plan ? "Restart plan from my current times" : "Start plan from today",
        "Uses your current average as the starting point", {
          color: C(GOOD_COLOR),
          onSelect: async () => {
            data = await startPlan(); render(); table.reload();
          }
        });
    }
    if (data.plan) {
      addRow("Stop plan", "", {
        color: C(URGENT_COLOR),
        onSelect: async () => { data = await stopPlan(); render(); table.reload(); }
      });
    }
    addClearRow();
  };

  render();
  await table.present(false);
}

// One-click action for the moment, like Daybar's: log waking in the morning, bedtime at night.
function quickAction(data, now) {
  const h = now.getHours();
  if (h >= 4 && h <= 13 && !(key(now) in data.wakes)) return { label: "I'm up: log wake now", kind: "wake" };
  if (h >= 19 || h < 4) {
    const evening = h < 12 ? addDays(now, -1) : now;   // same attribution as logBed
    if (!(key(evening) in data.beds)) return { label: "Going to bed: log now", kind: "bed" };
  }
  return null;
}

async function showMenu() {
  const data = await load();
  const base = baseline(data);
  const quick = quickAction(data, new Date());

  const menu = new Alert();
  menu.title = TITLE;
  menu.message = base
    ? `Avg wake ${fmtMin(base.wake)} • bed ${fmtMin(base.bed)}${base.bedEst ? " (est)" : ""}`
    : "No sleep data logged yet";
  const labels = [...(quick ? [quick.label] : []), "Log wake time", "Log bedtime", "Sleep plan", "Preview widget"];
  for (const l of labels) menu.addAction(l);
  menu.addCancelAction("Close");
  const choice = await menu.presentSheet();
  const picked = choice >= 0 ? labels[choice] : null;

  if (quick && picked === quick.label) {
    const d = new Date();
    if (quick.kind === "wake") await logWake(d); else await logBed(d);
  } else if (picked === "Log wake time") {
    const d = await pickTime("When did you wake up?");
    if (d) await logWake(d);
  } else if (picked === "Log bedtime") {
    const d = await pickTime("When did you go to bed?");
    if (d) await logBed(d);
  } else if (picked === "Sleep plan") {
    await planScreen(data);
  }
  if (picked) await (await createWidget()).presentMedium();
}

// ---------- run ----------
if (args.shortcutParameter !== undefined && args.shortcutParameter !== null) {
  // Called from a Shortcut: store the Health data, no UI
  const result = await ingest(args.shortcutParameter);
  Script.setShortcutOutput(result);
} else if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else {
  await showMenu();
}
Script.complete();
