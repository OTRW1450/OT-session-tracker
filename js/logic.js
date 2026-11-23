/*
 * OT Progress Tracker - pure logic (no DOM, no storage).
 * Shared by the app (window.OTLogic) and the Node tests (require()).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OTLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;

  const BUILTIN_AREAS = [
    'Strength', 'Reflex integration', 'Sensory integration', 'Fine motor',
    'Gross motor', 'Visual motor', 'Oculomotor', 'Perceptual',
    'Executive function', 'Balance', 'Coordination / rhythm', 'Graphomotor',
    'Memory', 'Self-care', 'Handwriting', 'Self-regulation',
  ];

  const NO_AREA = 'No area yet';

  const DEFAULT_ATTEMPTS = 5;
  const MAX_ATTEMPTS = 20;

  /* ---------- Scoring methods ---------- */

  const METHODS = {
    scale: {
      id: 'scale',
      name: 'Progress scale',
      levels: [
        { label: 'No change', hint: 'Same as at the start' },
        { label: 'Emerging', hint: 'Sometimes, with help' },
        { label: 'Developing', hint: 'More often, some support' },
        { label: 'Goal met', hint: 'Consistent, as written' },
      ],
    },
    help: {
      id: 'help',
      name: 'Level of help needed',
      levels: [
        { label: 'Full assist', hint: '' },
        { label: 'Hand-over-hand', hint: '' },
        { label: 'Gesture / model', hint: '' },
        { label: 'Verbal cue', hint: '' },
        { label: 'Independent', hint: '' },
      ],
    },
    trials: { id: 'trials', name: 'Trials out of attempts' },
    number: { id: 'number', name: 'A number' },
  };
  const METHOD_IDS = Object.keys(METHODS);

  /* ---------- Small helpers ---------- */

  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 10);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rnd;
  }

  function cleanText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function isFiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  /** Local date as YYYY-MM-DD (not UTC, so "today" is right in the evening). */
  function todayISO(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function isISODate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function formatDate(iso, opts) {
    if (!isISODate(iso)) return String(iso || '');
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatNumber(n) {
    if (!isFiniteNumber(n)) return '';
    return String(Math.round(n * 100) / 100);
  }

  /* ---------- Areas ---------- */

  /** Built-in areas followed by custom areas, de-duplicated case-insensitively. */
  function allAreas(customAreas) {
    return mergeAreas(BUILTIN_AREAS, customAreas || []);
  }

  function mergeAreas(...lists) {
    const seen = new Map();
    for (const list of lists) {
      for (const raw of list || []) {
        const name = cleanText(raw);
        if (!name) continue;
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, name);
      }
    }
    return Array.from(seen.values());
  }

  /** Return the existing spelling of an area if one matches case-insensitively. */
  function canonicalArea(name, customAreas) {
    const clean = cleanText(name);
    if (!clean) return '';
    const key = clean.toLowerCase();
    const match = allAreas(customAreas).find(a => a.toLowerCase() === key);
    return match || clean;
  }

  /** Add a custom area. Returns { customAreas, area } with area in canonical spelling. */
  function addCustomArea(customAreas, name) {
    const list = mergeAreas(customAreas || []);
    const area = canonicalArea(name, list);
    if (!area) return { customAreas: list, area: '' };
    const known = allAreas(list).some(a => a.toLowerCase() === area.toLowerCase());
    return { customAreas: known ? list : list.concat(area), area };
  }

  /**
   * Group goals under area headings.
   * Areas follow the dropdown order (built-in, then custom); unknown areas follow;
   * goals with no area go last under "No area yet".
   * showHeadings is false when no goal has an area.
   */
  function groupGoalsByArea(goals, customAreas) {
    const order = allAreas(customAreas).map(a => a.toLowerCase());
    const groups = new Map();
    const none = [];
    for (const g of goals) {
      const area = cleanText(g.area);
      if (!area) { none.push(g); continue; }
      const key = area.toLowerCase();
      if (!groups.has(key)) groups.set(key, { area, key, goals: [] });
      groups.get(key).goals.push(g);
    }
    const rank = k => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
    const sorted = Array.from(groups.values()).sort((a, b) =>
      rank(a.key) - rank(b.key) || a.area.localeCompare(b.area));
    const result = sorted.map(g => ({ area: g.area, isNoArea: false, goals: g.goals, count: g.goals.length }));
    if (none.length) result.push({ area: NO_AREA, isNoArea: true, goals: none, count: none.length });
    return { showHeadings: sorted.length > 0, groups: result };
  }

  /** Distinct areas used by these goals, in group order (excludes "No area yet"). */
  function areasInUse(goals, customAreas) {
    return groupGoalsByArea(goals, customAreas).groups.filter(g => !g.isNoArea).map(g => g.area);
  }

  /** Filter buttons only appear when two or more areas are in use. */
  function shouldShowAreaFilter(goals, customAreas) {
    return areasInUse(goals, customAreas).length >= 2;
  }

  function filterGoalsByArea(goals, filter) {
    if (!filter || filter === 'all') return goals;
    if (filter === NO_AREA) return goals.filter(g => !cleanText(g.area));
    const key = filter.toLowerCase();
    return goals.filter(g => cleanText(g.area).toLowerCase() === key);
  }

  /* ---------- Scores ---------- */
  // A score is one of:
  //   { notWorked: true, note }
  //   { value: <level index> }                  scale / help
  //   { value: <successes>, attempts: <n> }     trials
  //   { value: <number> }                       number
  // plus an optional note. A score object with only a note is "note only".

  function hasValue(score) {
    return !!score && !score.notWorked && isFiniteNumber(score.value);
  }

  function isEmptyScore(score) {
    return !score || (!score.notWorked && !isFiniteNumber(score.value) && !cleanText(score.note));
  }

  /** Tapping the selected option again unselects it. */
  function toggleLevel(score, level) {
    const s = Object.assign({}, score || {});
    if (!s.notWorked && s.value === level) delete s.value;
    else { s.value = level; delete s.notWorked; }
    return s;
  }

  function toggleNotWorked(score) {
    const s = Object.assign({}, score || {});
    if (s.notWorked) delete s.notWorked;
    else { s.notWorked = true; delete s.value; }
    return s;
  }

  function clampAttempts(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) return DEFAULT_ATTEMPTS;
    return clamp(n, 1, MAX_ATTEMPTS);
  }

  /** Change attempts; successes above the new attempt count are cleared. */
  function setAttempts(score, attempts) {
    const s = Object.assign({}, score || {});
    s.attempts = clampAttempts(attempts);
    if (isFiniteNumber(s.value) && s.value > s.attempts) delete s.value;
    return s;
  }

  function toggleTrials(score, successes, attempts) {
    const s = toggleLevel(score, successes);
    s.attempts = clampAttempts(attempts);
    return s;
  }

  function trialsPercent(successes, attempts) {
    if (!attempts) return 0;
    return Math.round((successes / attempts) * 100);
  }

  function formatTrials(successes, attempts) {
    return successes + ' of ' + attempts + ' (' + trialsPercent(successes, attempts) + '%)';
  }

  function parseNumberInput(text) {
    const t = String(text == null ? '' : text).trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  function withUnit(n, unit) {
    const u = cleanText(unit);
    if (!u) return formatNumber(n);
    if (u === '%') return formatNumber(n) + '%';
    return formatNumber(n) + ' ' + u;
  }

  /** Short human label for a score, e.g. "Emerging", "3 of 5 (60%)", "12 times". */
  function scoreLabel(goal, score) {
    if (!score) return '';
    if (score.notWorked) return 'Not worked on';
    if (!hasValue(score)) return '';
    const m = METHODS[goal.method];
    if (goal.method === 'trials') return formatTrials(score.value, score.attempts || DEFAULT_ATTEMPTS);
    if (goal.method === 'number') return withUnit(score.value, goal.unit);
    if (m && m.levels && m.levels[score.value]) return m.levels[score.value].label;
    return String(score.value);
  }

  /** Level index for coloring (scale/help), else null. */
  function scoreLevel(goal, score) {
    if (!hasValue(score)) return null;
    if (goal.method === 'scale' || goal.method === 'help') return score.value;
    return null;
  }

  /** Numeric value plotted on the chart. */
  function chartValue(goal, score) {
    if (!hasValue(score)) return null;
    if (goal.method === 'trials') return trialsPercent(score.value, score.attempts || DEFAULT_ATTEMPTS);
    return score.value;
  }

  /* ---------- Sessions ---------- */

  function sortSessions(sessions, newestFirst) {
    const s = sessions.slice().sort((a, b) =>
      a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : (a.date < b.date ? -1 : 1));
    return newestFirst ? s.reverse() : s;
  }

  function goalHasScores(goalId, sessions) {
    return sessions.some(s => s.scores && s.scores[goalId] && (hasValue(s.scores[goalId]) || s.scores[goalId].notWorked));
  }

  /** The scoring method can be changed only before any session has scored this goal. */
  function canChangeMethod(goal, sessions) {
    return !goal || !goalHasScores(goal.id, sessions);
  }

  /** Chronological points for a goal: [{date, value, score, sessionId}] (scored only). */
  function goalSeries(goal, sessions) {
    const out = [];
    for (const s of sortSessions(sessions)) {
      const sc = s.scores && s.scores[goal.id];
      if (hasValue(sc)) out.push({ date: s.date, value: chartValue(goal, sc), score: sc, sessionId: s.id });
    }
    return out;
  }

  /**
   * Most recent scored result for a goal, optionally only before a date and
   * ignoring one session (the one being edited).
   */
  function lastScore(goalId, sessions, opts) {
    opts = opts || {};
    const list = sortSessions(sessions, true);
    for (const s of list) {
      if (opts.excludeSessionId && s.id === opts.excludeSessionId) continue;
      if (opts.beforeDate && s.date > opts.beforeDate) continue;
      const sc = s.scores && s.scores[goalId];
      if (hasValue(sc)) return { date: s.date, score: sc, sessionId: s.id };
    }
    return null;
  }

  /** "Started Emerging, latest Goal met" (or null when nothing scored). */
  function startedLatest(goal, sessions) {
    const series = goalSeries(goal, sessions);
    if (!series.length) return null;
    const first = series[0], last = series[series.length - 1];
    return {
      first, last, count: series.length,
      text: 'Started ' + scoreLabel(goal, first.score) + ' (' + formatDate(first.date) + '), latest ' +
        scoreLabel(goal, last.score) + ' (' + formatDate(last.date) + ')',
    };
  }

  /** Default attempts for a trials goal: its last used count, else the global last, else 5. */
  function defaultAttempts(goal, sessions, globalLast) {
    const last = lastScore(goal.id, sessions);
    if (last && last.score.attempts) return clampAttempts(last.score.attempts);
    if (globalLast) return clampAttempts(globalLast);
    return DEFAULT_ATTEMPTS;
  }

  /** Remove empty scores; returns a new scores object. */
  function cleanScores(scores) {
    const out = {};
    for (const [id, sc] of Object.entries(scores || {})) {
      if (isEmptyScore(sc)) continue;
      const c = {};
      if (sc.notWorked) c.notWorked = true;
      else if (isFiniteNumber(sc.value)) c.value = sc.value;
      if (isFiniteNumber(sc.attempts) && isFiniteNumber(c.value)) c.attempts = sc.attempts;
      const note = String(sc.note || '').trim();
      if (note) c.note = note;
      out[id] = c;
    }
    return out;
  }

  /* ---------- Chart scale ---------- */

  function niceStep(range, targetTicks) {
    const raw = range / Math.max(1, targetTicks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  /** Auto range for number goals, including the target. Returns {min, max, ticks}. */
  function numberRange(values, target) {
    const vals = values.filter(isFiniteNumber);
    if (isFiniteNumber(target)) vals.push(target);
    if (!vals.length) return { min: 0, max: 10, ticks: [0, 5, 10] };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo >= 0 && lo <= hi * 0.5) lo = 0; // anchor to zero when it is close
    if (lo === hi) { const pad = Math.abs(lo) * 0.2 || 1; lo -= pad; hi += pad; if (values.every(v => v >= 0) && lo < 0) lo = 0; }
    const step = niceStep(hi - lo, 3);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    return { min, max, ticks };
  }

  /* ---------- Data model ---------- */

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      children: [],
      currentChildId: null,
      customAreas: [],
      goals: [],
      sessions: [],
      lastAttempts: DEFAULT_ATTEMPTS,
    };
  }

  function normalizeLink(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // reject javascript:, data:, etc.
    return 'https://' + u;
  }

  /**
   * Validate and normalize data (from storage or a backup).
   * Throws an Error with a friendly message if it isn't tracker data.
   */
  function normalizeState(raw) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { throw new Error('That is not valid backup text (JSON could not be read).'); }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That file is not an OT tracker backup.');
    if (raw.app === 'ot-progress-tracker' && raw.data) raw = raw.data;
    if (!Array.isArray(raw.children) || !Array.isArray(raw.goals)) throw new Error('That file is not an OT tracker backup.');

    const st = emptyState();
    const childIds = new Set();
    for (const c of raw.children) {
      if (!c || !c.id) continue;
      childIds.add(String(c.id));
      st.children.push({ id: String(c.id), name: cleanText(c.name) || 'Child', createdAt: Number(c.createdAt) || Date.now() });
    }

    st.customAreas = mergeAreas(raw.customAreas || []).filter(a =>
      !BUILTIN_AREAS.some(b => b.toLowerCase() === a.toLowerCase()));

    const goalIds = new Set();
    for (const g of raw.goals) {
      if (!g || !g.id || !childIds.has(String(g.childId))) continue;
      const method = METHOD_IDS.includes(g.method) ? g.method : 'scale';
      let area = canonicalArea(g.area, st.customAreas);
      if (area && !allAreas(st.customAreas).some(a => a.toLowerCase() === area.toLowerCase())) {
        st.customAreas.push(area);
      }
      const ideas = Array.isArray(g.ideas) ? g.ideas.filter(Boolean).map(i => ({
        id: String(i.id || uid('idea')),
        text: String(i.text || '').trim(),
        links: (Array.isArray(i.links) ? i.links : []).map(normalizeLink).filter(Boolean),
        media: (Array.isArray(i.media) ? i.media : []).filter(m => m && m.id).map(m => ({
          id: String(m.id), kind: m.kind === 'video' ? 'video' : 'photo', name: String(m.name || ''),
        })),
      })) : [];
      goalIds.add(String(g.id));
      st.goals.push({
        id: String(g.id),
        childId: String(g.childId),
        text: String(g.text || '').trim() || 'Untitled goal',
        area,
        method,
        unit: method === 'number' ? cleanText(g.unit) : '',
        target: method === 'number' && isFiniteNumber(Number(g.target)) && g.target !== '' && g.target !== null ? Number(g.target) : null,
        archived: !!g.archived,
        createdAt: Number(g.createdAt) || Date.now(),
        ideas,
      });
    }

    for (const s of Array.isArray(raw.sessions) ? raw.sessions : []) {
      if (!s || !s.id || !childIds.has(String(s.childId)) || !isISODate(s.date)) continue;
      const scores = {};
      for (const [gid, sc] of Object.entries(cleanScores(s.scores))) if (goalIds.has(gid)) scores[gid] = sc;
      st.sessions.push({
        id: String(s.id), childId: String(s.childId), date: s.date,
        note: String(s.note || '').trim(), scores,
        createdAt: Number(s.createdAt) || Date.now(), updatedAt: Number(s.updatedAt) || Number(s.createdAt) || Date.now(),
      });
    }

    st.currentChildId = childIds.has(String(raw.currentChildId)) ? String(raw.currentChildId)
      : (st.children[0] ? st.children[0].id : null);
    st.lastAttempts = clampAttempts(raw.lastAttempts || DEFAULT_ATTEMPTS);
    return st;
  }

  function makeBackup(state) {
    return {
      app: 'ot-progress-tracker',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      note: 'Photos and videos are not included in this backup.',
      data: state,
    };
  }

  /** Every media id belonging to a list of goals (for cleanup on delete). */
  function mediaIdsForGoals(goals) {
    const ids = [];
    for (const g of goals) for (const i of g.ideas || []) for (const m of i.media || []) ids.push(m.id);
    return ids;
  }

  return {
    SCHEMA_VERSION, BUILTIN_AREAS, NO_AREA, METHODS, METHOD_IDS, DEFAULT_ATTEMPTS, MAX_ATTEMPTS,
    uid, cleanText, todayISO, isISODate, formatDate, formatNumber,
    allAreas, mergeAreas, canonicalArea, addCustomArea,
    groupGoalsByArea, areasInUse, shouldShowAreaFilter, filterGoalsByArea,
    hasValue, isEmptyScore, toggleLevel, toggleNotWorked, clampAttempts, setAttempts, toggleTrials,
    trialsPercent, formatTrials, parseNumberInput, withUnit, scoreLabel, scoreLevel, chartValue,
    sortSessions, goalHasScores, canChangeMethod, goalSeries, lastScore, startedLatest, defaultAttempts, cleanScores,
    numberRange, emptyState, normalizeLink, normalizeState, makeBackup, mediaIdsForGoals,
  };
});
