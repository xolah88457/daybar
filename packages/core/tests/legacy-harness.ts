import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import type { Settings } from '../src/contracts';

export class WidgetNode {
  children: WidgetNode[] = [];
  text?: string;
  backgroundColor?: LegacyColor;
  size?: { width: number; height: number };
  addStack() { const node = new WidgetNode(); this.children.push(node); return node; }
  addText(text: string) { const node = this.addStack(); node.text = text; return node; }
  addDate() { return this.addStack(); }
  addSpacer() {}
  setPadding() {}
  layoutHorizontally() {}
  centerAlignContent() {}
  applyTimerStyle() {}
}
export class LegacyColor { constructor(public hex: string, public opacity = 1) {} }
class DateFormatter {
  dateFormat = '';
  string(d: Date) {
    if (this.dateFormat !== 'h:mm a') throw new Error(`Unsupported legacy format: ${this.dateFormat}`);
    return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
}

// Execute actual declarations, not hand-copied golden implementations. Nothing runs at module top level.
export function legacy(file: string, now: Date, settings: Settings, data: unknown = {}) {
  const source = readFileSync(fileURLToPath(new URL(`../../../legacy/${file}.js`, import.meta.url)), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = ast.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(ast)).join('\n');
  const h = settings.habits, s = settings.sleep, a = settings.appearance;
  const countdown = file === 'Days Left', focus = file === 'Focus Timer';
  const FixedDate = new Proxy(Date, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [now.getTime()]); },
    get(target, prop, receiver) { return prop === 'now' ? () => now.getTime() : Reflect.get(target, prop, receiver); }
  });
  const context = vm.createContext({
    Date: FixedDate, DateFormatter, ListWidget: WidgetNode, Color: LegacyColor,
    Font: class {}, Size: class { constructor(public width: number, public height: number) {} },
    MENLO: {}, MENLO_REGULAR: {}, MENLO_BOLD: {},
    START_DATE: countdown ? settings.countdown.startDate : h.startDate,
    END_DATE: countdown ? settings.countdown.endDate : h.endDate,
    TITLE: 'golden', TASKS: h.tasks, DAY_COMPLETE_MIN: h.dayCompleteMin,
    BG_COLOR: a.background, TEXT_COLOR: a.text, DONE_COLOR: a.green,
    TODAY_COLOR: a.text, REMAINING_COLOR: a.text, REMAINING_OPACITY: a.emptyOpacity,
    PARTIAL_COLORS: [a.red, a.orange, a.yellow], EMPTY_COLOR: a.text,
    EMPTY_OPACITY: a.emptyOpacity, MIN_DONE_OPACITY: a.minDoneOpacity, FUTURE_OPACITY: a.futureOpacity,
    ROWS: 7, MAX_CELL_SIZE: a.cellSize, CELL_SIZE: a.cellSize, PADDING: a.gap,
    BORDER_RADIUS: a.radius, SIDE_PADDING: 12, WIDGET_WIDTH: file === 'Daily Log' || focus ? 354 : 320,
    BLOCK_MINUTES: settings.focus.blockMinutes, FOCUS_COLOR: a.green, BREAK_COLOR: a.blue,
    FOCUS_OPTIONS: settings.focus.focusOptions, UNFILLED_COLOR: a.text, UNFILLED_OPACITY: a.futureOpacity,
    AWAKE_HOURS: s.awakeHours, SLEEP_HOURS: s.sleepHours, STALE_HOURS: s.awakeHours + 6,
    TARGET_WAKE: s.targetWake, TARGET_BED: s.targetBed, STEP_MINUTES: s.stepMinutes, AVERAGE_DAYS: s.averageDays,
    ROUTINE_MINUTES: s.routineMinutes, NO_PHONE_MINUTES: s.noPhoneMinutes,
    GOOD_COLOR: a.green, WARN_COLOR: a.yellow, URGENT_COLOR: a.red,
    DATA: data, logPath: '', dataPath: '',
    fm: { fileExists: () => true, readString: () => JSON.stringify(data) },
    Notification: { removePending() {} }
  });
  vm.runInContext(functions + '\nconst TW = toMinSafe(); function toMinSafe(){return typeof toMin === "function" ? toMin(TARGET_WAKE) : 480;} const TB = TARGET_BED && typeof toMin === "function" ? toMin(TARGET_BED) : typeof wrap === "function" ? wrap(TW - SLEEP_HOURS * 60) : 0;', context);
  vm.runInContext('if (typeof save === "function") save = () => {}; if (typeof scheduleBedAlerts === "function") scheduleBedAlerts = async () => {};', context);
  if (!countdown && !focus && file !== 'Daily Log') vm.runInContext('load = () => DATA;', context);
  return {
    call<T>(name: string, ...args: unknown[]): T {
      const fn = vm.runInContext(name, context) as (...values: unknown[]) => T;
      return fn(...args);
    },
    set(name: string, value: unknown) { context[name] = value; }
  };
}
export function gridColors(widget: WidgetNode) {
  return widget.children.slice(0, 7).flatMap(row => row.children.map(cell => cell.backgroundColor ? { color: cell.backgroundColor.hex, opacity: cell.backgroundColor.opacity } : null));
}
export function texts(widget: WidgetNode): string[] {
  return widget.children.flatMap(n => [...(n.text === undefined ? [] : [n.text]), ...texts(n)]);
}
