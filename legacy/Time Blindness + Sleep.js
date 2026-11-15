// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: magic;
// Time-Blindness + Sleep Plan Widget (Scriptable)
// Day bar runs from when you woke up to bedtime (wake + 16h awake, then 8h sleep).
// Wake/bed times come from Apple Health via a Shortcut (or you can log them by hand).
// Tap the widget to log times or open the sleep plan (15 min/day adjustments).

// ================= SETTINGS =================
const TITLE = "Time";
const AWAKE_HOURS = 16;             // awake window after waking
const SLEEP_HOURS = 8;              // sleep window

// Your ideal times (24h HH:MM). Leave TARGET_BED as "" to use wake minus SLEEP_HOURS.
const TARGET_WAKE = "08:00";
const TARGET_BED = "";

const STEP_MINUTES = 15;            // how much the plan shifts per day
const AVERAGE_DAYS = 7;             // logged days used for your "current" wake/bed

const BEDTIME_ALERTS = true;        // notifications near bedtime
const ROUTINE_MINUTES = 120;        // night routine + bed prep starts this long before bed
const NO_PHONE_MINUTES = 60;        // no phone time starts this long before bed

// Look
const BG_COLOR = "#0d1117";
const TEXT_COLOR = "#ffffff";
const GOOD_COLOR = "#39d353";
const WARN_COLOR = "#f2cc60";
const URGENT_COLOR = "#ff5c5c";
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 320;
// ============================================

const STALE_HOURS = AWAKE_HOURS + 6;   // after this long, a logged wake is assumed old
const MENLO = new Font("Menlo", 11);
const MENLO_BOLD = new Font("Menlo-Bold", 12);

const fm = FileManager.local();
const dataPath = fm.joinPath(fm.documentsDirectory(), "sleep-data.json");

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
function load() {
  let d = {};
  if (fm.fileExists(dataPath)) { try { d = JSON.parse(fm.readString(dataPath)); } catch (e) { d = {}; } }
  return { wakes: d.wakes || {}, beds: d.beds || {}, plan: d.plan || null };
}
function save(data) { fm.writeString(dataPath, JSON.stringify(data)); }

function logWake(data, date) { data.wakes[key(date)] = minOf(date); save(data); }
function logBed(data, date) {
  // a bedtime after midnight belongs to the evening before
  const d = date.getHours() < 12 ? addDays(date, -1) : date;
  data.beds[key(d)] = minOf(date);
  save(data);
}

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
function ingest(data, param) {
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
    for (const n of nights) { logWake(data, n.e); logBed(data, n.s); }
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
    logWake(data, wakeDate);
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
      logBed(data, bedDate);
    }
  }
  if (!w && !b) return `could not read: ${JSON.stringify(obj).slice(0, 120)}`;
  const fmtFull = d => {
    const f = new DateFormatter();
    f.dateFormat = "EEE MMM d, h:mm a";
    return f.string(d);
  };
  return `wake ${wakeDate ? fmtFull(wakeDate) : "-"}\nbed ${bedDate ? fmtFull(bedDate) : bedSkipped ? "skipped (" + fmtFull(bedSkipped) + " is from an earlier night)" : "-"}`;
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
async function createWidget() {
  const data = load();
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
  widget.backgroundColor = new Color(BG_COLOR);
  widget.setPadding(12, SIDE_PADDING, 12, SIDE_PADDING);
  widget.refreshAfterDate = new Date(now.getTime() + 5 * 60000);

  const elapsedMin = (now - st.wake) / 60000;
  const leftMin = (bed - now) / 60000;
  const p = st.asleep ? 0 : Math.min(1, Math.max(0, elapsedMin / Math.max(1, (bed - st.wake) / 60000)));
  const col = st.asleep ? new Color(TEXT_COLOR, 0.4)
    : leftMin <= 0 ? new Color(URGENT_COLOR)
    : leftMin <= 120 ? new Color(WARN_COLOR)
    : new Color(GOOD_COLOR);

  if (!st.asleep) await scheduleBedAlerts(bed, now);

  // Top: clock + awake time
  const top = widget.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  const clock = top.addText(fmtClock(now));
  clock.font = new Font("Menlo-Bold", 20);
  clock.textColor = new Color(TEXT_COLOR);
  top.addSpacer();
  const right = top.addText(st.asleep ? "Sleeping" : `Awake ${fmtDuration(elapsedMin)}`);
  right.font = MENLO;
  right.textColor = new Color(TEXT_COLOR, 0.6);

  widget.addSpacer(6);

  // Progress bar (wake to bedtime)
  const barW = WIDGET_WIDTH - 2 * SIDE_PADDING;
  const bar = widget.addStack();
  bar.layoutHorizontally();
  bar.size = new Size(barW, 8);
  bar.cornerRadius = 4;
  bar.backgroundColor = new Color(TEXT_COLOR, 0.12);
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
  wokeT.textColor = new Color(TEXT_COLOR, 0.6);
  times.addSpacer();
  const bedT = times.addText(`Bed ${fmtClock(bed)}`);
  bedT.font = MENLO;
  bedT.textColor = new Color(TEXT_COLOR, 0.6);

  widget.addSpacer(4);

  // Main status line
  let status;
  if (st.asleep) status = `Wake in ${fmtDuration((st.wake - now) / 60000)}`;
  else if (leftMin <= 0) status = `Past bedtime by ${fmtDuration(-leftMin)}`;
  else status = `${fmtDuration(leftMin)} until bed`;
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
  // in the last two hours, show what to be doing instead of the plan line
  let phase = null;
  if (!st.asleep && leftMin > 0) {
    if (leftMin <= NO_PHONE_MINUTES) phase = { text: "No phone time", color: new Color(URGENT_COLOR) };
    else if (leftMin <= ROUTINE_MINUTES) phase = { text: "Night routine • bed prep", color: new Color(WARN_COLOR) };
  }
  const plan = widget.addText(phase ? phase.text : planStr);
  plan.font = phase ? new Font("Menlo-Bold", 12) : new Font("Menlo", 10);
  plan.textColor = phase ? phase.color : new Color(TEXT_COLOR, 0.5);
  plan.lineLimit = 1;

  return widget;
}

// ---------- in-app screens ----------
async function pickTime(title, allowSkip) {
  const a = new Alert();
  a.title = title;
  a.addAction("Just now");
  a.addAction("Enter a time (HH:MM)");
  a.addCancelAction("Cancel");
  const c = await a.presentSheet();
  if (c === 0) return new Date();
  if (c === 1) {
    const input = new Alert();
    input.title = title;
    input.message = "24-hour time, e.g. 07:15";
    input.addTextField("HH:MM", fmtHHMM(new Date()));
    input.addAction("Save");
    input.addCancelAction("Cancel");
    if ((await input.presentAlert()) === 0) {
      const r = parseWhen(input.textFieldValue(0));
      if (r) return r.date;
      const err = new Alert();
      err.title = "Couldn't read that time";
      err.addAction("OK");
      await err.present();
    }
  }
  return null;
}
function fmtHHMM(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

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
        color: new Color(URGENT_COLOR),
        onSelect: () => { data.wakes = {}; data.beds = {}; data.plan = null; save(data); render(); table.reload(); }
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
        { color: isCurrent ? new Color(GOOD_COLOR) : undefined, height: 48 });
    }

    if (base) {
      addRow(data.plan ? "Restart plan from my current times" : "Start plan from today",
        "Uses your current average as the starting point", {
          color: new Color(GOOD_COLOR),
          onSelect: () => {
            data.plan = { start: key(new Date()), wake: base.wake, bed: base.bed };
            save(data); render(); table.reload();
          }
        });
    }
    if (data.plan) {
      addRow("Stop plan", "", {
        color: new Color(URGENT_COLOR),
        onSelect: () => { data.plan = null; save(data); render(); table.reload(); }
      });
    }
    addClearRow();
  };

  render();
  await table.present(false);
}

async function showMenu() {
  const data = load();
  const base = baseline(data);

  const menu = new Alert();
  menu.title = TITLE;
  menu.message = base
    ? `Avg wake ${fmtMin(base.wake)} • bed ${fmtMin(base.bed)}${base.bedEst ? " (est)" : ""}`
    : "No sleep data logged yet";
  menu.addAction("Log wake time");
  menu.addAction("Log bedtime");
  menu.addAction("Sleep plan");
  menu.addAction("Preview widget");
  menu.addCancelAction("Close");
  const choice = await menu.presentSheet();

  if (choice === 0) {
    const d = await pickTime("When did you wake up?");
    if (d) logWake(data, d);
  } else if (choice === 1) {
    const d = await pickTime("When did you go to bed?");
    if (d) logBed(data, d);
  } else if (choice === 2) {
    await planScreen(data);
  }
  if (choice >= 0 && choice <= 3) await (await createWidget()).presentMedium();
}

// ---------- run ----------
if (args.shortcutParameter !== undefined && args.shortcutParameter !== null) {
  // Called from a Shortcut: store the Health data, no UI
  const result = ingest(load(), args.shortcutParameter);
  Script.setShortcutOutput(result);
} else if (config.runsInWidget) {
  Script.setWidget(await createWidget());
} else {
  await showMenu();
}
Script.complete();
