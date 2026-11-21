import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const scripts = ['Daily Log', 'Days Left', 'Focus Timer', 'Time Blindness + Sleep', 'Deadline Radar'];
export const source = name => readFile(new URL(`../${name}.js`, import.meta.url), 'utf8');
export const plain = value => JSON.parse(JSON.stringify(value));

export function storage() {
  const files = new Map(), evicted = new Map(), events = [];
  let failMove;
  let failListContents;
  const manager = root => ({
    documentsDirectory: () => root,
    joinPath: (a,b) => `${a}/${b}`,
    fileExists: p => files.has(p),
    isFileDownloaded: p => !evicted.has(p),
    async downloadFileFromiCloud(p) {
      events.push(['download',p]);
      await Promise.resolve(); // readString must not run before this completes.
      if (evicted.has(p)) {
        files.set(p,evicted.get(p)); evicted.delete(p);
        files.delete(`/cloud/.${p.split('/').pop()}.icloud`);
      }
    },
    readString(p) {
      events.push(['read',p]);
      if (evicted.has(p) || !files.has(p)) throw new Error(`Unavailable ${p}`);
      return files.get(p);
    },
    writeString(p,s) { events.push(['write',p]); files.set(p,s); },
    move(a,b) {
      events.push(['move',a,b]);
      if (failMove?.(a,b)) throw new Error('Injected move failure');
      if (!files.has(a) || files.has(b)) throw new Error('Unsafe move');
      files.set(b,files.get(a)); files.delete(a);
    },
    copy(a,b) {
      if (!files.has(a) || files.has(b)) throw new Error('Unsafe copy');
      files.set(b,files.get(a));
    },
    remove(p) { files.delete(p); },
    listContents(dir) {
      events.push(['listContents',dir]);
      if (failListContents) throw new Error('Injected listContents failure');
      const prefix = dir + '/'; // documentsDirectory() returns '/cloud' or '/local'
      return [...files.keys(), ...evicted.keys()]
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    }
  });
  return {
    files, events, FileManager: {iCloud:() => manager('/cloud'), local:() => manager('/local')},
    put(name,value,root='/cloud') { files.set(`${root}/${name}`,JSON.stringify(value)); },
    get(name,root='/cloud') { return JSON.parse(files.get(`${root}/${name}`)); },
    evict(name,value) { evicted.set(`/cloud/${name}`,JSON.stringify(value)); files.set(`/cloud/.${name}.icloud`,'placeholder'); },
    failMove(fn) { failMove = fn; },
    failListContents(fn) { failListContents = fn; }
  };
}

export async function run(name, {store=storage(), settings, now=Date.parse('2026-11-15T17:00:00Z'), boot=false, shortcut, parameter, code: codeOverride,
  family='medium', inApp=false, query, choices=[], calendars={}} = {}) {
  if (settings !== undefined) store.put('daybar-settings.json',settings);
  const notifications = [], widgets = [], output = [], presented = [], tables = [], alerts = [], opened = [];
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  class Element {
    constructor(text) { this.text = text; this.children = []; }
    addStack() { const child = new Element(); this.children.push(child); return child; }
    addText(text) { const child = new Element(text); this.children.push(child); return child; }
    addDate(date) { const child = this.addText(String(date)); child.applyTimerStyle = () => {}; return child; }
    addSpacer() {} setPadding() {} layoutHorizontally() {} layoutVertically() {} centerAlignContent() {}
    rightAlignText() {} rightAligned() {}
    async presentMedium() { presented.push(['medium',this]); } async presentSmall() { presented.push(['small',this]); }
    async presentLarge() { presented.push(['large',this]); }
  }
  // In-app screens: each Alert/UITable answer comes from `choices` in order (default: cancel).
  const next = () => choices.length ? choices.shift() : -1;
  class UITableRow {
    constructor() { this.cells = []; }
    addText(title, subtitle) { const cell = {title, subtitle, rightAligned() {}}; this.cells.push(cell); return cell; }
  }
  class UITable {
    constructor() { this.rows = []; }
    addRow(r) { this.rows.push(r); } removeAllRows() { this.rows = []; } reload() {}
    async present() {
      tables.push(this.rows.map(r => r.cells.map(c => [c.title, c.subtitle].filter(Boolean).join(' | ')).join(' ')));
      // a choice that is a string selects the first row whose title starts with it
      while (typeof choices[0] === 'string') {
        const want = choices.shift(), row = this.rows.find(r => r.cells[0]?.title?.startsWith(want));
        if (!row?.onSelect) throw new Error(`no selectable row: ${want}`);
        await row.onSelect();
        if (row.dismissOnSelect !== false) break;
      }
    }
  }
  class Notification {
    static async removePending(ids) { output.push(['removed',ids]); }
    setTriggerDate(d) { this.when = d.getTime(); }
    async schedule() { notifications.push(this); }
  }
  class Alert {
    constructor() { this.actions = []; }
    addAction(t) { this.actions.push(t); } addCancelAction() {} addDestructiveAction(t) { this.actions.push(t); }
    addTextField(_, value) { this.field = value; return {setNumberPadKeyboard() {}}; } textFieldValue() { return this.field; }
    pick() {
      alerts.push({title:this.title, message:this.message, actions:this.actions});
      const c = next();
      // a choice that is a string selects the action that starts with it
      return typeof c === 'string' ? this.actions.findIndex(a => a.startsWith(c)) : c;
    }
    async presentSheet() { return this.pick(); } async presentAlert() { return this.pick(); } async present() { return this.pick(); }
  }
  class Font { static systemFont() { return {}; } }
  const context = vm.createContext({
    FileManager:store.FileManager, Date:FakeDate, Font, Notification, Alert,
    Color:class { constructor(hex,opacity=1) { this.hex=hex; this.opacity=opacity; } static dynamic(light,dark) { return {hex:dark.hex,opacity:dark.opacity,light,dark}; } },
    UITable, UITableRow, Safari:{open:u => opened.push(u)},
    Size:class { constructor(width,height) { this.width=width; this.height=height; } },
    ListWidget:Element, DateFormatter:class { string(d) { return d.toISOString(); } },
    Calendar:{async forEvents() { return (calendars.events || []).map(e => e.calendar).filter((c,i,a) => a.indexOf(c) === i); }},
    CalendarEvent:{async between(from,to,cals) { return (calendars.events || []).filter(e => cals.includes(e.calendar) && e.startDate < to && e.endDate > from); }},
    Reminder:{async allIncomplete() { return calendars.reminders || []; }},
    Script:{setWidget:w => widgets.push(w), complete() {}, setShortcutOutput:v => output.push(v), name:() => name},
    args:{widgetParameter:parameter,shortcutParameter:shortcut,queryParameters:query || {}}, config:{runsInWidget:!inApp,widgetFamily:inApp ? undefined : family},
    console
  });
  let code = codeOverride !== undefined ? codeOverride : await source(name);
  const apis = {
    'Daily Log':'DB,loadLog,setTask,doneOn,dayColor,getStats,createWidget,editDay,showMenu,logFile,THEME,C,runURL,TASKS,TITLE,LOG_ID,DAY_COMPLETE_MIN,MAX_CELL_SIZE,PADDING,BORDER_RADIUS',
    'Days Left':'DB,createWidget,getStats,splitLeft,milestones,showDetails,addDays,daysBetween,START_DATE,END_DATE,TITLE,MAX_CELL_SIZE,PADDING,BORDER_RADIUS,THEME,C,runURL',
    'Focus Timer':'DB,load,settle,startTimer,stopTimer,completeLinkedTasks,createWidget,showMenu,menuOptions,lastFocus,THEME,C,runURL,BLOCK_MINUTES,FOCUS_OPTIONS,BREAK_OPTIONS,LONG_BREAK_OPTIONS,TITLE',
    'Time Blindness + Sleep':'DB,load,logWake,logBed,startPlan,stopPlan,clearSleep,ingest,parseWhen,resolveDates,findSleepSessions,circMean,currentState,addDays,daysBetween,createWidget,showMenu,quickAction,TITLE,AWAKE_HOURS,SLEEP_HOURS,STEP_MINUTES,AVERAGE_DAYS,THEME,C,runURL',
    'Deadline Radar':'getItems,createWidget,showList,label,itemDays,urgencyColor,openURL,daysUntil,TITLE,THEME,C,runURL'
  };
  if (!boot) {
    const marker = name === 'Focus Timer' ? 'const data = await settle();\nif (config.runsInWidget)' : name === 'Days Left' ? 'const widget = createWidget();\nif (config.runsInWidget)' : '// ---------- run ----------';
    const index = code.lastIndexOf(marker);
    if (index < 0) throw new Error(`Missing run boundary: ${name}`);
    // typeof-guarded so legacy sources without the Daybar boundary (e.g. no DB) can run too.
    code = code.slice(0,index) + `\nreturn {${apis[name].split(',').map(n => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(',')}};`;
  }
  const api = await new vm.Script(`(async () => {\n${code}\n})()`, {filename:name+'.js'}).runInContext(context);
  return {api,store,notifications,widgets,output,presented,tables,alerts,opened,advance(ms) { now += ms; }, date:s => new FakeDate(s)};
}

export function allText(element) {
  return [element.text, ...element.children.flatMap(allText)].filter(v => v !== undefined);
}

// Golden snapshot of a fake widget tree: every text plus each cell's color/opacity/size.
export function snapshot(element) {
  const bg = element.backgroundColor, fg = element.textColor;
  return {
    ...(element.text !== undefined ? {text: element.text} : {}),
    ...(bg ? {bg: [bg.hex, bg.opacity]} : {}),
    ...(fg ? {fg: [fg.hex, fg.opacity]} : {}),
    ...(element.size ? {size: [element.size.width, element.size.height]} : {}),
    ...(element.cornerRadius !== undefined ? {radius: element.cornerRadius} : {}),
    ...(element.spacing !== undefined ? {spacing: element.spacing} : {}),
    ...(element.refreshAfterDate ? {refresh: element.refreshAfterDate.getTime()} : {}),
    children: element.children.map(snapshot)
  };
}