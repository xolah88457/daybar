import test from 'node:test';
import assert from 'node:assert/strict';
import { run, allText, snapshot, plain, source } from './harness.mjs';

const NOW = Date.parse('2026-11-15T17:00:00Z');
const MIN = 60000;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const session = (end, minutes, task) => ({ type: 'focus', minutes, creditedMinutes: minutes, end, date: dayKey(end), ...(task ? { task } : {}) });
function seed(r, sessions) {
  const map = {};
  for (const s of sessions) map[String(s.end - s.minutes * MIN)] = s;
  r.store.put('focus-timer.json', { state: null, days: {}, sessions: map, baseline: {} });
}
const SETTINGS = { focus: { alerts: true }, habits: { tasks: ['Coursework', 'Reading'] } };

function cells(w) { // block-row cell sizes
  const out = [];
  (function walk(e) { if (e.size) out.push(e.size.width); e.children.forEach(walk); })(w);
  return out;
}

test('lastFocus returns the most recent focus session by end, or null', async () => {
  const r = await run('Focus Timer');
  assert.equal(r.api.lastFocus({ state: null, days: {} }), null);
  const a = session(NOW - 90 * MIN, 25), b = session(NOW - 30 * MIN, 50, 'Reading');
  const brk = { type: 'break', minutes: 5, creditedMinutes: 0, end: NOW - 5 * MIN, date: dayKey(NOW) };
  assert.equal(r.api.lastFocus({ sessions: { 1: b, 2: a, 3: brk } }), b);
});

test('menuOptions: repeat first with task, then focus, breaks, long breaks', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS });
  const d = { state: null, days: {}, sessions: { 1: session(NOW - 3 * 3600000, 25, 'Coursework') } };
  const o = r.api.menuOptions(d, NOW);
  assert.equal(o[0].label, 'Repeat: Focus 25 min • Coursework');
  assert.equal(o[0].task, 'Coursework');
  assert.deepEqual(plain(o.map(x => x.label).slice(1)), ['Focus 25 min', 'Focus 50 min', 'Break 5 min', 'Break 10 min', 'Long break 15 min', 'Long break 30 min']);
  const none = r.api.menuOptions({ state: null, days: {}, sessions: { 1: session(NOW - 3 * 3600000, 30) } }, NOW);
  assert.equal(none[0].label, 'Repeat: Focus 30 min');
  assert.equal(r.api.menuOptions({ state: null, days: {} }, NOW)[0].label, 'Focus 25 min');
});

test('menuOptions: breaks first within 20 min of a focus, long break first on every 4th', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS });
  const mk = n => { const s = {}; for (let i = 0; i < n; i++) s[i + 1] = session(NOW - (10 + 40 * (n - 1 - i)) * MIN, 25); return { state: null, days: {}, sessions: s }; };
  const labels = o => plain(o.map(x => x.label));
  const three = labels(r.api.menuOptions(mk(3), NOW));
  assert.deepEqual(three.slice(0, 4), ['Break 5 min', 'Break 10 min', 'Long break 15 min', 'Long break 30 min']);
  assert.ok(three.indexOf('Repeat: Focus 25 min') > three.indexOf('Long break 30 min'));
  const four = labels(r.api.menuOptions(mk(4), NOW));
  assert.deepEqual(four.slice(0, 2), ['Long break 15 min', 'Long break 30 min']);
  // stale (>20 min) session: focus options come first again
  const old = { state: null, days: {}, sessions: { 1: session(NOW - 25 * MIN, 25) } };
  assert.match(r.api.menuOptions(old, NOW)[0].label, /^Repeat/);
});

test('showMenu: recent focus message, and Repeat starts directly with the same task', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS, inApp: true, choices: [0] });
  seed(r, [session(NOW - 5 * MIN, 25, 'Coursework')]);
  const data = await r.api.settle();
  // breaks come first, so pick "Repeat" by label (no task picker should follow)
  const r2 = await run('Focus Timer', { settings: SETTINGS, inApp: true, store: r.store, choices: ['Repeat'] });
  const d2 = await r2.api.settle();
  await r2.api.showMenu(d2);
  assert.equal(r2.alerts[0].message, 'Focus done. Time for a break?');
  assert.equal(r2.alerts.some(a => a.title === 'Link focus to a task?'), false);
  const st = r2.store.get('focus-timer.json').state;
  assert.equal(st.type, 'focus'); assert.equal(st.task, 'Coursework'); assert.equal(st.minutes, 25);
  assert.match(r2.notifications[0].body, /Nice work on Coursework/);
  assert.ok(data);
});

test('running menu shows type, minutes left, end time and task', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS, inApp: true });
  const d = await r.api.startTimer('focus', 25, 'Reading');
  await r.api.showMenu(d);
  const m = r.alerts[0].message;
  assert.match(m, /Focusing • 25 min left • ends /);
  assert.match(m, /Task: Reading/);
});

test('small widget fits 150pt; medium keeps 354pt layout', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS });
  const d = await r.api.startTimer('focus', 25, 'Coursework');
  const small = r.api.createWidget(d, 'small'), medium = r.api.createWidget(d, 'medium');
  const sc = cells(small), mc = cells(medium);
  assert.ok(sc.length > 0 && mc.length > sc.length);
  const gap = 2, total = list => list.reduce((a, b) => a + b, 0) + (list.length - 1) * gap;
  assert.ok(total(sc) <= 150 - 24 + 1e-6, `small row ${total(sc)}`);
  assert.ok(Math.abs(total(mc) - (354 - 24)) < 1e-6);
  const t = allText(small);
  assert.ok(t.includes('FOCUS'));
  assert.ok(!t.some(x => String(x).startsWith('FOCUS •')));
  assert.ok(t.some(x => String(x).startsWith('Coursework • ends')));
  assert.ok(t.some(x => /^\d+ blocks? • \d+ min$/.test(x)));
  assert.equal(r.api.createWidget({ state: null, days: {} }, 'small').children.length > 0, true);
  assert.ok(allText(r.api.createWidget({ state: null, days: {} }, 'small')).includes('READY'));
});

test('medium running widget shows task and progress; "No task" otherwise; 0:00 after expiry', async () => {
  const r = await run('Focus Timer', { settings: SETTINGS });
  let d = await r.api.startTimer('focus', 25, 'Coursework');
  r.advance(12 * MIN + 5000);
  let t = allText(r.api.createWidget(d, 'medium'));
  assert.ok(t.includes('Coursework')); assert.ok(t.includes('12/25 min'));
  assert.ok(t.some(x => String(x).startsWith('FOCUS • ends')));
  d = await r.api.settle(); // still running
  const r2 = await run('Focus Timer', { settings: SETTINGS });
  d = await r2.api.startTimer('break', 5);
  t = allText(r2.api.createWidget(d, 'medium'));
  assert.ok(t.includes('No task')); assert.ok(t.includes('0/5 min'));
  r2.advance(6 * MIN);
  assert.ok(allText(r2.api.createWidget(d, 'medium')).includes('0:00'));
});

test('widget tap url opens the script; runURL encodes the name', async () => {
  const r = await run('Focus Timer');
  assert.equal(r.api.runURL(), 'scriptable:///run/Focus%20Timer');
  assert.equal(r.api.runURL('x'), 'scriptable:///run/Focus%20Timer?action=x');
  assert.equal(r.api.createWidget({ state: null, days: {} }, 'small').url, 'scriptable:///run/Focus%20Timer');
});

test('THEME: night colors unchanged, day and auto map through the Day palette', async () => {
  const night = await run('Focus Timer');
  const w = night.api.createWidget({ state: null, days: {} }, 'medium');
  assert.deepEqual(plain(w.backgroundColor), { hex: '#0d1117', opacity: 1 });
  assert.deepEqual(plain(night.api.C('#39d353', 0.5)), { hex: '#39d353', opacity: 0.5 });
  const base = await source('Focus Timer');
  const day = await run('Focus Timer', { code: base.replace('const THEME = "night";', 'const THEME = "day";') });
  assert.equal(day.api.createWidget({ state: null, days: {} }, 'medium').backgroundColor.hex, '#f4f3ed');
  assert.equal(day.api.C('#39d353').hex, '#18764b');
  assert.equal(day.api.C('#123456').hex, '#123456');
  const auto = await run('Focus Timer', { code: base.replace('const THEME = "night";', 'const THEME = "auto";') });
  const c = auto.api.C('#58a6ff');
  assert.equal(c.light.hex, '#286a9f'); assert.equal(c.dark.hex, '#58a6ff');
  assert.ok(snapshot(night.api.createWidget({ state: null, days: {} }, 'small')));
});
