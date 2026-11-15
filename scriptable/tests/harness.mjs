import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const scripts = ['Daily Log', 'Days Left', 'Focus Timer', 'Time Blindness + Sleep', 'Deadline Radar'];
export const source = name => readFile(new URL(`../${name}.js`, import.meta.url), 'utf8');
export const plain = value => JSON.parse(JSON.stringify(value));

export function storage() {
  const files = new Map(), evicted = new Map(), events = [];
  let failMove;
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
    remove(p) { files.delete(p); }
  });
  return {
    files, events, FileManager: {iCloud:() => manager('/cloud'), local:() => manager('/local')},
    put(name,value,root='/cloud') { files.set(`${root}/${name}`,JSON.stringify(value)); },
    get(name,root='/cloud') { return JSON.parse(files.get(`${root}/${name}`)); },
    evict(name,value) { evicted.set(`/cloud/${name}`,JSON.stringify(value)); files.set(`/cloud/.${name}.icloud`,'placeholder'); },
    failMove(fn) { failMove = fn; }
  };
}

export async function run(name, {store=storage(), settings, now=Date.parse('2026-11-15T17:00:00Z'), boot=false, shortcut, parameter} = {}) {
  if (settings !== undefined) store.put('daybar-settings.json',settings);
  const notifications = [], widgets = [], output = [];
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
    rightAlignText() {} rightAligned() {} async presentMedium() {} async presentSmall() {}
  }
  class Notification {
    static async removePending(ids) { output.push(['removed',ids]); }
    setTriggerDate(d) { this.when = d.getTime(); }
    async schedule() { notifications.push(this); }
  }
  class Alert {
    addAction() {} addCancelAction() {} addDestructiveAction() {}
    async presentSheet() { return -1; } async presentAlert() { return -1; } async present() { return -1; }
  }
  class Font { static systemFont() { return {}; } }
  const context = vm.createContext({
    FileManager:store.FileManager, Date:FakeDate, Font, Notification, Alert,
    Color:class { constructor(hex,opacity=1) { this.hex=hex; this.opacity=opacity; } },
    Size:class { constructor(width,height) { this.width=width; this.height=height; } },
    ListWidget:Element, DateFormatter:class { string(d) { return d.toISOString(); } },
    Calendar:{async forEvents() { return []; }}, CalendarEvent:{async between() { return []; }},
    Reminder:{async allIncomplete() { return []; }},
    Script:{setWidget:w => widgets.push(w), complete() {}, setShortcutOutput:v => output.push(v)},
    args:{widgetParameter:parameter,shortcutParameter:shortcut}, config:{runsInWidget:true,widgetFamily:'medium'},
    console
  });
  let code = await source(name);
  const apis = {
    'Daily Log':'DB,loadLog,setTask,doneOn,dayColor,getStats,createWidget,TASKS,TITLE,LOG_ID,DAY_COMPLETE_MIN,MAX_CELL_SIZE,PADDING,BORDER_RADIUS',
    'Days Left':'DB,createWidget,addDays,daysBetween,START_DATE,END_DATE,TITLE,MAX_CELL_SIZE,PADDING,BORDER_RADIUS',
    'Focus Timer':'DB,load,settle,startTimer,stopTimer,completeLinkedTasks,createWidget,BLOCK_MINUTES,FOCUS_OPTIONS,BREAK_OPTIONS,LONG_BREAK_OPTIONS,TITLE',
    'Time Blindness + Sleep':'DB,load,logWake,logBed,startPlan,stopPlan,clearSleep,ingest,parseWhen,resolveDates,findSleepSessions,circMean,currentState,addDays,daysBetween,createWidget,TITLE,AWAKE_HOURS,SLEEP_HOURS,STEP_MINUTES,AVERAGE_DAYS'
  };
  if (!boot) {
    const marker = name === 'Focus Timer' ? 'const data = await settle();\nif (config.runsInWidget)' : name === 'Days Left' ? 'const widget = createWidget();\nif (config.runsInWidget)' : '// ---------- run ----------';
    const index = code.lastIndexOf(marker);
    if (index < 0) throw new Error(`Missing run boundary: ${name}`);
    code = code.slice(0,index) + `\nreturn {${apis[name]}};`;
  }
  const api = await new vm.Script(`(async () => {\n${code}\n})()`, {filename:name+'.js'}).runInContext(context);
  return {api,store,notifications,widgets,output,advance(ms) { now += ms; }, date:s => new FakeDate(s)};
}

export function allText(element) {
  return [element.text, ...element.children.flatMap(allText)].filter(v => v !== undefined);
}
