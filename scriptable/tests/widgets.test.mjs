import test from 'node:test';
import assert from 'node:assert/strict';
import {run,plain,allText,snapshot,source} from './harness.mjs';

const NOW = Date.parse('2026-11-15T17:00:00Z'); // 2026-11-15 in both Toronto and UTC
const TODAY = '2026-11-15';
const T4 = ['Coursework','Live Trading','Trade Review','Apostles work'];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shift = (k, n) => { const [y,m,d] = k.split('-').map(Number); return ymd(new Date(y,m-1,d+n)); };
const range = (a, b) => { const out = []; for (let k = a; k <= b; k = shift(k,1)) out.push(k); return out; };
const tick = (log, keys, n = 1) => { for (const k of keys) log[k] = T4.slice(0,n); return log; };
const colorsOf = e => [e.backgroundColor, e.textColor, ...(e.children || []).flatMap(colorsOf)].filter(Boolean);
const cells = w => w.children.filter(c => c.children.length && c.children.every(x => x.size)).flatMap(r => r.children);

// Independent oracle of Daybar's getHabitStats rules (packages/core/src/habits.ts), written from the
// definition: a day counts at >= dayCompleteMin known tasks; the current streak is the run of counted
// days ending today, or ending yesterday while today is still unfinished.
function oracle(log, {start, end = '', tasks = T4, min = 1}, today = TODAY) {
  const last = end && end < today ? end : today;
  const days = start > last ? [] : range(start, last);
  const ok = k => (log[k] || []).filter(t => tasks.includes(t)).length >= min;
  let best = 0, run = 0;
  for (const k of days) { run = ok(k) ? run + 1 : 0; best = Math.max(best, run); }
  let cur = 0, i = days.length - 1;
  if (i >= 0 && days[i] === today && !ok(today)) i--;
  for (; i >= 0 && ok(days[i]); i--) cur++;
  const completed = days.filter(ok).length;
  return {elapsed: days.length, completed, cur, best, missed: Math.max(0, days.length - completed)};
}

const streakCases = {
  'consecutive days': {start:'2026-11-01', log:tick({}, range('2026-11-05', TODAY))},
  'gap in the middle': {start:'2026-11-01', log:tick({}, [...range('2026-11-01','2026-11-06'), ...range('2026-11-09', TODAY)])},
  'today unfinished keeps yesterday streak': {start:'2026-11-01', log:tick({}, range('2026-11-08','2026-11-14'))},
  'yesterday missed breaks streak': {start:'2026-11-01', log:tick({}, [...range('2026-11-02','2026-11-12'), TODAY])},
  'dayCompleteMin 2': {start:'2026-11-01', min:2, log:{...tick({}, range('2026-11-03','2026-11-09'), 2), '2026-11-10':['Coursework'], ...tick({}, range('2026-11-11','2026-11-14'), 3), [TODAY]:['Trade Review']}},
  'dayCompleteMin 3, today reaches it': {start:'2026-11-01', min:3, log:{...tick({}, range('2026-11-10','2026-11-14'), 4), [TODAY]:['Coursework','Live Trading','Apostles work']}},
  'start date in the future': {start:'2026-12-01', log:tick({}, range('2026-11-10', TODAY))},
  'start date is today': {start:TODAY, log:tick({}, [TODAY])},
  'end date in the past': {start:'2026-10-01', end:'2026-11-10', log:tick({}, range('2026-10-20','2026-11-10'))},
  'end date in the past, last day missed': {start:'2026-10-01', end:'2026-11-10', log:tick({}, range('2026-10-20','2026-11-09'))},
  'end date in the future': {start:'2026-11-01', end:'2026-12-31', log:tick({}, range('2026-11-01','2026-11-14'))},
  'unknown tasks ignored': {start:'2026-11-01', log:{'2026-11-14':['Removed task'], '2026-11-13':['Coursework']}}
};

for (const [label, c] of Object.entries(streakCases)) {
  test(`Daily Log: streak parity with core rules: ${label}`, async () => {
    const min = c.min ?? 1;
    const {api, store} = await run('Daily Log', {now:NOW, settings:{habits:{startDate:c.start, endDate:c.end ?? '', tasks:T4, dayCompleteMin:min}}});
    store.put('daily-log-Daily_Tasks.json', c.log);
    const s = api.getStats(plain(c.log)), want = oracle(c.log, {start:c.start, end:c.end, min});
    assert.deepEqual({elapsed:s.elapsed, completed:s.completedDays, cur:s.currentStreak, best:s.longestStreak, missed:s.missedDays},
      {elapsed:want.elapsed, completed:want.completed, cur:want.cur, best:want.best, missed:want.missed}, label);
  });
}

test('Daily Log: streak invariants (spot values)', async () => {
  const stats = async c => (await run('Daily Log', {now:NOW, settings:{habits:{startDate:c.start, tasks:T4}}})).api.getStats(c.log);
  assert.equal((await stats(streakCases['today unfinished keeps yesterday streak'])).currentStreak, 7);
  assert.equal((await stats(streakCases['yesterday missed breaks streak'])).currentStreak, 1);
  assert.equal((await stats(streakCases['start date in the future'])).elapsed, 0);
  assert.equal((await stats(streakCases['start date in the future'])).currentStreak, 0);
});

test('Daily Log: sub-line text with and without an end date', async () => {
  const log = tick({}, range('2026-11-12', '2026-11-14'));
  log[TODAY] = ['Coursework','Live Trading'];
  const open = await run('Daily Log', {now:NOW, settings:{habits:{startDate:'2026-11-01', endDate:''}}});
  open.store.put('daily-log-Daily_Tasks.json', log);
  // 4 completed (12,13,14,15) of 15 elapsed days; today 2/4; streak includes today
  assert.ok(allText(await open.api.createWidget('medium')).includes('Today 2/4  •  4d streak  •  27%  •  11 missed'));
  assert.ok(allText(await open.api.createWidget('medium')).includes('4/15'));
  const ended = await run('Daily Log', {now:NOW, store:open.store, settings:{habits:{startDate:'2026-11-01', endDate:'2026-11-30'}}});
  assert.ok(allText(await ended.api.createWidget('medium')).includes('Today 2/4  •  4d streak  •  27%  •  15d left'));
});

test('Daily Log: small and large widgets render; large adds the checklist and best streak', async () => {
  for (const family of ['small','medium','large']) {
    const r = await run('Daily Log', {now:NOW, family, settings:{habits:{startDate:'2026-11-01'}}});
    r.store.put('daily-log-Daily_Tasks.json', {'2026-11-14':['Coursework'], [TODAY]:['Coursework']});
    const w = await r.api.createWidget(family);
    const t = allText(w);
    assert.equal(w.url, 'scriptable:///run/Daily%20Log?action=today', family);
    if (family === 'small') {
      assert.ok(t.includes('1/4') && t.includes('2d streak') && T4.every(x => t.includes(x)), t.join('|'));
      assert.ok(!t.some(x => /missed|%/.test(x)));
    } else {
      assert.ok(t.some(x => x.startsWith('Today 1/4')), family);
      assert.equal(t.includes('Best streak 2d  •  2 days completed'), family === 'large');
      assert.equal(T4.every(x => t.includes(x)), family === 'large');
    }
  }
  // boot as widget with the family from config
  for (const family of ['small','large']) {
    const r = await run('Daily Log', {now:NOW, family, boot:true});
    assert.equal(r.widgets.length, 1);
    assert.equal(allText(r.widgets[0]).includes('Best streak 0d  •  0 days completed'), family === 'large');
  }
});

test('Daily Log: small widget cells and bar fit 150-24', async () => {
  const r = await run('Daily Log', {now:NOW, family:'small', boot:true});
  const sizes = r.widgets[0].children.flatMap(function walk(e) { return [e.size, ...e.children.flatMap(walk)]; }).filter(Boolean);
  assert.ok(sizes.length > 0);
  for (const s of sizes) assert.ok(s.width <= 150 - 24 && s.height <= 150 - 24, JSON.stringify(s));
});

test('Days Left: small widget fits 150-24 and its bar is full-width capped', async () => {
  const r = await run('Days Left', {now:NOW, family:'small', boot:true});
  assert.equal(r.widgets.length, 1);
  const sizes = (function walk(e) { return [e.size, ...e.children.flatMap(walk)]; })(r.widgets[0]).filter(Boolean);
  assert.ok(sizes.some(s => s.width === 150 - 24 && s.height === 6), 'bar is 126 wide');
  for (const s of sizes) assert.ok(s.width <= 126, JSON.stringify(s));
  assert.ok(allText(r.widgets[0]).some(t => /^\d+% • Day \d+\/\d+$/.test(t)));
});

test('Daily Log / Days Left: widget tap targets (runURL) with and without a widget parameter', async () => {
  const plainRun = await run('Daily Log', {now:NOW});
  assert.equal(plainRun.api.runURL('today'), 'scriptable:///run/Daily%20Log?action=today');
  const param = await run('Daily Log', {now:NOW, parameter:'Other Log!'});
  assert.equal(param.api.runURL('today'), 'scriptable:///run/Daily%20Log?action=today&log=Other%20Log!');
  assert.equal((await param.api.createWidget('medium')).url, param.api.runURL('today'));
  const days = await run('Days Left', {now:NOW});
  assert.equal(days.api.runURL(), 'scriptable:///run/Days%20Left');
  assert.equal(days.api.runURL('x'), 'scriptable:///run/Days%20Left?action=x');
  for (const family of ['small','medium','large']) assert.equal(days.api.createWidget(family).url, 'scriptable:///run/Days%20Left', family);
});

test('Daily Log: ?action=today opens today\'s checklist and ticks the task in the log file', async () => {
  const r = await run('Daily Log', {now:NOW, boot:true, inApp:true, query:{action:'today'}, choices:['⬜️  Coursework']});
  assert.deepEqual(r.alerts, [], 'no menu is shown');
  assert.equal(r.tables.length, 1);
  assert.ok(r.tables[0][0].startsWith('Daily Tasks  •  Today | 0/4 done'), r.tables[0][0]);
  assert.deepEqual(r.store.get('daily-log-Daily_Tasks.json'), {[TODAY]:['Coursework']});
  // footer is the last row
  // the table snapshot is taken when presented, before the tick
  assert.equal(r.tables[0].at(-1), '1 more to count today | Streak 0d  •  best 0d');
});

test('Daily Log: ?action=today&log=Other writes daily-log-Other.json only', async () => {
  const r = await run('Daily Log', {now:NOW, boot:true, inApp:true, query:{action:'today', log:'Other'}, choices:['⬜️  Live Trading']});
  assert.deepEqual(r.store.get('daily-log-Other.json'), {[TODAY]:['Live Trading']});
  assert.ok(!r.store.files.has('/cloud/daily-log-Daily_Tasks.json'));
});

test('Daily Log: checklist footer states (N more / Today counts / All done) with streak and best', async () => {
  const settings = {habits:{startDate:'2026-11-01', tasks:['A','B','C'], dayCompleteMin:2}};
  const log = {'2026-11-13':['A','B'], '2026-11-14':['A','C']};
  const states = [[[], '2 more to count today', 'Streak 2d  •  best 2d'], [['A'], '1 more to count today', 'Streak 2d  •  best 2d'],
    [['A','B'], 'Today counts', 'Streak 3d  •  best 3d'], [['A','B','C'], 'All done today', 'Streak 3d  •  best 3d']];
  for (const [done, title, sub] of states) {
    const r = await run('Daily Log', {now:NOW, settings});
    r.store.put('daily-log-Daily_Tasks.json', {...log, ...(done.length ? {[TODAY]:done} : {})});
    const again = await run('Daily Log', {now:NOW, store:r.store, boot:true, inApp:true, query:{action:'today'}});
    assert.equal(again.tables[0].at(-1), `${title} | ${sub}`);
  }
});

test('Daily Log: menu offers Edit yesterday and edits yesterday', async () => {
  const r = await run('Daily Log', {now:NOW, boot:true, inApp:true, choices:['Edit yesterday', '⬜️  Trade Review']});
  assert.deepEqual(r.alerts[0].actions, ['Update today','Edit yesterday','Edit another day','Preview widget']);
  assert.ok(r.tables[0][0].startsWith('Daily Tasks  •  2026-11-14'), r.tables[0][0]);
  assert.ok(!r.tables[0].at(-1).includes('Streak'), 'no footer for other days');
  assert.deepEqual(r.store.get('daily-log-Daily_Tasks.json'), {'2026-11-14':['Trade Review']});
  assert.equal(r.presented.length, 1); // preview of the medium widget afterwards
  assert.equal(r.presented[0][0], 'medium');
});

// ---------- theme ----------
const withTheme = async (name, theme) => (await source(name)).replace('const THEME = "night";', `const THEME = "${theme}";`);
test('Daily Log / Days Left: THEME day maps the palette, auto is dynamic, night is untouched', async () => {
  for (const name of ['Daily Log','Days Left']) {
    const night = await run(name, {now:NOW});
    const day = await run(name, {now:NOW, code:await withTheme(name,'day')});
    const auto = await run(name, {now:NOW, code:await withTheme(name,'auto')});
    assert.equal(night.api.THEME, 'night'); assert.equal(day.api.THEME, 'day'); assert.equal(auto.api.THEME, 'auto');
    assert.deepEqual(plain(night.api.C('#0d1117', 0.5)), {hex:'#0d1117', opacity:0.5});
    assert.deepEqual(plain(day.api.C('#0D1117')), {hex:'#f4f3ed', opacity:1});
    assert.equal(day.api.C('#ffffff', 0.4).hex, '#202820'); assert.equal(day.api.C('#ffffff', 0.4).opacity, 0.4);
    assert.equal(day.api.C('#39d353').hex, '#18764b');
    assert.equal(day.api.C('#123456').hex, '#123456', 'custom colors pass through');
    const dyn = auto.api.C('#0d1117', 0.7);
    assert.equal(dyn.hex, '#0d1117'); assert.equal(dyn.dark.hex, '#0d1117'); assert.equal(dyn.light.hex, '#f4f3ed'); assert.equal(dyn.light.opacity, 0.7);
    // whole widget: backgrounds are the day background, nothing keeps the night one
    const w = name === 'Days Left' ? day.api.createWidget('large') : await day.api.createWidget('large');
    assert.equal(w.backgroundColor.hex, '#f4f3ed');
    assert.ok(!colorsOf(w).some(c => c.hex === '#0d1117' || c.hex === '#ffffff'));
    const wn = name === 'Days Left' ? night.api.createWidget('large') : await night.api.createWidget('large');
    assert.equal(wn.backgroundColor.hex, '#0d1117');
  }
});

test('Daily Log: night output unchanged; day partial colors blend from the day palette', async () => {
  const log = {[TODAY]:['Coursework'], '2026-11-14':['Coursework','Live Trading'], '2026-11-13':T4.slice(0,3), '2026-11-12':T4};
  const mk = async theme => {
    const r = await run('Daily Log', {now:NOW, settings:{habits:{startDate:'2026-11-01'}}, ...(theme ? {code:await withTheme('Daily Log',theme)} : {})});
    r.store.put('daily-log-Daily_Tasks.json', log);
    return r.api.createWidget('medium');
  };
  const night = await mk(), day = await mk('day'), auto = await mk('auto');
  const dayBy = (w, hex) => colorsOf(w).filter(c => c.hex === hex);
  // night uses the original partial colors: 1 = red, 2 = ?, 3 = ?, 4 = green
  assert.ok(dayBy(night,'#ff5c5c').length >= 1 && dayBy(night,'#39d353').length >= 1);
  // day: blend of Daybar's day palette #b43737 / #a65410 / #80620b / #18764b
  const hexes = new Set(colorsOf(day).map(c => c.hex));
  for (const h of ['#b43737','#18764b']) assert.ok(hexes.has(h), h);
  assert.ok(!hexes.has('#ff5c5c') && !hexes.has('#39d353') && !hexes.has('#ff9f43'));
  // 4 tasks: 1 = red, 2 = orange, 3 = yellow, 4 = green, all from the day palette
  assert.ok(hexes.has('#80620b'), 'yellow from the day palette');
  assert.ok(hexes.has('#a65410'), 'orange from the day palette');
  // auto: dark side equals the night widget, light side the day widget
  const flat = w => colorsOf(w).map(c => [c.hex, c.opacity]);
  assert.deepEqual(flat(auto), flat(night));
  assert.deepEqual(colorsOf(auto).map(c => c.light ? [c.light.hex, c.light.opacity] : [c.hex, c.opacity]), flat(day));
});

test('Daily Log: night widget snapshot has not drifted (colors, opacities, sizes)', async () => {
  const r = await run('Daily Log', {now:NOW, settings:{habits:{startDate:'2026-11-01'}}});
  r.store.put('daily-log-Daily_Tasks.json', {[TODAY]:['Coursework','Live Trading'], '2026-11-14':T4});
  const w = await r.api.createWidget('medium');
  const bgs = colorsOf(w).map(c => c.hex);
  assert.ok(bgs.every(h => ['#0d1117','#ffffff','#39d353','#ff9f43'].includes(h)), [...new Set(bgs)].join());
  assert.ok(snapshot(w));
});

// ---------- Days Left ----------
const range30 = {countdown:{startDate:'2026-11-01', endDate:'2026-11-30', title:'Range'}};

test('Days Left: milestones and splitLeft for a known range', async () => {
  const {api} = await run('Days Left', {now:NOW, settings:range30});
  const s = api.getStats(new Date(NOW));
  assert.equal(s.total, 30); assert.equal(s.elapsed, 15); assert.equal(s.daysLeft, 15);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  assert.deepEqual(plain(api.milestones(s).map(m => [m.p, iso(m.date), m.inDays])),
    [[25,'2026-11-08',-7],[50,'2026-11-15',0],[75,'2026-11-23',8],[100,'2026-11-30',15]]);
  // Nov 16 (Mon) .. Nov 30 (Mon): 11 weekdays + 4 weekend days = 15 = daysLeft
  assert.deepEqual(plain(api.splitLeft(s)), {weekdays:11, weekend:4});
  const last = await run('Days Left', {now:Date.parse('2026-11-30T17:00:00Z'), settings:range30});
  assert.deepEqual(plain(last.api.splitLeft(last.api.getStats(new Date(Date.parse('2026-11-30T17:00:00Z'))))), {weekdays:0, weekend:0});
  assert.equal(last.api.milestones(last.api.getStats(new Date(Date.parse('2026-11-30T17:00:00Z')))).at(-1).inDays, 0);
  const before = await run('Days Left', {now:Date.parse('2026-10-20T17:00:00Z'), settings:range30});
  const sb = before.api.getStats(new Date(Date.parse('2026-10-20T17:00:00Z')));
  assert.equal(sb.elapsed, 0); assert.equal(sb.daysLeft, 41);
  assert.equal(before.api.milestones(sb)[0].inDays, 19);
});

test('Days Left: large widget details and medium/small layouts', async () => {
  const {api} = await run('Days Left', {now:NOW, settings:range30});
  const large = allText(api.createWidget('large')), medium = allText(api.createWidget('medium')), small = allText(api.createWidget('small'));
  assert.ok(large.includes('Weekdays left') && large.includes('11') && large.includes('Weekend days left') && large.includes('4'));
  assert.ok(large.includes('passed') && large.includes('today') && large.includes('in 8d') && large.includes('in 15d'));
  assert.ok(!medium.includes('Weekdays left') && medium.includes('15 days left'));
  assert.deepEqual(small.filter(Boolean).slice(0,3), ['Range','15','days left']);
  assert.ok(small.some(x => /^\d+% • Day 15\/30$/.test(x)));
});

test('Days Left: in-app details table rows and preview', async () => {
  const r = await run('Days Left', {now:NOW, settings:range30, boot:true, inApp:true});
  assert.equal(r.tables.length, 1);
  const t = r.tables[0];
  assert.equal(t[0], 'Range | 15 days left');
  assert.match(t[1], /^\d+% done \| Day 15 of 30/);
  assert.equal(t[2], '2 weeks, 1 day left | 11 weekdays  •  4 weekend days');
  assert.ok(t[3].startsWith('25%') && t[3].endsWith('Passed'));
  assert.ok(t[4].startsWith('50%') && t[4].endsWith('Today'));
  assert.ok(t[5].startsWith('75%') && t[5].endsWith('In 8 days'));
  assert.ok(t[6].startsWith('100%') && t[6].endsWith('In 15 days'));
  assert.deepEqual(t.slice(7), ['Preview small widget','Preview medium widget','Preview large widget']);
  assert.equal(r.presented.length, 0);
  const p = await run('Days Left', {now:NOW, settings:range30, boot:true, inApp:true, choices:['Preview large']});
  assert.equal(p.presented.length, 1); assert.equal(p.presented[0][0], 'large');
  assert.ok(allText(p.presented[0][1]).includes('Weekdays left'));
  const s = await run('Days Left', {now:NOW, settings:range30, boot:true, inApp:true, choices:['Preview small']});
  assert.equal(s.presented[0][0], 'small');
});

test('Days Left: widget never sets a far-future refreshAfterDate', async () => {
  const {api} = await run('Days Left', {now:NOW});
  const w = api.createWidget('medium');
  assert.ok(w.refreshAfterDate.getTime() - NOW <= 60 * 60000);
});
