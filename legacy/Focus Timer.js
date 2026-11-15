// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;
// Focus Timer Widget (Scriptable)
// Pomodoro-style timer with a live countdown on the widget, a notification
// when time is up, and a daily session tracker. Tap the widget to control it.

// ================= SETTINGS =================
const TITLE = "Focus";
const FOCUS_OPTIONS = [25, 50];        // focus block lengths (minutes)
const BREAK_OPTIONS = [5, 10];         // regular breaks
const LONG_BREAK_OPTIONS = [15, 30];   // long breaks
const BLOCK_MINUTES = 25;              // one block = this many focus minutes (50 min = 2 blocks)

// Look
const BG_COLOR = "#0d1117";
const TEXT_COLOR = "#ffffff";
const FOCUS_COLOR = "#39d353";
const BREAK_COLOR = "#58a6ff";
const CELL_SIZE = 10;
const UNFILLED_COLOR = "#ffffff";   // same grey as the unfilled days on the days-left widget
const UNFILLED_OPACITY = 0.12;
const PADDING = 2;
const BORDER_RADIUS = 2;
const SIDE_PADDING = 12;
const WIDGET_WIDTH = 354;          // medium widget width in points; adjust if the row does not reach the right edge
// ============================================

const fm = FileManager.local();
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

function load() {
  if (!fm.fileExists(dataPath)) return { state: null, days: {} };
  try { return JSON.parse(fm.readString(dataPath)); }
  catch (e) { return { state: null, days: {} }; }
}
function save(data) { fm.writeString(dataPath, JSON.stringify(data)); }

// If a timer finished while the script wasn't running, credit it now
// Add focus minutes to a day. Blocks are worked out from total minutes, so a 36 minute
// stop plus 14 more minutes later still adds up to one full block.
function addFocusMinutes(data, date, minutes) {
  const k = key(date);
  const day = data.days[k] || { count: 0, minutes: 0 };
  day.minutes += minutes;
  day.count = Math.floor(day.minutes / BLOCK_MINUTES);
  data.days[k] = day;
}

function settle(data) {
  const s = data.state;
  if (s && Date.now() >= s.end) {
    if (s.type === "focus") addFocusMinutes(data, new Date(s.end), s.minutes);
    data.state = null;
    save(data);
  }
  return data;
}

async function startTimer(data, type, minutes) {
  const now = Date.now();
  data.state = { type, minutes, start: now, end: now + minutes * 60000 };
  save(data);

  Notification.removePending(["focus-timer"]);
  const n = new Notification();
  n.identifier = "focus-timer";
  n.title = type === "focus" ? "Focus session done" : "Break over";
  n.body = type === "focus" ? "Nice work. Take a break." : "Ready for the next session?";
  n.sound = "complete";
  n.setTriggerDate(new Date(data.state.end));
  await n.schedule();
}

// Stopping a focus session early still counts the minutes you worked
function stopTimer(data) {
  const s = data.state;
  let credited = 0;
  if (s && s.type === "focus") {
    credited = Math.max(0, Math.min(s.minutes, Math.floor((Date.now() - s.start) / 60000)));
    if (credited > 0) addFocusMinutes(data, new Date(), credited);
  }
  data.state = null;
  save(data);
  Notification.removePending(["focus-timer"]);
  return credited;
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
    const t = widget.addDate(new Date(s.end));
    t.applyTimerStyle();
    t.font = new Font("Menlo-Bold", 38);
    t.textColor = new Color(s.type === "focus" ? FOCUS_COLOR : BREAK_COLOR);
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
    const credited = stopTimer(data);
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
    await startTimer(data, options[choice].type, options[choice].minutes);
  } else {
    const input = new Alert();
    input.title = "Custom focus length";
    const field = input.addTextField("minutes", String(FOCUS_OPTIONS[0]));
    field.setNumberPadKeyboard();
    input.addAction("Start");
    input.addCancelAction("Cancel");
    if ((await input.presentAlert()) === 0) {
      const m = parseInt(input.textFieldValue(0), 10);
      if (m > 0 && m <= 240) await startTimer(data, "focus", m);
    }
  }
  await createWidget(load()).presentSmall();
}

const data = settle(load());
if (config.runsInWidget) {
  Script.setWidget(createWidget(data));
} else {
  await showMenu(data);
}
Script.complete();
