// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: magic;
// Days Left Widget (Scriptable)
// GitHub-style grid counting down to an end date. Every square is one day.

// ================= SETTINGS =================
// Dates in YYYY-MM-DD
const START_DATE = "2026-09-09";
const END_DATE = "2027-05-24";
const TITLE = "End of University";

// Look
const BG_COLOR = "#0d1117";
const TEXT_COLOR = "#ffffff";
const DONE_COLOR = "#39d353";    // days already passed
const TODAY_COLOR = "#ffffff";   // today (fades in over the 24h day)
const REMAINING_COLOR = "#ffffff";
const REMAINING_OPACITY = 0.05;  // days still to come

// Layout
const ROWS = 7;
const MAX_CELL_SIZE = 10;        // cells shrink automatically to fit the range
const PADDING = 2;               // gap between cells
const BORDER_RADIUS = 2;
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
