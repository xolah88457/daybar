import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { run, allText, snapshot } from './harness.mjs';

const NAME = 'Time Blindness + Sleep';
const at = (h, m = 0, d = 15) => new Date(2026, 10, d, h, m).getTime();
const sleep = o => ({wakes: {}, beds: {}, plan: null, ...o});
const seed = (r, o) => r.store.put('sleep-data.json', sleep(o));

test('quickAction: morning offers wake until one is logged today', async () => {
  const r = await run(NAME, {now: at(8)});
  const now = new Date(at(8));
  assert.deepEqual({...r.api.quickAction(sleep(), now)}, {label: "I'm up: log wake now", kind: 'wake'});
  assert.equal(r.api.quickAction(sleep({wakes: {'2026-11-15': 470}}), now), null);
  // yesterday's wake does not count
  assert.equal(r.api.quickAction(sleep({wakes: {'2026-11-14': 470}}), now).kind, 'wake');
  for (const h of [4, 13]) assert.equal(r.api.quickAction(sleep(), new Date(at(h))).kind, 'wake');
});

test('quickAction: afternoon offers nothing', async () => {
  const r = await run(NAME);
  for (const h of [14, 16, 18]) assert.equal(r.api.quickAction(sleep(), new Date(at(h))), null);
});

test('quickAction: evening and after-midnight offer bed, attributed like logBed', async () => {
  const r = await run(NAME);
  assert.deepEqual({...r.api.quickAction(sleep(), new Date(at(22)))}, {label: 'Going to bed: log now', kind: 'bed'});
  assert.equal(r.api.quickAction(sleep({beds: {'2026-11-15': 1380}}), new Date(at(22))), null);
  assert.equal(r.api.quickAction(sleep(), new Date(at(19))).kind, 'bed');
  // 1:30 on the 16th belongs to the evening of the 15th
  const late = new Date(at(1, 30, 16));
  assert.equal(r.api.quickAction(sleep(), late).kind, 'bed');
  assert.equal(r.api.quickAction(sleep({beds: {'2026-11-15': 1380}}), late), null);
  assert.equal(r.api.quickAction(sleep({beds: {'2026-11-16': 1380}}), late).kind, 'bed');
});

test('menu: quick action is first, logs wake now without a picker, then previews', async () => {
  const r = await run(NAME, {now: at(8, 15), inApp: true, choices: ["I'm up"]});
  await r.api.showMenu();
  assert.equal(r.alerts[0].actions[0], "I'm up: log wake now");
  assert.deepEqual(r.alerts[0].actions.slice(1), ['Log wake time', 'Log bedtime', 'Sleep plan', 'Preview widget']);
  assert.equal(r.alerts.length, 1);   // no time picker sheet
  assert.equal(r.store.get('sleep-data.json').wakes['2026-11-15'], 8 * 60 + 15);
  assert.equal(r.presented[0][0], 'medium');
});

test('menu: boot run logs wake through the quick action', async () => {
  const r = await run(NAME, {now: at(7, 40), inApp: true, boot: true, choices: ["I'm up"]});
  assert.equal(r.store.get('sleep-data.json').wakes['2026-11-15'], 7 * 60 + 40);
  assert.equal(r.presented.length, 1);
});

test('menu: evening quick action logs bed; other items still work by label', async () => {
  const r = await run(NAME, {now: at(23, 10), inApp: true, boot: true, choices: ['Going to bed']});
  assert.equal(r.store.get('sleep-data.json').beds['2026-11-15'], 23 * 60 + 10);
  const plain = await run(NAME, {now: at(15), inApp: true, boot: true, choices: ['Log wake time', 'Just now']});
  assert.equal(plain.alerts[0].actions[0], 'Log wake time');
  assert.equal(plain.store.get('sleep-data.json').wakes['2026-11-15'], 15 * 60);
});

test('small widget renders status, bar and bed time; phase replaces the bed line', async () => {
  const r = await run(NAME, {now: at(14), family: 'small'});
  seed(r, {wakes: {'2026-11-15': 8 * 60}});
  const text = allText(await r.api.createWidget('small'));
  assert.ok(text.some(x => /^\d{4}-\d\d-\d\dT\d\d:00/.test(x)), text.join('|'));
  assert.ok(text.includes('10h until bed'), text.join('|'));
  assert.ok(text.some(x => /^Bed \d{4}-11-1[56]T\d\d:00/.test(x)));
  const phase = await run(NAME, {now: at(23, 30), family: 'small'});
  seed(phase, {wakes: {'2026-11-15': 8 * 60}});
  const t2 = allText(await phase.api.createWidget('small'));
  assert.ok(t2.includes('No phone time'));
  assert.ok(!t2.some(x => x.startsWith('Bed ')));
  const past = await run(NAME, {now: at(1, 0, 16), family: 'small'});
  seed(past, {wakes: {'2026-11-15': 8 * 60}});
  assert.ok(allText(await past.api.createWidget('small')).includes('Past bedtime by 1h'));
});

test('small widget bar fits SMALL_WIDTH and tap opens the script', async () => {
  const r = await run(NAME, {now: at(14), family: 'small'});
  seed(r, {wakes: {'2026-11-15': 8 * 60}});
  const w = await r.api.createWidget('small');
  assert.equal(w.url, 'scriptable:///run/' + encodeURIComponent(NAME));
  const widths = [];
  (function walk(e) { if (e.size) widths.push(e.size.width); e.children.forEach(walk); })(w);
  assert.ok(Math.max(...widths) <= 150 - 24);
});

test('night theme output is identical to the previous version', async () => {
  let old;
  try { old = execSync('git show HEAD:"scriptable/Time Blindness + Sleep.js"', {cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 1e7}); }
  catch { return; }
  if (old.includes('const THEME')) return;   // HEAD already themed: nothing to compare
  for (const h of [3, 9, 14, 21, 23]) {
    const a = await run(NAME, {now: at(h)}), b = await run(NAME, {now: at(h), code: old});
    for (const r of [a, b]) seed(r, {wakes: {'2026-11-15': 8 * 60, '2026-11-14': 450}, beds: {'2026-11-14': 1400}});
    const strip = w => { const s = snapshot(w); return JSON.stringify(s); };
    assert.equal(strip(await a.api.createWidget()), strip(await b.api.createWidget()), `hour ${h}`);
  }
});

test('THEME day maps the palette; auto is dynamic; night stays literal', async () => {
  const code = await (await import('node:fs/promises')).readFile(new URL('../Time Blindness + Sleep.js', import.meta.url), 'utf8');
  const night = await run(NAME);
  assert.equal(night.api.THEME, 'night');
  assert.equal(night.api.C('#39d353').hex, '#39d353');
  const day = await run(NAME, {code: code.replace('const THEME = "night"', 'const THEME = "day"')});
  assert.equal(day.api.C('#0d1117').hex, '#f4f3ed');
  assert.equal(day.api.C('#ffffff', 0.5).hex, '#202820');
  assert.equal(day.api.C('#39d353').hex, '#18764b');
  assert.equal(day.api.C('#123456').hex, '#123456');   // custom colors stay
  seed(day, {wakes: {'2026-11-15': 8 * 60}});
  assert.equal((await day.api.createWidget()).backgroundColor.hex, '#f4f3ed');
  const auto = await run(NAME, {code: code.replace('const THEME = "night"', 'const THEME = "auto"')});
  const c = auto.api.C('#39d353');
  assert.equal(c.light.hex, '#18764b'); assert.equal(c.dark.hex, '#39d353');
});
