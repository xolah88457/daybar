// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;
// Focus Timer Widget (Scriptable)
// Pomodoro-style timer with a live countdown on the widget, a notification
// when time is up, and a daily session tracker. Tap the widget to control it.

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
  const day = x => fields(x,["count","minutes"]) && integer(x.count) && integer(x.minutes);
  const timer = x => fields(x,["type","minutes","start","end","task"],["type","minutes","start","end"]) && ["focus","break"].includes(x.type) && integer(x.minutes,1,240) && integer(x.start) && integer(x.end) && x.end > x.start && (x.task === undefined || name(x.task));
  const session = x => fields(x,["type","minutes","creditedMinutes","end","date","task"],["type","minutes","creditedMinutes","end","date"]) && ["focus","break"].includes(x.type) && integer(x.minutes,1,240) && integer(x.creditedMinutes,0,x.minutes) && (x.type === "focus" || x.creditedMinutes === 0) && integer(x.end) && date(x.date) && (x.task === undefined || name(x.task));
  function valid(kind,x) {
    if (kind === "log") return Array.isArray(x) ? x.every(date) : record(x,date,names);
    if (kind === "focus") return fields(x,["state","days","sessions","baseline"],["state","days"]) && (x.state === null || timer(x.state)) && record(x.days,date,day) && (x.sessions === undefined || record(x.sessions,k => /^\d+$/.test(k),session)) && (x.baseline === undefined || record(x.baseline,date,day));
    if (kind === "sleep") return fields(x,["wakes","beds","plan"]) && record(x.wakes,date,v => integer(v,0,1439)) && record(x.beds,date,v => integer(v,0,1439)) && (x.plan === null || (fields(x.plan,["start","wake","bed"]) && date(x.plan.start) && integer(x.plan.wake,0,1439) && integer(x.plan.bed,0,1439)));
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
  return {settings,read,mutate,valid,date,check};
})();
const shared = await DB.settings();
const setting = (section,key,fallback) => shared[section]?.[key] ?? fallback;
// ---------- End Daybar boundary ----------

// ================= SETTINGS =================
const TITLE = setting("focus", "title", "Focus");
const FOCUS_OPTIONS = setting("focus", "focusOptions", [25, 50]);        // focus block lengths (minutes)
const BREAK_OPTIONS = setting("focus", "breakOptions", [5, 10]);         // regular breaks
const LONG_BREAK_OPTIONS = setting("focus", "longBreakOptions", [15, 30]);   // long breaks
const BLOCK_MINUTES = setting("focus", "blockMinutes", 25);              // one block = this many focus minutes (50 min = 2 blocks)

// Look
const BG_COLOR = setting("appearance", "background", "#0d1117");
const TEXT_COLOR = setting("appearance", "text", "#ffffff");
const FOCUS_COLOR = setting("appearance", "green", "#39d353");
const BREAK_COLOR = setting("appearance", "blue", "#58a6ff");
const CELL_SIZE = setting("appearance", "cellSize", 10);
const UNFILLED_COLOR = setting("appearance", "text", "#ffffff");   // same grey as the unfilled days on the days-left widget
const UNFILLED_OPACITY = setting("appearance", "futureOpacity", 0.12);
const PADDING = setting("appearance", "gap", 2);
const BORDER_RADIUS = setting("appearance", "radius", 2);
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 354;          // medium widget width in points; adjust if the row does not reach the right edge
// ============================================

const fm = FileManager.iCloud();
const dataPath = fm.joinPath(fm.documentsDirectory(), "focus-timer.json");
const MENLO = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

function pad(n) { return String(n).padStart(2, "0"); }
function key(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmtClock(d) {
  const f = new DateFormatter();
  f.dateFormat = "h:mm a";
  return f.string(d);
}

const emptyFocus = () => ({ state: null, days: {} });
async function load() {
  const data = (await DB.read("focus-timer.json", "focus", emptyFocus)).value;
  return deriveDays(data);
}
function upgrade(data) {
  if (data.sessions === undefined) {
    data.baseline = data.baseline || JSON.parse(JSON.stringify(data.days));
    data.sessions = {};
  }
  return data;
}
function deriveDays(data) {
  if (data.sessions !== undefined) {
    data.days = JSON.parse(JSON.stringify(data.baseline || {}));
    for (const s of Object.values(data.sessions)) {
      if (s.type !== "focus" || !s.creditedMinutes) continue;
      const day = data.days[s.date] || { count: 0, minutes: 0 };
      day.minutes += s.creditedMinutes;
      data.days[s.date] = day;
    }
  }
  for (const day of Object.values(data.days)) day.count = Math.floor(day.minutes / BLOCK_MINUTES);
  return data;
}
function recordSession(data, now) {
  const s = data.state;
  if (!s) return 0;
  upgrade(data);
  const id = String(s.start);
  let credited = 0;
  if (!Object.prototype.hasOwnProperty.call(data.sessions, id)) {
    const end = Math.min(now, s.end);
    credited = s.type === "focus" ? Math.max(0, Math.min(s.minutes, Math.floor((end - s.start) / 60000))) : 0;
    // A finished timer credits its planned length, even across DST or midnight.
    if (s.type === "focus" && now >= s.end) credited = s.minutes;
    data.sessions[id] = { type:s.type, minutes:s.minutes, creditedMinutes:credited,
      end, date:key(new Date(end)), ...(s.task ? {task:s.task} : {}) };
  }
  data.state = null;
  deriveDays(data);
  return credited;
}
async function completeLinkedTasks(data) {
  const tasks = setting("habits", "tasks", ["Coursework", "Live Trading", "Trade Review", "Apostles work"]);
  const thresholds = setting("habits", "focusThresholds", {});
  const totals = new Map();
  for (const s of Object.values(data.sessions || {})) {
    if (s.type !== "focus" || !tasks.includes(s.task) || !thresholds[s.task]) continue;
    const id = JSON.stringify([s.date,s.task]);
    totals.set(id, (totals.get(id) || 0) + s.creditedMinutes);
  }
  for (const [id,minutes] of totals) {
    const [date,task] = JSON.parse(id);
    if (minutes < thresholds[task]) continue;
    const file = "daily-log-" + setting("habits", "logId", "Daily_Tasks") + ".json";
    await DB.mutate(file, "log", () => ({}), raw => {
      const log = Array.isArray(raw) ? Object.fromEntries(raw.map(k => [k,tasks.slice()])) : raw;
      log[date] = [...new Set([...(log[date] || []), task])];
      return log;
    });
  }
}
async function settle() {
  let data = await load();
  if (data.state && Date.now() >= data.state.end) {
    data = await DB.mutate("focus-timer.json", "focus", emptyFocus, latest => {
      if (latest.state && Date.now() >= latest.state.end) recordSession(latest, Date.now());
      return deriveDays(latest);
    });
  }
  // Also repairs a cross-file interruption after focus was saved but before habits.
  await completeLinkedTasks(data);
  return data;
}
async function startTimer(type, minutes, task) {
  const data = await DB.mutate("focus-timer.json", "focus", emptyFocus, latest => {
    const now = Date.now();
    if (latest.state && now < latest.state.end) throw new Error("A timer is already running; reload before starting");
    if (latest.state) recordSession(latest, now);
    upgrade(latest);
    if (latest.sessions[String(now)]) throw new Error("Session timestamp already used; retry");
    latest.state = { type, minutes, start:now, end:now + minutes * 60000, ...(task ? {task} : {}) };
    return deriveDays(latest);
  });
  await Notification.removePending(["focus-timer"]);
  if (setting("focus", "alerts", true)) {
    const n = new Notification();
    n.identifier = "focus-timer";
    n.title = type === "focus" ? "Focus session done" : "Break over";
    n.body = type === "focus" ? "Nice work. Take a break." : "Ready for the next session?";
    n.sound = "complete";
    n.setTriggerDate(new Date(data.state.end));
    await n.schedule();
  }
  await completeLinkedTasks(data);
  return data;
}
async function stopTimer(expectedStart) {
  let credited = 0;
  const data = await DB.mutate("focus-timer.json", "focus", emptyFocus, latest => {
    if (latest.state && latest.state.start !== expectedStart) throw new Error("Timer changed; reload before stopping");
    if (latest.state) credited = recordSession(latest, Date.now());
    return deriveDays(latest);
  });
  await Notification.removePending(["focus-timer"]);
  await completeLinkedTasks(data);
  return credited;
}
async function chooseTask(type) {
  if (type !== "focus") return undefined;
  const tasks = setting("habits", "tasks", ["Coursework", "Live Trading", "Trade Review", "Apostles work"]);
  const menu = new Alert();
  menu.title = "Link focus to a task?";
  menu.addAction("No task");
  for (const task of tasks) menu.addAction(task);
  menu.addCancelAction("Cancel");
  const choice = await menu.presentSheet();
  return choice < 0 ? null : choice === 0 ? undefined : tasks[choice - 1];
}

function createWidget(data) {
  const today = data.days[key(new Date())] || { count: 0, minutes: 0 };
  today.count = Math.floor(today.minutes / BLOCK_MINUTES);   // blocks come from total minutes
  const s = data.state;

  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  if (s) widget.refreshAfterDate = new Date(s.end);

  const head = widget.addStack();
  head.layoutHorizontally();
  const title = head.addText(TITLE);
  title.font = MENLO_BOLD;
  title.textColor = new Color(TEXT_COLOR);
  head.addSpacer();
  // show the end time too: iOS widgets can't stop a live timer at 0, so if the countdown
  // ever starts counting back up, this tells you the time is already over
  const label = s ? `${s.type === "focus" ? "FOCUS" : "BREAK"} • ends ${fmtClock(new Date(s.end))}` : "READY";
  const status = head.addText(label);
  status.font = MENLO_BOLD;
  status.textColor = new Color(s && s.type !== "focus" ? BREAK_COLOR : FOCUS_COLOR);

  widget.addSpacer(8);

  if (s) {
    // Native iOS timer dates count upward after expiry; a snapshot never goes negative.
    const seconds = Math.max(0, Math.ceil((s.end - Date.now()) / 1000));
    const t = widget.addText(`${Math.floor(seconds / 60)}:${pad(seconds % 60)}`);
    t.font = new Font("Menlo-Bold", 38);
    t.textColor = new Color(s.type === "focus" ? FOCUS_COLOR : BREAK_COLOR);
    widget.refreshAfterDate = new Date(Math.min(s.end, Date.now() + 60000));
  } else {
    const t = widget.addText(`${FOCUS_OPTIONS[0]}:00`);
    t.font = new Font("Menlo-Bold", 38);
    t.textColor = new Color(TEXT_COLOR, 0.35);
  }

  widget.addSpacer(10);

  // Block counter: a single row like the days-left grid. Green = finished blocks, grey = unfilled.
  const row = widget.addStack();
  row.layoutHorizontally();
  row.spacing = PADDING;
  const avail = WIDGET_WIDTH - 2 * SIDE_PADDING;
  // pick a whole number of blocks and size them so the row ends exactly where it started
  const slots = Math.max(1, Math.round((avail + PADDING) / (CELL_SIZE + PADDING)));
  const cellSize = (avail - (slots - 1) * PADDING) / slots;
  for (let i = 0; i < slots; i++) {
    const cell = row.addStack();
    cell.size = new Size(cellSize, cellSize);
    cell.cornerRadius = BORDER_RADIUS;
    cell.backgroundColor = i < today.count
      ? new Color(FOCUS_COLOR)
      : new Color(UNFILLED_COLOR, UNFILLED_OPACITY);
  }

  widget.addSpacer(6);
  const foot = widget.addText(`Today ${today.count} block${today.count === 1 ? "" : "s"}  •  ${today.minutes} min`);
  foot.font = MENLO;
  foot.textColor = new Color(TEXT_COLOR, 0.5);
  foot.lineLimit = 1;

  return widget;
}

async function showMenu(data) {
  const options = [
    ...FOCUS_OPTIONS.map(m => ({ label: `Focus ${m} min`, type: "focus", minutes: m })),
    ...BREAK_OPTIONS.map(m => ({ label: `Break ${m} min`, type: "break", minutes: m })),
    ...LONG_BREAK_OPTIONS.map(m => ({ label: `Long break ${m} min`, type: "break", minutes: m }))
  ];

  const menu = new Alert();
  menu.title = TITLE;
  const s = data.state;
  if (s) {
    const left = Math.max(0, Math.ceil((s.end - Date.now()) / 60000));
    menu.message = `${s.type === "focus" ? "Focusing" : "On break"} • ${left} min left`;
    menu.addDestructiveAction(s.type === "focus" ? "Stop and count time worked" : "Stop timer");
  } else {
    menu.message = "Pick what to start";
    for (const o of options) menu.addAction(o.label);
    menu.addAction("Custom focus length");
  }
  menu.addCancelAction("Close");
  const choice = await menu.presentSheet();
  if (choice < 0) return;

  if (s) {
    const credited = await stopTimer(s.start);
    if (s.type === "focus") {
      const done = new Alert();
      done.title = "Stopped";
      done.message = credited > 0
        ? `Counted ${credited} min of focus.`
        : "Less than a minute, so nothing was counted.";
      done.addAction("OK");
      await done.present();
    }
  } else if (choice < options.length) {
    const option = options[choice], task = await chooseTask(option.type);
    if (task !== null) await startTimer(option.type, option.minutes, task);
  } else {
    const input = new Alert();
    input.title = "Custom focus length";
    const field = input.addTextField("minutes", String(FOCUS_OPTIONS[0]));
    field.setNumberPadKeyboard();
    input.addAction("Start");
    input.addCancelAction("Cancel");
    if ((await input.presentAlert()) === 0) {
      const m = Number(input.textFieldValue(0));
      if (Number.isInteger(m) && m > 0 && m <= 240) {
        const task = await chooseTask("focus");
        if (task !== null) await startTimer("focus", m, task);
      }
    }
  }
  await createWidget(await settle()).presentSmall();
}

const data = await settle();
if (config.runsInWidget) {
  Script.setWidget(createWidget(data));
} else {
  await showMenu(data);
}
Script.complete();
