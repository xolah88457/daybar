import test from 'node:test';
import assert from 'node:assert/strict';
import {run, allText, plain} from './harness.mjs';

const NAME = 'Deadline Radar';
const work = {title: 'Work'};
const other = {title: 'Not Mine'};
const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);
const NOW = L(2026, 11, 15, 12).getTime();
const ev = (title, startDate, endDate, extra = {}) => ({title, startDate, endDate, isAllDay: false, calendar: work, ...extra});
const rem = (title, dueDate, extra = {}) => ({title, dueDate, dueDateIncludesTime: true, calendar: {title: 'Tasks'}, ...extra});
const go = (calendars, opts = {}) => run(NAME, {now: NOW, calendars, ...opts});
const walk = el => [el, ...el.children.flatMap(walk)];

test('running multi-day timed event is Now and red', async () => {
  const r = await go({events: [ev('Conference', L(2026, 11, 13, 9), L(2026, 11, 17, 17))]});
  const [item] = await r.api.getItems();
  assert.equal(r.api.itemDays(item), 0);
  assert.equal(r.api.label(item), 'Now');
  assert.equal(r.api.urgencyColor(r.api.itemDays(item)).hex, '#ff5c5c');
});

test('running multi-day all-day event is Today, not overdue', async () => {
  const r = await go({events: [ev('Trip', L(2026, 11, 13), L(2026, 11, 17, 23, 59), {isAllDay: true})]});
  const [item] = await r.api.getItems();
  assert.equal(r.api.label(item), 'Today');
  assert.equal(r.api.itemDays(item), 0);
});

test('overdue reminder keeps its overdue label', async () => {
  const r = await go({reminders: [rem('Pay rent', L(2026, 11, 12, 9))]});
  const [item] = await r.api.getItems();
  assert.equal(r.api.label(item), '3d overdue');
  assert.equal(r.api.itemDays(item), -3);
});

test('labels for today, tomorrow and later', async () => {
  const r = await go({events: [ev('A', L(2026, 11, 15, 15), L(2026, 11, 15, 16)), ev('B', L(2026, 11, 16, 9), L(2026, 11, 16, 10)), ev('C', L(2026, 11, 20, 9), L(2026, 11, 20, 10))]});
  const items = await r.api.getItems();
  assert.deepEqual(plain(items.map(i => r.api.label(i).replace(/ \d.*$/, ''))), ['Today', 'Tomorrow', '5 days']);
});

test('timed events already ended are dropped', async () => {
  const r = await go({events: [ev('Done', L(2026, 11, 15, 8), L(2026, 11, 15, 9)), ev('Later', L(2026, 11, 15, 14), L(2026, 11, 15, 15))]});
  assert.deepEqual(plain((await r.api.getItems()).map(i => i.title)), ['Later']);
});

test('DST horizon: last day inside the window across fall-back', async () => {
  const now = L(2026, 10, 30, 12).getTime(); // Nov 1 2026 falls back; 60 days ahead is Dec 29
  const r = await go({events: [ev('Inside', L(2026, 12, 28, 23), L(2026, 12, 28, 23, 30)), ev('Outside', L(2026, 12, 29, 0), L(2026, 12, 29, 1))]}, {now});
  assert.deepEqual(plain((await r.api.getItems()).map(i => i.title)), ['Inside']);
});

test('DST horizon: spring-forward does not let an extra hour in', async () => {
  const now = L(2027, 2, 20, 12).getTime(); // Mar 14 2027 springs forward; horizon is Apr 21 00:00
  const r = await go({events: [ev('Inside', L(2027, 4, 20, 23), L(2027, 4, 20, 23, 30)), ev('Outside', L(2027, 4, 21, 0, 30), L(2027, 4, 21, 1))]}, {now});
  assert.deepEqual(plain((await r.api.getItems()).map(i => i.title)), ['Inside']);
});

test('overdue reminder window uses calendar days across DST', async () => {
  const now = L(2026, 11, 5, 12).getTime(); // 14 days back is Oct 22 00:00 local, before fall-back
  const r = await go({reminders: [rem('Edge', L(2026, 10, 22, 0, 30)), rem('Too old', L(2026, 10, 21, 23))]}, {now});
  assert.deepEqual(plain((await r.api.getItems()).map(i => i.title)), ['Edge']);
});

test('sort: date, then title, then kind', async () => {
  const t = L(2026, 11, 18, 9);
  const r = await go({
    events: [ev('B', t, L(2026, 11, 18, 10)), ev('A', t, L(2026, 11, 18, 10))],
    reminders: [rem('A', t), rem('Z early', L(2026, 11, 17, 9))]
  });
  assert.deepEqual(plain((await r.api.getItems()).map(i => `${i.title}/${i.kind}`)), ['Z early/reminder', 'A/event', 'A/reminder', 'B/event']);
});

test('openURL for events and reminders', async () => {
  const r = await go({});
  const d = L(2026, 11, 18, 9);
  assert.equal(r.api.openURL({kind: 'event', date: d}), 'calshow:' + Math.floor(d.getTime() / 1000 - 978307200));
  assert.equal(r.api.openURL({kind: 'reminder', date: d}), 'x-apple-reminderkit://');
  assert.equal(r.api.runURL(), 'scriptable:///run/Deadline%20Radar');
});

test('calendar-name filter and keywords', async () => {
  const t = L(2026, 11, 18, 9), e = L(2026, 11, 18, 10);
  const r = await go({events: [ev('Mine', t, e), ev('Theirs', t, e, {calendar: other})]});
  assert.deepEqual(plain((await r.api.getItems()).map(i => i.title)), ['Mine']);
  const code = (await import('node:fs/promises')).readFile(new URL('../Deadline Radar.js', import.meta.url), 'utf8');
  const k = await run(NAME, {now: NOW, code: (await code).replace('const KEYWORDS = [];', 'const KEYWORDS = ["exam"];'),
    calendars: {events: [ev('Final exam', t, e), ev('Lunch', t, e)]}});
  assert.deepEqual(plain((await k.api.getItems()).map(i => i.title)), ['Final exam']);
});

test('medium widget: header count, row urls, tap url', async () => {
  const r = await go({events: [ev('Soon', L(2026, 11, 16, 9), L(2026, 11, 16, 10))], reminders: [rem('Late', L(2026, 11, 13, 9))]});
  const w = await r.api.createWidget('medium');
  assert.equal(w.url, 'scriptable:///run/Deadline%20Radar');
  assert.ok(allText(w).includes('1 overdue • 1 upcoming'));
  const urls = walk(w).filter(e => e.url && e !== w).map(e => e.url);
  assert.deepEqual(urls, ['x-apple-reminderkit://', 'calshow:' + Math.floor(L(2026, 11, 16, 9).getTime() / 1000 - 978307200)]);
  assert.ok(allText(w).includes('2d overdue'));
});

test('upcoming-only header keeps the old wording', async () => {
  const r = await go({events: [ev('Soon', L(2026, 11, 16, 9), L(2026, 11, 16, 10))]});
  assert.ok(allText(await r.api.createWidget('medium')).includes('1 upcoming'));
});

test('small widget: next deadline, more count, empty state', async () => {
  const r = await go({events: [ev('Essay due', L(2026, 11, 16, 9), L(2026, 11, 16, 10)), ev('Exam', L(2026, 11, 20, 9), L(2026, 11, 20, 10))]});
  const w = await r.api.createWidget('small');
  const text = allText(w);
  assert.ok(text.includes('Tomorrow') && text.includes('Essay due') && text.includes('+1 more'));
  assert.ok(!text.includes('Exam'));
  assert.equal(w.url, 'scriptable:///run/Deadline%20Radar');
  const lab = walk(w).find(e => e.text === 'Tomorrow');
  assert.equal(lab.textColor.hex, '#ff9f43');
  const empty = await (await go({})).api.createWidget('small');
  const t = walk(empty).find(e => e.text === 'Nothing due.');
  assert.equal(t.textColor.hex, '#39d353');
});

test('in-app list: selecting a row opens its url', async () => {
  const t = L(2026, 11, 18, 9);
  const r = await go({events: [ev('Exam', t, L(2026, 11, 18, 10))]}, {inApp: true, choices: ['Exam']});
  await r.api.showList();
  assert.deepEqual(r.opened, ['calshow:' + Math.floor(t.getTime() / 1000 - 978307200)]);
});

test('never touches the store', async () => {
  const r = await go({events: [ev('X', L(2026, 11, 18, 9), L(2026, 11, 18, 10))]}, {boot: true});
  assert.deepEqual(plain(r.store.events), []);
});

for (const family of ['small', 'medium', 'large']) test(`boot runs for ${family}`, async () => {
  const r = await go({events: [ev('X', L(2026, 11, 18, 9), L(2026, 11, 18, 10))]}, {boot: true, family});
  assert.equal(r.widgets.length, 1);
  assert.deepEqual(plain(r.store.events), []);
});
