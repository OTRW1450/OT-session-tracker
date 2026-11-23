// Unit tests for scoring and grouping logic. Run with: node --test tests/
// Sample goals below are made up for testing only.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const goal = (id, area, method = 'scale', extra = {}) =>
  Object.assign({ id, childId: 'c1', text: 'Sample goal ' + id, area, method, ideas: [] }, extra);

const session = (id, date, scores, extra = {}) =>
  Object.assign({ id, childId: 'c1', date, note: '', scores, createdAt: 1 }, extra);

/* ---------- Areas ---------- */

test('custom areas are merged case-insensitively with built-ins', () => {
  assert.equal(L.canonicalArea('  fine   MOTOR ', []), 'Fine motor');
  let r = L.addCustomArea([], 'Feeding');
  assert.deepEqual(r.customAreas, ['Feeding']);
  r = L.addCustomArea(r.customAreas, 'feeding');
  assert.deepEqual(r.customAreas, ['Feeding']);
  assert.equal(r.area, 'Feeding');
  r = L.addCustomArea(r.customAreas, 'balance');
  assert.equal(r.area, 'Balance');
  assert.deepEqual(r.customAreas, ['Feeding']);
  assert.equal(L.addCustomArea(['Feeding'], '   ').area, '');
});

test('allAreas lists built-ins first, then custom areas, without duplicates', () => {
  const all = L.allAreas(['Feeding', 'MEMORY']);
  assert.equal(all.length, L.BUILTIN_AREAS.length + 1);
  assert.equal(all[0], 'Strength');
  assert.equal(all[all.length - 1], 'Feeding');
});

/* ---------- Grouping ---------- */

test('groups follow dropdown order and "No area yet" goes last', () => {
  const goals = [goal('a', ''), goal('b', 'Handwriting'), goal('c', 'Strength'), goal('d', 'handwriting'), goal('e', 'Feeding')];
  const { showHeadings, groups } = L.groupGoalsByArea(goals, ['Feeding']);
  assert.equal(showHeadings, true);
  assert.deepEqual(groups.map(g => g.area), ['Strength', 'Handwriting', 'Feeding', L.NO_AREA]);
  assert.deepEqual(groups.map(g => g.count), [1, 2, 1, 1]);
  assert.equal(groups[3].isNoArea, true);
});

test('headings are hidden when no goal has an area', () => {
  const { showHeadings, groups } = L.groupGoalsByArea([goal('a', ''), goal('b', null)], []);
  assert.equal(showHeadings, false);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('area filter only shows with two or more areas', () => {
  assert.equal(L.shouldShowAreaFilter([goal('a', 'Balance'), goal('b', '')], []), false);
  assert.equal(L.shouldShowAreaFilter([goal('a', 'Balance'), goal('b', 'Memory')], []), true);
  const goals = [goal('a', 'Balance'), goal('b', 'Memory'), goal('c', '')];
  assert.deepEqual(L.filterGoalsByArea(goals, 'balance').map(g => g.id), ['a']);
  assert.deepEqual(L.filterGoalsByArea(goals, 'all').map(g => g.id), ['a', 'b', 'c']);
  assert.deepEqual(L.filterGoalsByArea(goals, L.NO_AREA).map(g => g.id), ['c']);
});

/* ---------- Scoring ---------- */

test('tapping a selected level again unselects it', () => {
  let s = L.toggleLevel(undefined, 2);
  assert.equal(s.value, 2);
  s = L.toggleLevel(s, 2);
  assert.equal(s.value, undefined);
  s = L.toggleLevel({ value: 1, note: 'kept' }, 3);
  assert.deepEqual(s, { value: 3, note: 'kept' });
});

test('"Not worked on" toggles and clears the value', () => {
  let s = L.toggleNotWorked({ value: 2 });
  assert.deepEqual(s, { notWorked: true });
  s = L.toggleNotWorked(s);
  assert.deepEqual(s, {});
  s = L.toggleLevel({ notWorked: true }, 1);
  assert.deepEqual(s, { value: 1 });
});

test('trials: label, percent, attempts limits and unselect', () => {
  assert.equal(L.formatTrials(3, 5), '3 of 5 (60%)');
  assert.equal(L.formatTrials(0, 4), '0 of 4 (0%)');
  assert.equal(L.clampAttempts(0), 1);
  assert.equal(L.clampAttempts(99), 20);
  assert.equal(L.clampAttempts('abc'), 5);
  let s = L.toggleTrials({}, 4, 5);
  assert.deepEqual(s, { value: 4, attempts: 5 });
  s = L.setAttempts(s, 3); // 4 successes no longer fits in 3 attempts
  assert.deepEqual(s, { attempts: 3 });
  s = L.toggleTrials(L.toggleTrials(s, 2, 3), 2, 3);
  assert.equal(s.value, undefined);
});

test('default attempts remember the last used count', () => {
  const g = goal('t', '', 'trials');
  assert.equal(L.defaultAttempts(g, [], null), 5);
  assert.equal(L.defaultAttempts(g, [], 8), 8);
  const sessions = [session('s1', '2026-01-01', { t: { value: 2, attempts: 10 } })];
  assert.equal(L.defaultAttempts(g, sessions, 8), 10);
});

test('scoreLabel covers every method', () => {
  assert.equal(L.scoreLabel(goal('a', '', 'scale'), { value: 1 }), 'Emerging');
  assert.equal(L.scoreLabel(goal('a', '', 'help'), { value: 4 }), 'Independent');
  assert.equal(L.scoreLabel(goal('a', '', 'trials'), { value: 3, attempts: 5 }), '3 of 5 (60%)');
  assert.equal(L.scoreLabel(goal('a', '', 'number', { unit: '%' }), { value: 75 }), '75%');
  assert.equal(L.scoreLabel(goal('a', '', 'number', { unit: 'minutes' }), { value: 2.5 }), '2.5 minutes');
  assert.equal(L.scoreLabel(goal('a', '', 'scale'), { notWorked: true }), 'Not worked on');
});

test('number input accepts decimals and commas, rejects junk', () => {
  assert.equal(L.parseNumberInput('12'), 12);
  assert.equal(L.parseNumberInput(' 3,5 '), 3.5);
  assert.equal(L.parseNumberInput(''), null);
  assert.equal(L.parseNumberInput('abc'), null);
});

test('cleanScores drops empty entries and keeps notes', () => {
  const out = L.cleanScores({
    a: {}, b: { value: 2 }, c: { note: '  ok  ' }, d: { notWorked: true, value: 3 }, e: { attempts: 5 },
  });
  assert.deepEqual(out, { b: { value: 2 }, c: { note: 'ok' }, d: { notWorked: true } });
});

/* ---------- Sessions & history ---------- */

test('method can change only before any session scores the goal', () => {
  const g = goal('g1', '');
  assert.equal(L.canChangeMethod(g, []), true);
  assert.equal(L.canChangeMethod(g, [session('s', '2026-01-02', { g1: { note: 'note only' } })]), true);
  assert.equal(L.canChangeMethod(g, [session('s', '2026-01-02', { g1: { notWorked: true } })]), false);
  assert.equal(L.canChangeMethod(g, [session('s', '2026-01-02', { g1: { value: 0 } })]), false);
});

test('last score, series and started/latest use date order', () => {
  const g = goal('g1', '');
  const sessions = [
    session('s3', '2026-03-01', { g1: { value: 3 } }),
    session('s1', '2026-01-01', { g1: { value: 0 } }),
    session('s2', '2026-02-01', { g1: { notWorked: true } }),
  ];
  assert.deepEqual(L.goalSeries(g, sessions).map(p => p.value), [0, 3]);
  assert.equal(L.lastScore('g1', sessions).sessionId, 's3');
  assert.equal(L.lastScore('g1', sessions, { beforeDate: '2026-02-15' }).sessionId, 's1');
  assert.equal(L.lastScore('g1', sessions, { excludeSessionId: 's3' }).sessionId, 's1');
  const sl = L.startedLatest(g, sessions);
  assert.match(sl.text, /^Started No change .*latest Goal met/);
  assert.equal(sl.count, 2);
  assert.equal(L.startedLatest(goal('none', ''), sessions), null);
});

test('trials chart values are percentages', () => {
  const g = goal('t', '', 'trials');
  const series = L.goalSeries(g, [session('s', '2026-01-01', { t: { value: 3, attempts: 4 } })]);
  assert.equal(series[0].value, 75);
});

test('number range includes the target and has nice ticks', () => {
  const r = L.numberRange([12, 18, 25], 40);
  assert.equal(r.min, 0);
  assert.ok(r.max >= 40);
  assert.ok(r.ticks.includes(0) && r.ticks[r.ticks.length - 1] === r.max);
  const flat = L.numberRange([5, 5], null);
  assert.ok(flat.min < 5 && flat.max > 5);
  const wide = L.numberRange([95, 100], null);
  assert.ok(wide.min <= 95 && wide.max >= 100 && wide.min > 0);
});

/* ---------- Backup ---------- */

test('backup round-trips and merges duplicate custom areas', () => {
  const st = L.emptyState();
  st.children.push({ id: 'c1', name: 'AB', createdAt: 1 });
  st.currentChildId = 'c1';
  st.customAreas = ['Feeding', 'feeding', 'Balance'];
  st.goals.push(goal('g1', 'FEEDING'), goal('g2', 'Picnic skills'), goal('orphan', '', 'scale', { childId: 'missing' }));
  st.sessions.push(session('s1', '2026-01-01', { g1: { value: 1 }, gone: { value: 2 } }));
  const back = L.normalizeState(JSON.stringify(L.makeBackup(st)));
  assert.deepEqual(back.customAreas, ['Feeding', 'Picnic skills']);
  assert.equal(back.goals.length, 2);
  assert.equal(back.goals[0].area, 'Feeding');
  assert.deepEqual(Object.keys(back.sessions[0].scores), ['g1']);
});

test('restore rejects things that are not backups', () => {
  assert.throws(() => L.normalizeState('not json'), /not valid/);
  assert.throws(() => L.normalizeState('{"hello": 1}'), /not an OT tracker backup/);
});

test('links are normalized and unsafe schemes rejected', () => {
  assert.equal(L.normalizeLink('example.com/x'), 'https://example.com/x');
  assert.equal(L.normalizeLink('http://a.b'), 'http://a.b');
  assert.equal(L.normalizeLink('javascript:alert(1)'), '');
});
