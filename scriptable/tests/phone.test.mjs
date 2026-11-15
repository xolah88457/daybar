import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {scripts,source,storage,run,plain,allText,snapshot} from './harness.mjs';

const day = '2026-11-15';
const defaults = ['Coursework','Live Trading','Trade Review','Apostles work'];
const emptySleep = () => ({wakes:{},beds:{},plan:null});
const cases = [
  ['Daily Log','daily-log-Daily_Tasks.json',{}, api => api.loadLog()],
  ['Focus Timer','focus-timer.json',{state:null,days:{}}, api => api.load()],
  ['Time Blindness + Sleep','sleep-data.json',emptySleep(), api => api.load()]
];

for (const name of scripts) test(`${name}: header and asynchronous Scriptable syntax`, async () => {
  const code = await source(name);
  assert.ok(code.startsWith('// Variables used by Scriptable.\n// These must be at the very top'));
  assert.doesNotThrow(() => new vm.Script(`(async () => {${code}\n})()`));
});
test('Deadline Radar is byte-identical to legacy', async () => {
  assert.equal(await source('Deadline Radar'),await readFile(new URL('../../legacy/Deadline Radar.js',import.meta.url),'utf8'));
});
for (const name of scripts) test(`${name}: full widget entry point runs`, async () => {
  const r = await run(name,{boot:true});
  assert.equal(r.widgets.length,1);
});

for (const name of scripts.slice(0,4)) {
  test(`${name}: settings per-key fallback and unknown/malformed rejection`, async () => {
    const r = await run(name,{settings:{schemaVersion:1,appearance:{green:'#123456'},focus:{blockMinutes:30}}});
    if (name === 'Daily Log') assert.deepEqual(plain(r.api.TASKS),defaults);
    assert.equal(r.api.TITLE,({'Daily Log':'Daily Tasks','Days Left':'End of University','Focus Timer':'Focus','Time Blindness + Sleep':'Time'})[name]);
    if (name === 'Focus Timer') assert.equal(r.api.BLOCK_MINUTES,30);
    for (const settings of [{schemaVersion:2},{focus:{BLOCK_MINUTES:20}},{sleep:{awakeHours:null}},{appearance:{rows:6}},{habits:{tasks:['A'],dayCompleteMin:2}},{sleep:{routineMinutes:10}}]) {
      const store = storage(); store.put('daybar-settings.json',settings);
      const before = store.files.get('/cloud/daybar-settings.json');
      await assert.rejects(run(name,{store}));
      assert.equal(store.files.get('/cloud/daybar-settings.json'),before);
      assert.equal(store.events.filter(e => e[0] === 'write').length,0);
    }
    const store = storage(); store.files.set('/cloud/daybar-settings.json','{broken');
    await assert.rejects(run(name,{store}));
    assert.equal(store.files.get('/cloud/daybar-settings.json'),'{broken');
  });
  test(`${name}: awaits evicted settings`, async () => {
    const store = storage(); store.evict('daybar-settings.json',{schemaVersion:1});
    await run(name,{store});
    assert.deepEqual(store.events.slice(0,2),[['download','/cloud/daybar-settings.json'],['read','/cloud/daybar-settings.json']]);
  });
}

for (const [name,file,empty,load] of cases) {
  test(`${name}: migrate local once; canonical and placeholder always win`, async () => {
    const local = name === 'Daily Log' ? {[day]:['Coursework']} : name === 'Focus Timer' ? {state:null,days:{[day]:{count:1,minutes:25}}} : {wakes:{[day]:480},beds:{},plan:null};
    const store = storage(); store.put(file,local,'/local');
    const {api} = await run(name,{store});
    await load(api);
    assert.deepEqual(store.get(file),local);
    assert.deepEqual(store.get(file,'/local'),local);
    store.put(file,empty);
    await load(api);
    assert.deepEqual(store.get(file),empty);
    store.files.delete('/cloud/'+file); store.evict(file,empty);
    await load(api);
    assert.deepEqual(store.get(file),empty);
    assert.ok(store.events.some(e => e[0] === 'download' && e[1] === '/cloud/'+file));
  });
  test(`${name}: malformed/unknown data is never replaced, including local migration`, async () => {
    for (const root of ['/cloud','/local']) for (const raw of ['{bad','null','{"unexpected":true}']) {
      const store = storage(); store.files.set(`${root}/${file}`,raw);
      const {api} = await run(name,{store});
      await assert.rejects(load(api));
      await assert.rejects(api.DB.mutate(file,name === 'Daily Log' ? 'log' : name === 'Focus Timer' ? 'focus' : 'sleep',() => empty,() => empty));
      assert.equal(store.files.get(`${root}/${file}`),raw);
      assert.equal(store.events.filter(e => e[0] === 'write').length,0);
    }
  });
}

test('Daily Log: legacy array, task colors and settings, separate log id, stale edits preserve newer days/tasks', async () => {
  const r = await run('Daily Log',{settings:{habits:{title:'Custom',tasks:['A','B','C','D'],logId:'stable',dayCompleteMin:2},appearance:{green:'#123456',red:'#112233',orange:'#223344',yellow:'#334455',cellSize:14,gap:3,radius:4}}});
  assert.equal(r.api.LOG_ID,'stable'); assert.equal(r.api.TITLE,'Custom');
  assert.equal(r.api.DAY_COMPLETE_MIN,2); assert.equal(r.api.MAX_CELL_SIZE,14); assert.equal(r.api.PADDING,3); assert.equal(r.api.BORDER_RADIUS,4);
  assert.equal(r.api.dayColor(1),'#112233'); assert.equal(r.api.dayColor(2),'#223344'); assert.equal(r.api.dayColor(3),'#334455'); assert.equal(r.api.dayColor(4),'#123456');
  r.store.put('daily-log-stable.json',[day]);
  assert.deepEqual(plain(await r.api.loadLog()),{[day]:['A','B','C','D']});
  await r.api.setTask(day,'A',false);
  const current = r.store.get('daily-log-stable.json'); current['2026-11-14'] = ['C']; current[day].push('archived'); r.store.put('daily-log-stable.json',current);
  await r.api.setTask(day,'B',false);
  await r.api.setTask(day,'B',false); // Replaying the same user intent must not toggle back.
  assert.deepEqual(r.store.get('daily-log-stable.json'),{[day]:['C','D','archived'],'2026-11-14':['C']});
  assert.deepEqual(plain(r.api.doneOn(r.store.get('daily-log-stable.json'),day)),['C','D']);
  const separate = await run('Daily Log',{store:r.store,parameter:'Other Log!'});
  await separate.api.setTask(day,'A',true);
  assert.deepEqual(r.store.get('daily-log-Other_Log_.json'),{[day]:['A']});
});

test('Storage: changed-after-read aborts rather than losing a concurrent edit', async () => {
  const {api,store} = await run('Daily Log');
  store.put('daily-log-Daily_Tasks.json',{});
  await assert.rejects(api.DB.mutate('daily-log-Daily_Tasks.json','log',() => ({}), async log => {
    log[day] = ['Coursework'];
    store.put('daily-log-Daily_Tasks.json',{'2026-11-14':['Trade Review']});
    return log;
  }),/changed during edit/);
  assert.deepEqual(store.get('daily-log-Daily_Tasks.json'),{'2026-11-14':['Trade Review']});
});
test('Storage: failed replacement restores original and leaves recovery backup', async () => {
  const {api,store} = await run('Daily Log');
  const old = {[day]:['Trade Review']}; store.put('daily-log-Daily_Tasks.json',old);
  store.failMove((from) => from.includes('.daybar-temp-'));
  await assert.rejects(api.setTask(day,'Coursework',true),/original retained/);
  assert.deepEqual(store.get('daily-log-Daily_Tasks.json'),old);
  assert.ok([...store.files.keys()].some(p => p.includes('.daybar-backup-')));
});

test('Focus: legacy baseline, duplicate settlement, partial credits add into blocks, task thresholds', async () => {
  const r = await run('Focus Timer',{settings:{focus:{blockMinutes:25,alerts:false},habits:{tasks:['A'],focusThresholds:{A:25}}}});
  // Legacy data: no sessions, no baseline - valid for upgrade
  r.store.put('focus-timer.json',{state:null,days:{[day]:{count:2,minutes:50}}});
  await r.api.startTimer('focus',36,'A'); r.advance(36*60000);
  let data = await r.api.settle();
  assert.equal(data.days[day].minutes,86); assert.equal(data.days[day].count,3);
  assert.equal(data.baseline[day].minutes,50);
  const [id,session] = Object.entries(data.sessions)[0];
  assert.deepEqual(plain(session),{type:'focus',minutes:36,creditedMinutes:36,end:Number(id)+36*60000,date:day,task:'A'});
  assert.deepEqual(r.store.get('daily-log-Daily_Tasks.json'),{[day]:['A']});
  assert.equal(r.notifications.length,0);
  const writes = r.store.events.filter(e => e[0] === 'write').length;
  await r.api.settle();
  assert.equal(r.store.events.filter(e => e[0] === 'write').length,writes);
  // Simulate a stale device reintroducing state for the same already-credited key.
  data.state = {type:'focus',minutes:36,start:Number(id),end:session.end,task:'A'};
  r.store.put('focus-timer.json',data);
  data = await r.api.settle(); assert.equal(data.days[day].minutes,86);
  r.advance(1); data = await r.api.startTimer('focus',25); const start = data.state.start;
  r.advance(14*60000+59000); assert.equal(await r.api.stopTimer(start),14);
  assert.equal(await r.api.stopTimer(start),0);
  data = await r.api.load(); assert.equal(data.days[day].minutes,100); assert.equal(data.days[day].count,4);
  assert.equal(Object.keys(data.sessions).length,2);
});

test('Focus: stop under one minute, break records, stale stop/start guards and notifications', async () => {
  const r = await run('Focus Timer');
  let data = await r.api.startTimer('focus',25);
  await assert.rejects(r.api.startTimer('break',5),/already running/);
  r.advance(59000); assert.equal(await r.api.stopTimer(data.state.start),0);
  data = await r.api.startTimer('break',5); const start = data.state.start;
  await assert.rejects(r.api.stopTimer(start-1),/Timer changed/);
  r.advance(5*60000); data = await r.api.settle();
  assert.equal(data.sessions[String(start)].creditedMinutes,0);
  assert.equal(Object.keys(data.days).length,0);
  assert.equal(r.notifications.length,2);
});

test('Focus: completed cross-midnight sessions go to end date; early stop uses stop date and latest file', async () => {
  const r = await run('Focus Timer',{now:new Date(2026,10,14,23,50).getTime()});
  let data = await r.api.startTimer('focus',25); r.advance(25*60000);
  data = await r.api.settle(); assert.equal(data.days[day].minutes,25);
  data = await r.api.startTimer('focus',25); const start=data.state.start;
  const external = r.store.get('focus-timer.json'); external.baseline['2026-11-13']={minutes:11,count:0}; r.store.put('focus-timer.json',external);
  r.advance(2*60000); await r.api.stopTimer(start);
  data=await r.api.load(); assert.equal(data.days['2026-11-13'].minutes,11); assert.equal(data.days[day].minutes,27);
});

test('Sleep: re-read logging, after-midnight attribution, latest plan baseline and safe stop/clear', async () => {
  const r = await run('Time Blindness + Sleep');
  await r.api.logWake(r.date('2026-11-15T08:00:00'));
  const external = r.store.get('sleep-data.json'); external.wakes['2026-11-14']=600; r.store.put('sleep-data.json',external);
  await r.api.logBed(r.date('2026-11-15T01:30:00'));
  let data = await r.api.startPlan();
  assert.equal(data.beds['2026-11-14'],90); assert.equal(data.wakes[day],480); assert.equal(data.plan.wake,540);
  data = await r.api.stopPlan(); assert.equal(data.plan,null); assert.equal(data.wakes['2026-11-14'],600);
  assert.deepEqual(plain(await r.api.clearSleep()),emptySleep());
});

test('Sleep Shortcut: dictionary, JSON, plain wake, time-only, skipped old bed, all segments and idempotent repeat', async () => {
  const r = await run('Time Blindness + Sleep',{now:new Date(2026,10,15,12).getTime()});
  await r.api.ingest({wake:'2026-11-15T08:00:00',bed:'2026-11-15T01:00:00'});
  assert.equal(r.store.get('sleep-data.json').beds['2026-11-14'],60);
  await r.api.ingest(JSON.stringify({wake:'08:10',bed:'00:30'}));
  assert.equal(r.store.get('sleep-data.json').wakes[day],490);
  await r.api.ingest('08:20'); assert.equal(r.store.get('sleep-data.json').wakes[day],500);
  const result = await r.api.ingest({wake:'2026-11-15T08:00:00',bed:'2026-11-13T23:00:00'});
  assert.match(result,/skipped/);
  const segments = {starts:['2026-11-13T23:00:00','2026-11-14T03:00:00','2026-11-15T01:00:00'],ends:['2026-11-14T02:30:00','2026-11-14T07:00:00','2026-11-15T08:00:00']};
  await r.api.ingest(segments); const saved = r.store.files.get('/cloud/sleep-data.json');
  await r.api.ingest(segments); assert.equal(r.store.files.get('/cloud/sleep-data.json'),saved);
  assert.equal(r.store.get('sleep-data.json').beds['2026-11-13'],1380);
  assert.equal(r.store.get('sleep-data.json').wakes['2026-11-14'],420);
  const boot = await run('Time Blindness + Sleep',{boot:true,shortcut:{wake:'2026-11-15T08:00:00'}});
  assert.equal(boot.widgets.length,0); assert.match(boot.output[0],/wake/);
});

test('DST: calendar day math, after-midnight bed, circular average and estimated wake', async () => {
  const r = await run('Time Blindness + Sleep');
  for (const date of ['2026-03-08T00:00:00','2026-11-01T00:00:00']) {
    const d = r.date(date), next = r.api.addDays(d,1);
    assert.equal(r.api.daysBetween(next,d),1);
    await r.api.logBed(r.date(date.slice(0,10)+'T01:30:00'));
    const prev = r.api.addDays(d,-1);
    const key = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`;
    assert.equal(r.store.get('sleep-data.json').beds[key],90);
  }
  assert.equal(r.api.circMean([1430,10]),0);
  const state = r.api.currentState(emptySleep(),r.date('2026-11-15T06:00:00'));
  assert.equal(state.asleep,true); assert.equal(state.logged,false);
  const dates = r.api.resolveDates(['23:00','01:00','07:00'],r.date('2026-11-15T12:00:00'));
  assert.ok(dates[0] < dates[1] && dates[1] < dates[2]);
});

test('Sleep settings control plan, awake duration, average window, alert toggles and phase timings', async () => {
  const settings = {sleep:{title:'Rest',awakeHours:14,sleepHours:9,targetWake:'09:00',targetBed:'23:30',stepMinutes:30,averageDays:1,bedtimeAlerts:false,routineMinutes:90,noPhoneMinutes:20},appearance:{green:'#112233',yellow:'#223344',red:'#334455'}};
  const r = await run('Time Blindness + Sleep',{settings,now:new Date(2026,10,15,21,45).getTime()});
  assert.equal(r.api.TITLE,'Rest'); assert.equal(r.api.AWAKE_HOURS,14); assert.equal(r.api.SLEEP_HOURS,9); assert.equal(r.api.STEP_MINUTES,30); assert.equal(r.api.AVERAGE_DAYS,1);
  r.store.put('sleep-data.json',{wakes:{'2026-11-14':600,[day]:480},beds:{},plan:null});
  const plan = await r.api.startPlan(); assert.equal(plan.plan.wake,480);
  await r.api.stopPlan();
  const widget = await r.api.createWidget();
  assert.ok(allText(widget).includes('No phone time')); assert.equal(r.notifications.length,0);
  const enabled = await run('Time Blindness + Sleep',{settings:{sleep:{bedtimeAlerts:true,routineMinutes:90,noPhoneMinutes:20}},now:new Date(2026,10,15,12).getTime()});
  await enabled.api.createWidget();
  assert.equal(enabled.notifications.length,3);
  assert.equal(enabled.notifications[2].when-enabled.notifications[0].when,90*60000);
  assert.equal(enabled.notifications[2].when-enabled.notifications[1].when,20*60000);
});

test('Focus: tagged sessions without baseline do not manufacture one from derived days', async () => {
  const r = await run('Focus Timer');
  const start=Date.parse('2026-11-15T12:00:00Z');
  // Valid fixture: days matches derived from sessions (no baseline)
  r.store.put('focus-timer.json',{state:null,days:{[day]:{count:1,minutes:25}},sessions:{[start]:{type:'focus',minutes:25,creditedMinutes:25,end:start+1500000,date:day}}});
  const data = await r.api.load(); assert.equal(data.days[day].minutes,25);
  await r.api.startTimer('focus',25);
  const saved=r.store.get('focus-timer.json'); assert.equal(saved.baseline,undefined);
});

// ===== Cross-client focus integrity (parity with core contracts focusDataSchema / normalizeFocus) =====
const fstart = Date.parse('2026-11-15T12:00:00Z'); // 2026-11-15 12:00 UTC
const fsession = () => ({type:'focus',minutes:25,creditedMinutes:25,end:fstart+25*60000,date:day});
const fdata = () => ({state:null,days:{[day]:{count:1,minutes:25}},sessions:{[fstart]:fsession()}});

test('Focus integrity: malformed timer/key/end/credit/date/overflow/untracked history fail closed and preserve the file', async () => {
  const mutations = {
    'timer duration mismatch': d => { d.state = {type:'focus',minutes:25,start:fstart,end:fstart+1}; },
    'leading-zero session key': d => { d.sessions = {['0'+fstart]: d.sessions[fstart]}; },
    'non-numeric session key': d => { d.sessions = {'12x': d.sessions[fstart]}; },
    'session key beyond safe integer': d => { d.sessions = {['9007199254740993']: d.sessions[fstart]}; },
    'end before key start': d => { d.sessions[fstart].end = fstart - 1; },
    'end after planned duration': d => { d.sessions[fstart].end = fstart + 25*60000 + 1; },
    'credit exceeds elapsed whole minutes': d => { d.sessions[fstart].end = fstart + 119999; },
    'date beyond UTC ±1 day': d => { d.sessions[fstart].date = '2026-11-17'; },
    'derived total overflows u32': d => { d.baseline = {[day]:{count:0,minutes:4294967295}}; d.sessions[fstart].creditedMinutes = 1; d.sessions[fstart].end = fstart + 60000; d.days = {[day]:{count:0,minutes:1}}; },
    'stored day minutes beyond u32': d => { d.days = {[day]:{count:0,minutes:4294967296}}; },
    'untracked history with empty ledger (no baseline guessing)': d => { d.sessions = {}; },
    'saved days exceed derived ledger': d => { d.days = {[day]:{count:2,minutes:26}}; },
    'legacy baseline disagrees with days': d => { delete d.sessions; d.baseline = {[day]:{count:2,minutes:49}}; }
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const r = await run('Focus Timer');
    const data = fdata(); mutate(data);
    const raw = JSON.stringify(data);
    r.store.files.set('/cloud/focus-timer.json', raw);
    await assert.rejects(r.api.load(), /Invalid\/unknown focus file/, label);
    assert.equal(r.store.files.get('/cloud/focus-timer.json'), raw, label);
    assert.equal(r.store.events.filter(e => e[0] === 'write').length, 0, label);
  }
});

test('Focus integrity: ±1 UTC-day cross-zone dates, explained ledger without baseline and stale lower summaries are accepted', async () => {
  // A session end on 2026-11-15 UTC may be recorded on a neighbouring UTC day (other-timezone writer).
  for (const recorded of ['2026-11-14', day, '2026-11-16']) {
    const r = await run('Focus Timer');
    r.store.put('focus-timer.json', {state:null,days:{[recorded]:{count:1,minutes:25}},sessions:{[fstart]:{...fsession(),date:recorded}}});
    const data = await r.api.load();
    assert.equal(data.days[recorded].minutes, 25, recorded);
    assert.equal(r.store.get('focus-timer.json').baseline, undefined, recorded);
  }
  // Explained ledger without baseline: days exactly match derived session credits.
  const r = await run('Focus Timer');
  assert.equal(r.api.DB.valid('focus', fdata()), true);
  r.store.put('focus-timer.json', fdata());
  const data = await r.api.load();
  assert.equal(data.days[day].minutes, 25);
  assert.equal(r.store.get('focus-timer.json').baseline, undefined);
  // Stale LOWER summary stays valid and is regenerated from the ledger without losing credit; load never rewrites the file.
  const stale = fdata(); stale.days = {};
  r.store.put('focus-timer.json', stale);
  const fixed = await r.api.load();
  assert.deepEqual(plain(fixed.days), {[day]:{count:1,minutes:25}});
  assert.deepEqual(plain(r.store.get('focus-timer.json').days), {});
  // Legacy data (no sessions, no baseline) and its exactly-once baseline capture remain valid.
  assert.equal(r.api.DB.valid('focus', {state:null,days:{[day]:{count:2,minutes:50}}}), true);
  assert.equal(r.api.DB.valid('focus', {state:null,days:{[day]:{count:2,minutes:50}},sessions:{},baseline:{[day]:{count:2,minutes:50}}}), true);
});

test('Focus: habit failure preserves credited session; next settle repairs link without duplicate minutes', async () => {
  const r = await run('Focus Timer',{settings:{habits:{tasks:['A'],focusThresholds:{A:1}}}});
  await r.api.startTimer('focus',1,'A'); r.advance(60000);
  r.store.files.set('/cloud/daily-log-Daily_Tasks.json','{bad');
  await assert.rejects(r.api.settle());
  assert.equal(r.store.get('focus-timer.json').days[day].minutes,1);
  assert.equal(r.store.files.get('/cloud/daily-log-Daily_Tasks.json'),'{bad');
  r.store.put('daily-log-Daily_Tasks.json',{});
  await r.api.settle();
  assert.equal(r.store.get('focus-timer.json').days[day].minutes,1);
  assert.deepEqual(r.store.get('daily-log-Daily_Tasks.json'),{[day]:['A']});
});

test('Countdown and focus widgets apply colors/grid; focus countdown never becomes negative', async () => {
  const settings = {countdown:{title:'Semester'},appearance:{background:'#112233',text:'#abcdef',green:'#445566',cellSize:14,gap:3,radius:4}};
  const c = await run('Days Left',{settings}); const w = c.api.createWidget();
  assert.equal(w.backgroundColor.hex,'#112233'); assert.equal(c.api.MAX_CELL_SIZE,14); assert.equal(c.api.PADDING,3); assert.equal(c.api.BORDER_RADIUS,4);
  assert.ok(allText(w).includes('Semester'));
  const f = await run('Focus Timer',{settings:{focus:{focusOptions:[40],breakOptions:[7],longBreakOptions:[20]},appearance:settings.appearance}});
  assert.deepEqual(plain(f.api.FOCUS_OPTIONS),[40]); assert.deepEqual(plain(f.api.BREAK_OPTIONS),[7]); assert.deepEqual(plain(f.api.LONG_BREAK_OPTIONS),[20]);
  const data = await f.api.startTimer('focus',1); f.advance(61000);
  assert.ok(allText(f.api.createWidget(data)).includes('0:00'));
});

test('Days Left: golden VM parity with the legacy file on 23h/25h DST days and midnight', async () => {
  // Run the actual legacy source (not a reimplementation) through the same harness VM.
  const legacyCode = await readFile(new URL('../../legacy/Days Left.js', import.meta.url), 'utf8');
  // Local calendar days inside the default range [2026-09-09, 2027-05-24]. The DST dates are
  // America/Toronto's (2026-11-01 fall back, 2027-03-14 spring forward) and Europe/London's
  // (2026-10-25 fall back, 2027-03-28 spring forward), so under either test TZ the set below
  // covers a 25h, a 24h and a 23h local day.
  const local = (y,m,d,h=12,mi=0) => new Date(y,m-1,d,h,mi).getTime();
  const instants = [
    ['harness default', Date.parse('2026-11-15T17:00:00Z')],
    ['midnight normal day', local(2026,11,15,0,0)],
    ['first grid day midnight', local(2026,9,9,0,0)],
    ['last grid day late', local(2027,5,24,23,59)],
    ['Toronto fall-back midnight (25h day)', local(2026,11,1,0,0)],
    ['Toronto fall-back late (25h day)', local(2026,11,1,23,30)],
    ['London fall-back late (25h day)', local(2026,10,25,23,30)],
    ['Toronto spring-forward midnight (23h day)', local(2027,3,14,0,0)],
    ['Toronto spring-forward late (23h day)', local(2027,3,14,23,30)],
    ['London spring-forward late (23h day)', local(2027,3,28,23,30)]
  ];
  const dayLength = ms => { const d = new Date(ms), a = new Date(d.getFullYear(),d.getMonth(),d.getDate()), b = new Date(d.getFullYear(),d.getMonth(),d.getDate()+1); return b - a; };
  const lengths = [...new Set(instants.map(([,ms]) => dayLength(ms)))];
  // Where the test TZ observes DST on the chosen dates, both a 23h and a 25h local day must be exercised.
  if (lengths.some(l => l !== 86400000)) {
    assert.ok(lengths.includes(82800000) && lengths.includes(90000000),
      `expected 23h and 25h local days to be exercised in this DST-observing TZ, got ${lengths}`);
  }
  for (const [label, now] of instants) {
    const updated = await run('Days Left', {now});
    const legacy = await run('Days Left', {now, code: legacyCode});
    assert.deepEqual(snapshot(updated.api.createWidget()), snapshot(legacy.api.createWidget()),
      `golden widget mismatch at ${label} (${new Date(now).toString()}, local day ${dayLength(now)/3600000}h)`);
    assert.deepEqual(allText(updated.api.createWidget()), allText(legacy.api.createWidget()), `footer mismatch at ${label}`);
  }
});

// ===== Crash-window recovery regression tests =====

function crashState(store, file, latest) {
  // Emulate: commit() did fm.move(canonical -> .daybar-backup-*) then process died before fm.move(temp -> canonical)
  store.files.set(`/cloud/${file}.daybar-backup-crash1`, JSON.stringify(latest));
  store.files.delete(`/cloud/${file}`);
}

test('Daily Log: crash window with backup + stale local read throws and names recovery files', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  const LATEST = {[day]: ['Coursework', 'Live Trading']};
  const STALE_LOCAL = {[day]: ['Coursework']};
  crashState(store, 'daily-log-Daily_Tasks.json', LATEST);
  store.put('daily-log-Daily_Tasks.json', STALE_LOCAL, '/local');
  await assert.rejects(api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({})), /Unrecovered interrupted write/);
  await assert.rejects(api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({})), /daybar-backup-crash1/);
  // Local file unchanged, canonical still absent
  assert.deepEqual(store.get('daily-log-Daily_Tasks.json', '/local'), STALE_LOCAL);
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
});

test('Daily Log: crash window with backup + no local mutate throws', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  const LATEST = {[day]: ['Coursework', 'Live Trading']};
  crashState(store, 'daily-log-Daily_Tasks.json', LATEST);
  await assert.rejects(
    api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; }),
    /Unrecovered interrupted write/
  );
  await assert.rejects(
    api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; }),
    /daybar-backup-crash1/
  );
  // Canonical still absent, backup remains
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
  assert.ok([...store.files.keys()].some(k => k.includes('daybar-backup-crash1')));
});

test('Focus Timer: crash window load throws', async () => {
  const {api, store} = await run('Focus Timer', {boot: false});
  const LATEST = {state: null, days: {[day]: {count: 4, minutes: 100}}, sessions: {}, baseline: {}};
  crashState(store, 'focus-timer.json', LATEST);
  await assert.rejects(api.load(), /Unrecovered interrupted write/);
  await assert.rejects(api.load(), /daybar-backup-crash1/);
  assert.equal(store.files.has('/cloud/focus-timer.json'), false);
});

test('Daily Log: orphan temp without canonical throws', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  // Orphan temp (no backup, no canonical)
  store.files.set('/cloud/daily-log-Daily_Tasks.json.daybar-temp-orphan1', JSON.stringify({[day]: ['Coursework']}));
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  await assert.rejects(api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({})), /Unrecovered interrupted write/);
  await assert.rejects(api.DB.read('daily-log-Daily_Tasks.json', 'log', () => () => ({})), /daybar-temp-orphan1/);
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
});

test('Daily Log: wrong-name artifacts do not block mutate create', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  // Backup for a different log file
  store.files.set('/cloud/daily-log-Other_Log.json.daybar-backup-crash1', JSON.stringify({'2026-11-10': ['Other']}));
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // Should work normally - create fresh canonical from empty via mutate
  const log = await api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; });
  assert.deepEqual(plain(log), {[day]: ['Coursework']});
  assert.deepEqual(plain(store.get('daily-log-Daily_Tasks.json')), {[day]: ['Coursework']});
  // Wrong-name backup still there
  assert.ok(store.files.has('/cloud/daily-log-Other_Log.json.daybar-backup-crash1'));
});

test('Daily Log: normal fresh migration still works when no artifacts', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.put('daily-log-Daily_Tasks.json', {[day]: ['Coursework']}, '/local');
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // read() returns migrated value but does not create canonical; mutate does
  const log = await api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; });
  assert.deepEqual(plain(log), {[day]: ['Coursework']});
  assert.deepEqual(plain(store.get('daily-log-Daily_Tasks.json')), {[day]: ['Coursework']});
});

test('Daily Log: evicted placeholder still wins over artifacts', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  // Canonical evicted (placeholder exists) + backup artifact
  store.evict('daily-log-Daily_Tasks.json', {[day]: ['CloudData']});
  store.files.set('/cloud/daily-log-Daily_Tasks.json.daybar-backup-crash1', JSON.stringify({[day]: ['BackupData']}));
  // Should download and use canonical, not throw
  const log = await api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({}));
  assert.deepEqual(plain(log.value), {[day]: ['CloudData']});
  // Canonical should now be downloaded and present
  assert.deepEqual(plain(store.get('daily-log-Daily_Tasks.json')), {[day]: ['CloudData']});
});

test('Focus Timer: commit create path (expected===null) rechecks artifacts at last safe boundary', async () => {
  const {api, store} = await run('Focus Timer', {boot: false});
  store.files.delete('/cloud/focus-timer.json');
  // First, a normal create should work
  await api.startTimer('focus', 25);
  assert.ok(store.files.has('/cloud/focus-timer.json'));
  // Now simulate: canonical absent, backup exists
  const current = store.get('focus-timer.json');
  store.files.set('/cloud/focus-timer.json.daybar-backup-crash2', JSON.stringify(current));
  store.files.delete('/cloud/focus-timer.json');
  // Mutate with expected===null (create path) should throw
  await assert.rejects(
    api.DB.mutate('focus-timer.json', 'focus', () => ({state:null,days:{}}), d => d),
    /Unrecovered interrupted write/
  );
});

// Commit recheck is tested indirectly via mutate tests (e.g., 'Focus Timer: commit create path')
// since commit() is not part of the public DB API.

test('Sleep: crash window with backup throws on load', async () => {
  const {api, store} = await run('Time Blindness + Sleep', {boot: false});
  const LATEST = {wakes: {[day]: 480}, beds: {}, plan: null};
  crashState(store, 'sleep-data.json', LATEST);
  await assert.rejects(api.load(), /Unrecovered interrupted write/);
  await assert.rejects(api.load(), /daybar-backup-crash1/);
  assert.equal(store.files.has('/cloud/sleep-data.json'), false);
});

test('Days Left: crash window with backup throws on read', async () => {
  const {api, store} = await run('Days Left', {boot: false});
  const LATEST = {dummy: 'data'}; // Days Left doesn't have a data file but uses settings
  crashState(store, 'daybar-settings.json', LATEST);
  // Days Left reads settings, should throw
  await assert.rejects(run('Days Left', {store, boot: false}), /Unrecovered interrupted write/);
  await assert.rejects(run('Days Left', {store, boot: false}), /daybar-backup-crash1/);
});

// ===== Additional safety-gap regression tests =====

test('Daily Log: listContents failure fails closed with actionable error', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  store.failListContents(() => true);
  await assert.rejects(
    api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({})),
    /Cannot list iCloud directory to check for interrupted writes/)
  // Files unchanged
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
  store.failListContents(() => false);
});

test('Daily Log: evicted backup placeholder (.icloud) detected and blocks', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // Simulate evicted backup: .daily-log-Daily_Tasks.json.daybar-backup-abc.icloud
  store.files.set('/cloud/.daily-log-Daily_Tasks.json.daybar-backup-crash1.icloud', 'placeholder');
  store.put('daily-log-Daily_Tasks.json', {[day]: ['StaleLocal']}, '/local');
  await assert.rejects(
    api.DB.read('daily-log-Daily_Tasks.json', 'log', () => ({})),
    /Unrecovered interrupted write.*daybar-backup-crash1/)
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
});

test('Daily Log: evicted temp placeholder (.icloud) detected and blocks', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // Simulate evicted temp: .daily-log-Daily_Tasks.json.daybar-temp-orphan.icloud
  store.files.set('/cloud/.daily-log-Daily_Tasks.json.daybar-temp-orphan.icloud', 'placeholder');
  await assert.rejects(
    api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; }),
    /Unrecovered interrupted write.*daybar-temp-orphan/)
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
});

test('Daily Log: own temp exact match excluded, different temp with same suffix still detected', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // Our temp token
  const ourToken = 'our-token-123';
  // Pre-existing temp with same suffix but different prefix (should NOT happen in practice, but tests exclusion logic)
  store.files.set('/cloud/daily-log-Daily_Tasks.json.daybar-temp-' + ourToken, JSON.stringify({[day]: ['OurTemp']}));
  // Another pre-existing temp (different token) - should be detected
  store.files.set('/cloud/daily-log-Daily_Tasks.json.daybar-temp-other-token', JSON.stringify({[day]: ['OtherTemp']}));
  // Mutate with expected===null (create path) and our token - should detect OTHER temp
  await assert.rejects(
    api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['NewData']; return log; }),
    /Unrecovered interrupted write.*daybar-temp-other-token/)
  // Our temp should be cleaned up, other temp remains
  assert.equal(store.files.has('/cloud/daily-log-Daily_Tasks.json'), false);
  assert.ok(store.files.has('/cloud/daily-log-Daily_Tasks.json.daybar-temp-' + ourToken));
  assert.ok(store.files.has('/cloud/daily-log-Daily_Tasks.json.daybar-temp-other-token'));
});

test('Daily Log: backup with different name does not block', async () => {
  const {api, store} = await run('Daily Log', {boot: false});
  store.files.delete('/cloud/daily-log-Daily_Tasks.json');
  // Backup for different canonical name
  store.files.set('/cloud/daily-log-Other_Log.json.daybar-backup-crash1', JSON.stringify({'2026-11-10': ['Other']}));
  // Should work normally
  const log = await api.DB.mutate('daily-log-Daily_Tasks.json', 'log', () => ({}), log => { log[day] = ['Coursework']; return log; });
  assert.deepEqual(plain(log), {[day]: ['Coursework']});
  assert.deepEqual(plain(store.get('daily-log-Daily_Tasks.json')), {[day]: ['Coursework']});
  // Wrong-name backup still there
  assert.ok(store.files.has('/cloud/daily-log-Other_Log.json.daybar-backup-crash1'));
});

test('Focus Timer: evicted backup placeholder blocks load', async () => {
  const {api, store} = await run('Focus Timer', {boot: false});
  store.files.delete('/cloud/focus-timer.json');
  store.files.set('/cloud/.focus-timer.json.daybar-backup-crash1.icloud', 'placeholder');
  await assert.rejects(api.load(), /Unrecovered interrupted write.*daybar-backup-crash1/);
  assert.equal(store.files.has('/cloud/focus-timer.json'), false);
});

test('Time Blindness + Sleep: evicted backup placeholder blocks load', async () => {
  const {api, store} = await run('Time Blindness + Sleep', {boot: false});
  store.files.delete('/cloud/sleep-data.json');
  store.files.set('/cloud/.sleep-data.json.daybar-backup-crash1.icloud', 'placeholder');
  await assert.rejects(api.load(), /Unrecovered interrupted write.*daybar-backup-crash1/);
  assert.equal(store.files.has('/cloud/sleep-data.json'), false);
});

test('Days Left: evicted settings backup placeholder blocks settings read', async () => {
  const store = storage();
  store.files.set('/cloud/.daybar-settings.json.daybar-backup-crash1.icloud', 'placeholder');
  await assert.rejects(run('Days Left', {store, boot: false}), /Unrecovered interrupted write.*daybar-backup-crash1/);
});

