/*
 * OT Progress Tracker - UI.
 * All data stays on this device: localStorage for records, IndexedDB for photos/videos.
 * No network requests, no analytics.
 */
(function () {
  'use strict';

  const L = window.OTLogic;
  const Media = window.OTMedia;

  const STORE_KEY = 'otProgressTracker.v2';
  const DRAFT_KEY = 'otProgressTracker.drafts.v2';
  const UI_KEY = 'otProgressTracker.ui.v2';
  const CONFIRM_MS = 6000;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ================= State ================= */

  let state = L.emptyState();
  let drafts = {};            // childId -> { date, note, scores, editingSessionId }
  let ui = { tab: 'score', filter: { score: 'all', progress: 'all' } };
  let sheet = null;           // what the bottom sheet / dialog is showing
  let mediaAvailable = null;  // null = unknown yet
  let storageOk = true;
  const openNotes = new Set(); // goal ids whose note box is open on Score session

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) state = L.normalizeState(raw);
    } catch (e) {
      console.warn('Could not read saved data', e);
      storageOk = false;
    }
    try { drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch (e) { drafts = {}; }
    try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* defaults */ }
    if (!['score', 'goals', 'progress'].includes(ui.tab)) ui.tab = 'score';
    ui.filter = Object.assign({ score: 'all', progress: 'all' }, ui.filter);
  }

  function persist(message) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOk = true;
      setStatus(message || 'Saved', 'ok');
    } catch (e) {
      storageOk = false;
      setStatus('Could not save - storage is full or blocked. Make a backup now.', 'error', true);
    }
  }

  function persistDrafts() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (e) { /* drafts are best effort */ }
  }

  function persistUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, filter: ui.filter })); } catch (e) { /* ignore */ }
  }

  let statusTimer = null;
  function setStatus(text, kind, sticky) {
    const el = $('#saveStatus');
    // Keep the note visible above an open dialog (dialogs sit in the top layer).
    const sheetEl = $('#sheet');
    const host = sheetEl.open ? sheetEl : document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = text;
    el.className = 'save-status show ' + (kind || '');
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => { el.className = 'save-status ' + (kind || ''); }, 2500);
  }

  /* ================= Accessors ================= */

  const currentChild = () => state.children.find(c => c.id === state.currentChildId) || null;
  const childGoals = (childId) => state.goals.filter(g => g.childId === (childId || state.currentChildId));
  const activeGoals = () => childGoals().filter(g => !g.archived);
  const childSessions = (childId) => state.sessions.filter(s => s.childId === (childId || state.currentChildId));
  const goalById = (id) => state.goals.find(g => g.id === id);

  function getDraft() {
    const id = state.currentChildId;
    if (!id) return null;
    if (!drafts[id]) drafts[id] = { date: L.todayISO(), note: '', scores: {}, editingSessionId: null };
    const d = drafts[id];
    if (!L.isISODate(d.date)) d.date = L.todayISO();
    d.scores = d.scores || {};
    return d;
  }

  /** Goals shown on Score session: active ones, plus any in the session being edited. */
  function scoringGoals() {
    const d = getDraft();
    const ids = new Set(d && d.editingSessionId ? Object.keys(d.scores) : []);
    return childGoals().filter(g => !g.archived || ids.has(g.id));
  }

  /* ================= Helpers ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  function shortDate(iso) { return L.formatDate(iso, { month: 'short', day: 'numeric' }); }

  function methodName(goal) { return L.METHODS[goal.method] ? L.METHODS[goal.method].name : ''; }

  function confirmBtn(action, attrs, label, confirmLabel, cls) {
    return '<button type="button" class="btn ' + (cls || 'btn-danger-quiet') + '" data-action="' + action + '" ' + attrs +
      ' data-confirm="' + esc(confirmLabel || 'Tap again to delete') + '">' + esc(label) + '</button>';
  }

  /* ================= Rendering: shell ================= */

  function renderAll() {
    renderHeader();
    renderTabs();
    renderScore();
    renderGoals();
    renderProgress();
  }

  function renderHeader() {
    const sel = $('#childSelect');
    const kids = state.children;
    sel.innerHTML = kids.length
      ? kids.map(c => '<option value="' + esc(c.id) + '"' + (c.id === state.currentChildId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
      : '<option value="">No children yet</option>';
    sel.disabled = !kids.length;
  }

  function renderTabs() {
    $$('.tab').forEach(t => {
      const on = t.dataset.tab === ui.tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + ui.tab; });
    document.body.dataset.tab = ui.tab;
  }

  function noChildPanel() {
    return '<div class="card empty">' +
      '<h2>Welcome</h2>' +
      '<p>Start by adding a child. <strong>Use initials or a nickname - never a full name.</strong></p>' +
      addChildForm('welcome') +
      '<p class="muted small">Everything you enter stays on this device. Use <em>Backup</em> regularly.</p>' +
      '</div>';
  }

  function addChildForm(where) {
    return '<form class="inline-form" data-form="add-child" data-where="' + where + '">' +
      '<label class="field"><span>Initials or nickname</span>' +
      '<input name="name" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="e.g. J.R. or Bug" required></label>' +
      '<button class="btn btn-primary" type="submit">Add child</button></form>';
  }

  function areaFilterBar(goals, which) {
    if (!L.shouldShowAreaFilter(goals, state.customAreas)) return '';
    const grouped = L.groupGoalsByArea(goals, state.customAreas).groups;
    const cur = ui.filter[which] || 'all';
    const btn = (value, label, count) =>
      '<button type="button" class="chip-filter" data-action="filter" data-which="' + which + '" data-value="' + esc(value) +
      '" aria-pressed="' + (cur === value) + '">' + esc(label) + (count != null ? ' <span class="count">' + count + '</span>' : '') + '</button>';
    return '<div class="filter-bar" role="group" aria-label="Filter by area">' +
      btn('all', 'All areas', goals.length) +
      grouped.map(g => btn(g.area, g.area, g.count)).join('') + '</div>';
  }

  /** Apply the area filter, resetting it if that area is no longer present. */
  function applyFilter(goals, which) {
    const cur = ui.filter[which] || 'all';
    if (cur === 'all' || !L.shouldShowAreaFilter(goals, state.customAreas)) return goals;
    const res = L.filterGoalsByArea(goals, cur);
    if (!res.length) { ui.filter[which] = 'all'; return goals; }
    return res;
  }

  function groupedHTML(goals, renderItem) {
    const { showHeadings, groups } = L.groupGoalsByArea(goals, state.customAreas);
    return groups.map(g =>
      '<section class="area-group">' +
      (showHeadings ? '<h2 class="area-heading">' + esc(g.area) + ' <span class="count" aria-label="' + plural(g.count, 'goal') + '">' + g.count + '</span></h2>' : '') +
      g.goals.map(renderItem).join('') + '</section>').join('');
  }

  /* ================= Score session tab ================= */

  function renderScore() {
    const el = $('#tab-score');
    if (!currentChild()) { el.innerHTML = noChildPanel(); return; }
    const d = getDraft();
    const all = scoringGoals();
    let html = '';

    if (d.editingSessionId) {
      html += '<div class="banner" role="status">Editing the saved session from <strong>' + esc(L.formatDate(d.date)) +
        '</strong>. <button type="button" class="btn btn-small" data-action="cancel-edit">Cancel edit</button></div>';
    }

    html += '<div class="card session-head">' +
      '<label class="field field-date"><span>Session date</span>' +
      '<input type="date" id="sessionDate" value="' + esc(d.date) + '" max="9999-12-31" required></label>' +
      (d.date !== L.todayISO() ? '<button type="button" class="btn btn-small" data-action="date-today">Today</button>' : '') +
      '</div>';

    if (!all.length) {
      html += '<div class="card empty"><p>No active goals for <strong>' + esc(currentChild().name) + '</strong> yet.</p>' +
        '<button type="button" class="btn btn-primary" data-action="new-goal">Add a goal</button></div>';
      el.innerHTML = html;
      return;
    }

    html += areaFilterBar(all, 'score');
    const shown = applyFilter(all, 'score');
    html += groupedHTML(shown, scoreCard);
    if (shown.length < all.length) {
      html += '<p class="muted small center">' + plural(all.length - shown.length, 'goal') + ' hidden by the area filter. Hidden scores are still saved.</p>';
    }

    html += '<div class="card"><label class="field"><span>Overall session note <em class="muted">(optional)</em></span>' +
      '<textarea id="sessionNote" rows="3" data-input="session-note" placeholder="How the session went overall">' + esc(d.note) + '</textarea></label></div>';

    html += '<div class="save-bar"><button type="button" class="btn btn-primary btn-big" data-action="save-session" id="saveSessionBtn">' +
      saveLabel() + '</button></div>';
    el.innerHTML = html;
  }

  function saveLabel() {
    const d = getDraft();
    const n = Object.keys(L.cleanScores(d.scores)).length;
    const verb = d.editingSessionId ? 'Save changes' : 'Save session';
    return esc(verb) + (n ? ' <span class="btn-sub">' + plural(n, 'goal') + '</span>' : '');
  }

  function updateSaveLabel() {
    const b = $('#saveSessionBtn');
    if (b) b.innerHTML = saveLabel();
  }

  function scoreCard(goal) {
    const d = getDraft();
    const sc = d.scores[goal.id] || {};
    const last = L.lastScore(goal.id, childSessions(), { beforeDate: d.date, excludeSessionId: d.editingSessionId });
    const noteOpen = openNotes.has(goal.id) || !!(sc.note && sc.note.trim());
    const ideasN = (goal.ideas || []).length;

    let controls = '';
    if (goal.method === 'scale' || goal.method === 'help') controls = levelButtons(goal, sc);
    else if (goal.method === 'trials') controls = trialsControls(goal, sc);
    else controls = numberControls(goal, sc);

    return '<article class="card goal-card" data-goal-card="' + esc(goal.id) + '">' +
      '<h3 class="goal-text">' + esc(goal.text) + (goal.archived ? ' <span class="tag">Archived</span>' : '') + '</h3>' +
      '<p class="goal-meta">' + esc(methodName(goal)) +
      (goal.method === 'number' && goal.target != null ? ' · <strong>Target: ' + esc(L.withUnit(goal.target, goal.unit)) + '</strong>' : '') + '</p>' +
      '<p class="last-time">' + (last
        ? 'Last time: <strong>' + esc(L.scoreLabel(goal, last.score)) + '</strong> <span class="muted">(' + esc(L.formatDate(last.date)) + ')</span>'
        : '<span class="muted">Last time: not scored yet</span>') + '</p>' +
      controls +
      '<div class="card-actions">' +
      '<button type="button" class="btn btn-quiet" data-action="not-worked" data-goal="' + esc(goal.id) + '" data-fk="nw" aria-pressed="' + !!sc.notWorked + '">' +
      (sc.notWorked ? '✓ ' : '') + 'Not worked on</button>' +
      (noteOpen ? '' : '<button type="button" class="btn btn-quiet" data-action="open-note" data-goal="' + esc(goal.id) + '">+ Note</button>') +
      '<button type="button" class="btn btn-quiet" data-action="open-ideas" data-goal="' + esc(goal.id) + '">Ideas (' + ideasN + ')</button>' +
      '</div>' +
      (noteOpen ? '<label class="field note-field"><span>Note for this goal</span><textarea rows="2" data-input="goal-note" data-goal="' +
        esc(goal.id) + '" data-fk="note">' + esc(sc.note || '') + '</textarea></label>' : '') +
      '</article>';
  }

  function levelButtons(goal, sc) {
    const levels = L.METHODS[goal.method].levels;
    return '<div class="levels levels-' + levels.length + '" role="group" aria-label="' + esc(methodName(goal)) + '">' +
      levels.map((lv, i) => {
        const on = !sc.notWorked && sc.value === i;
        return '<button type="button" class="level c-' + goal.method + '-' + i + '" data-action="level" data-goal="' + esc(goal.id) +
          '" data-value="' + i + '" data-fk="lv' + i + '" aria-pressed="' + on + '">' +
          '<span class="level-mark" aria-hidden="true"></span>' +
          '<span class="level-text"><strong>' + esc(lv.label) + '</strong>' + (lv.hint ? '<small>' + esc(lv.hint) + '</small>' : '') + '</span>' +
          '<span class="check" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
      }).join('') + '</div>';
  }

  function trialsControls(goal, sc) {
    const attempts = sc.attempts || L.defaultAttempts(goal, childSessions(), state.lastAttempts);
    const val = !sc.notWorked && Number.isFinite(sc.value) ? sc.value : null;
    let chips = '';
    for (let i = 0; i <= attempts; i++) {
      chips += '<button type="button" class="num-chip" data-action="trial" data-goal="' + esc(goal.id) + '" data-value="' + i +
        '" data-attempts="' + attempts + '" data-fk="t' + i + '" aria-pressed="' + (val === i) + '" aria-label="' + i + ' of ' + attempts + ' went well">' + i + '</button>';
    }
    return '<div class="trials">' +
      '<div class="stepper" role="group" aria-label="Number of attempts">' +
      '<span class="stepper-label">Attempts</span>' +
      '<button type="button" class="step-btn" data-action="attempts" data-goal="' + esc(goal.id) + '" data-delta="-1" data-attempts="' + attempts +
      '" data-fk="a-" aria-label="Fewer attempts"' + (attempts <= 1 ? ' disabled' : '') + '>−</button>' +
      '<output class="stepper-value" aria-live="polite">' + attempts + '</output>' +
      '<button type="button" class="step-btn" data-action="attempts" data-goal="' + esc(goal.id) + '" data-delta="1" data-attempts="' + attempts +
      '" data-fk="a+" aria-label="More attempts"' + (attempts >= L.MAX_ATTEMPTS ? ' disabled' : '') + '>+</button></div>' +
      '<p class="chips-label">How many went well?</p>' +
      '<div class="num-chips" role="group" aria-label="How many went well">' + chips + '</div>' +
      '<p class="trial-result" aria-live="polite">' + (val != null ? '<strong>' + esc(L.formatTrials(val, attempts)) + '</strong>' : '<span class="muted">Not scored</span>') + '</p>' +
      '</div>';
  }

  function numberControls(goal, sc) {
    const val = !sc.notWorked && Number.isFinite(sc.value) ? L.formatNumber(sc.value) : '';
    const id = 'num_' + goal.id;
    return '<div class="number-row">' +
      '<label class="field" for="' + esc(id) + '"><span>Result' + (goal.unit ? ' (' + esc(goal.unit) + ')' : '') + '</span></label>' +
      '<div class="number-input"><input id="' + esc(id) + '" type="text" inputmode="decimal" autocomplete="off" data-input="number" data-goal="' +
      esc(goal.id) + '" data-fk="num" value="' + esc(val) + '" placeholder="–">' +
      (goal.unit ? '<span class="unit">' + esc(goal.unit) + '</span>' : '') + '</div>' +
      '<p class="input-error" hidden>Please enter a number.</p></div>';
  }

  function rerenderScoreCard(goalId) {
    const old = $('[data-goal-card="' + CSS.escape(goalId) + '"]');
    const goal = goalById(goalId);
    if (!old || !goal) { renderScore(); return; }
    const focused = document.activeElement && old.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = scoreCard(goal);
    const fresh = tmp.firstElementChild;
    old.replaceWith(fresh);
    if (focused) { const f = $('[data-fk="' + focused + '"]', fresh); if (f) f.focus(); }
    updateSaveLabel();
  }

  function setDraftScore(goalId, score) {
    const d = getDraft();
    if (L.isEmptyScore(score)) delete d.scores[goalId];
    else d.scores[goalId] = score;
    persistDrafts();
  }

  function saveSession() {
    const d = getDraft();
    if (!L.isISODate(d.date)) { setStatus('Please choose a session date.', 'error'); $('#sessionDate')?.focus(); return; }
    const validIds = new Set(childGoals().map(g => g.id));
    const scores = {};
    for (const [id, sc] of Object.entries(L.cleanScores(d.scores))) if (validIds.has(id)) scores[id] = sc;
    const note = String(d.note || '').trim();
    if (!Object.keys(scores).length && !note) {
      setStatus('Nothing to save yet - score at least one goal or add a note.', 'error');
      return;
    }
    for (const sc of Object.values(scores)) if (sc.attempts) state.lastAttempts = sc.attempts;

    const now = Date.now();
    let msg = 'Session saved';
    const existing = d.editingSessionId && state.sessions.find(s => s.id === d.editingSessionId);
    if (existing) {
      Object.assign(existing, { date: d.date, note, scores, updatedAt: now });
      msg = 'Session updated';
    } else {
      state.sessions.push({ id: L.uid('ses'), childId: state.currentChildId, date: d.date, note, scores, createdAt: now, updatedAt: now });
    }
    delete drafts[state.currentChildId];
    openNotes.clear();
    persistDrafts();
    persist(msg);
    renderScore();
    renderProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startEditSession(sessionId) {
    const s = state.sessions.find(x => x.id === sessionId);
    if (!s) return;
    drafts[s.childId] = { date: s.date, note: s.note || '', scores: JSON.parse(JSON.stringify(s.scores || {})), editingSessionId: s.id };
    persistDrafts();
    openNotes.clear();
    ui.filter.score = 'all';
    switchTab('score');
    window.scrollTo({ top: 0 });
  }

  /* ================= Goals tab ================= */

  function renderGoals() {
    const el = $('#tab-goals');
    if (!currentChild()) { el.innerHTML = noChildPanel(); return; }
    const goals = childGoals();
    const active = goals.filter(g => !g.archived);
    const archived = goals.filter(g => g.archived);
    let html = '<div class="toolbar"><h2 class="panel-title">Goals for ' + esc(currentChild().name) + '</h2>' +
      '<button type="button" class="btn btn-primary" data-action="new-goal">+ Add goal</button></div>';

    if (!active.length) {
      html += '<div class="card empty"><p>No active goals yet. Tap <strong>Add goal</strong> to write the first one.</p></div>';
    } else {
      html += groupedHTML(active, goalRow);
    }
    if (archived.length) {
      html += '<details class="archived"' + (ui.archivedOpen ? ' open' : '') + ' data-toggle="archived"><summary>Archived goals (' + archived.length + ')</summary>' +
        archived.map(goalRow).join('') + '</details>';
    }
    el.innerHTML = html;
  }

  function goalRow(goal) {
    const id = esc(goal.id);
    const n = (goal.ideas || []).length;
    return '<article class="card goal-row">' +
      '<h3 class="goal-text">' + esc(goal.text) + '</h3>' +
      '<p class="goal-meta">' + esc(methodName(goal)) +
      (goal.method === 'number' && goal.target != null ? ' · Target ' + esc(L.withUnit(goal.target, goal.unit)) : '') +
      (goal.method === 'number' && goal.unit && goal.target == null ? ' · ' + esc(goal.unit) : '') +
      (!goal.area ? ' · <span class="muted">No area yet</span>' : (goal.archived ? ' · ' + esc(goal.area) : '')) + '</p>' +
      '<div class="card-actions">' +
      (goal.archived
        ? '<button type="button" class="btn btn-quiet" data-action="restore-goal" data-goal="' + id + '">Restore</button>' +
          confirmBtn('delete-goal', 'data-goal="' + id + '"', 'Delete', 'Tap again to delete goal and its scores')
        : '<button type="button" class="btn btn-quiet" data-action="edit-goal" data-goal="' + id + '">Edit</button>' +
          '<button type="button" class="btn btn-quiet" data-action="open-ideas" data-goal="' + id + '">Ideas (' + n + ')</button>' +
          '<button type="button" class="btn btn-quiet" data-action="archive-goal" data-goal="' + id + '">Archive</button>') +
      '</div></article>';
  }

  /* ---------- Goal editor ---------- */

  function goalEditorHTML() {
    const goal = sheet.goalId ? goalById(sheet.goalId) : null;
    const f = sheet.form;
    const canChange = L.canChangeMethod(goal, state.sessions);
    const areas = L.allAreas(state.customAreas);
    const areaOpts = '<option value="">- No area -</option>' +
      areas.map(a => '<option value="' + esc(a) + '"' + (f.area.toLowerCase() === a.toLowerCase() ? ' selected' : '') + '>' + esc(a) + '</option>').join('') +
      '<option value="__new__"' + (f.area === '__new__' ? ' selected' : '') + '>+ Add a new area</option>';

    const methodDesc = {
      scale: 'No change · Emerging · Developing · Goal met',
      help: 'Full assist → Independent',
      trials: 'e.g. 3 of 5 (60%)',
      number: 'A measurement such as %, minutes or times',
    };
    const methods = L.METHOD_IDS.map(m =>
      '<label class="radio-card' + (!canChange ? ' disabled' : '') + '"><input type="radio" name="method" value="' + m + '"' +
      (f.method === m ? ' checked' : '') + (!canChange ? ' disabled' : '') + '><span><strong>' + esc(L.METHODS[m].name) +
      '</strong><small>' + esc(methodDesc[m]) + '</small></span></label>').join('');

    return '<form data-form="goal" class="stack">' +
      '<label class="field"><span>Goal</span><textarea name="text" rows="3" required placeholder="e.g. Will cut along a curved line staying within ½ inch">' + esc(f.text) + '</textarea></label>' +
      '<label class="field"><span>Area</span><select name="area" data-input="goal-area">' + areaOpts + '</select></label>' +
      (f.area === '__new__' ? '<label class="field"><span>New area name</span><input name="newArea" maxlength="40" value="' + esc(f.newArea || '') +
        '" placeholder="e.g. Feeding" autocomplete="off"><small class="muted">New areas are available for every child.</small></label>' : '') +
      '<fieldset class="field"><legend>How will you score it?</legend>' +
      (!canChange ? '<p class="note">This goal already has scored sessions, so the scoring method can’t be changed.</p>' : '') +
      '<div class="radio-cards">' + methods + '</div></fieldset>' +
      (f.method === 'number'
        ? '<div class="row-2"><label class="field"><span>Unit</span><input name="unit" list="unitList" maxlength="20" value="' + esc(f.unit) +
          '" placeholder="%, minutes, times…" autocomplete="off"></label>' +
          '<label class="field"><span>Target <em class="muted">(optional)</em></span><input name="target" inputmode="decimal" autocomplete="off" value="' +
          esc(f.target) + '" placeholder="e.g. 80"></label></div>' +
          '<datalist id="unitList"><option value="%"><option value="minutes"><option value="seconds"><option value="times"><option value="reps"><option value="steps"><option value="feet"><option value="inches"><option value="words per minute"></datalist>'
        : '') +
      '<p class="form-error" role="alert" hidden></p>' +
      '<div class="sheet-actions">' +
      (goal ? confirmBtn('delete-goal', 'data-goal="' + esc(goal.id) + '"', 'Delete goal', 'Tap again to delete goal and its scores') : '') +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn" data-action="close-sheet">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (goal ? 'Save goal' : 'Add goal') + '</button></div></form>';
  }

  function openGoalEditor(goalId) {
    const g = goalId ? goalById(goalId) : null;
    sheet = {
      type: 'goal', goalId: g ? g.id : null,
      form: {
        text: g ? g.text : '', area: g ? (g.area || '') : '', newArea: '',
        method: g ? g.method : 'scale', unit: g ? g.unit : '', target: g && g.target != null ? String(g.target) : '',
      },
    };
    showSheet(g ? 'Edit goal' : 'Add a goal');
  }

  /** Copy form fields into sheet.form so a re-render keeps what was typed. */
  function readGoalForm(form) {
    const f = sheet.form;
    f.text = form.elements.text.value;
    f.area = form.elements.area.value;
    if (form.elements.newArea) f.newArea = form.elements.newArea.value;
    const m = form.querySelector('input[name=method]:checked');
    if (m) f.method = m.value;
    if (form.elements.unit) f.unit = form.elements.unit.value;
    if (form.elements.target) f.target = form.elements.target.value;
  }

  function submitGoal(form) {
    readGoalForm(form);
    const f = sheet.form;
    const err = $('.form-error', form);
    const fail = (msg, el) => { err.textContent = msg; err.hidden = false; if (el) el.focus(); };
    const text = f.text.trim();
    if (!text) return fail('Please write the goal.', form.elements.text);

    let area = '';
    if (f.area === '__new__') {
      const res = L.addCustomArea(state.customAreas, f.newArea);
      if (!res.area) return fail('Please name the new area.', form.elements.newArea);
      state.customAreas = res.customAreas;
      area = res.area;
    } else {
      area = L.canonicalArea(f.area, state.customAreas);
    }

    let target = null;
    if (f.method === 'number' && String(f.target).trim() !== '') {
      target = L.parseNumberInput(f.target);
      if (target == null) return fail('The target must be a number.', form.elements.target);
    }

    const existing = sheet.goalId ? goalById(sheet.goalId) : null;
    const method = existing && !L.canChangeMethod(existing, state.sessions) ? existing.method : f.method;
    const fields = { text, area, method, unit: method === 'number' ? L.cleanText(f.unit) : '', target: method === 'number' ? target : null };

    if (existing) {
      if (existing.method !== method) {
        for (const d of Object.values(drafts)) if (d.scores) delete d.scores[existing.id];
        persistDrafts();
      }
      Object.assign(existing, fields);
      persist('Goal saved');
    } else {
      state.goals.push(Object.assign({ id: L.uid('goal'), childId: state.currentChildId, archived: false, createdAt: Date.now(), ideas: [] }, fields));
      persist('Goal added');
    }
    closeSheet();
    renderAll();
  }

  function deleteGoal(goalId) {
    const g = goalById(goalId);
    if (!g) return;
    Media.remove(L.mediaIdsForGoals([g]));
    state.goals = state.goals.filter(x => x.id !== goalId);
    state.sessions = state.sessions.filter(s => {
      if (s.scores) delete s.scores[goalId];
      return Object.keys(s.scores || {}).length || (s.note || '').trim();
    });
    for (const d of Object.values(drafts)) if (d.scores) delete d.scores[goalId];
    persistDrafts();
    persist('Goal deleted');
    if (sheet && sheet.goalId === goalId) closeSheet();
    renderAll();
  }

  /* ================= Treatment ideas ================= */

  function openIdeas(goalId) {
    sheet = { type: 'ideas', goalId, edit: null };
    showSheet('Treatment ideas');
    checkMedia();
  }

  function ideasHTML() {
    const goal = goalById(sheet.goalId);
    if (!goal) return '<p>This goal no longer exists.</p>';
    let html = '<p class="sheet-goal">' + esc(goal.text) + '</p>';
    if (mediaAvailable === false) {
      html += '<p class="note">Photo and video storage isn’t available in this browser (for example in private browsing). You can still add ideas and links.</p>';
    }
    const ideas = goal.ideas || [];
    if (!sheet.edit) {
      html += ideas.length ? ideas.map(ideaView).join('') : '<p class="muted">No ideas yet.</p>';
      html += '<div class="sheet-actions"><span class="spacer"></span><button type="button" class="btn btn-primary" data-action="new-idea">+ Add idea</button></div>';
      return html;
    }
    return html + ideaForm();
  }

  function mediaThumbs(media, removable) {
    if (!media || !media.length) return '';
    return '<div class="media-grid">' + media.map(m =>
      '<figure class="media-item" data-media-wrap="' + esc(m.id) + '">' +
      (m.kind === 'video'
        ? '<video data-media-id="' + esc(m.id) + '" controls playsinline preload="metadata" aria-label="Video' + (m.name ? ': ' + esc(m.name) : '') + '"></video>'
        : '<button type="button" class="thumb-btn" data-action="view-photo" data-media="' + esc(m.id) + '" aria-label="Enlarge photo">' +
          '<img data-media-id="' + esc(m.id) + '" alt="Photo' + (m.name ? ': ' + esc(m.name) : '') + '"></button>') +
      (removable ? '<button type="button" class="btn btn-small btn-danger-quiet" data-action="remove-media" data-media="' + esc(m.id) + '">Remove</button>' : '') +
      '</figure>').join('') + '</div>';
  }

  function linksHTML(links) {
    if (!links || !links.length) return '';
    return '<ul class="links">' + links.map(u =>
      '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u.replace(/^https?:\/\//i, '')) + '</a></li>').join('') + '</ul>';
  }

  function ideaView(idea) {
    return '<article class="idea">' +
      (idea.text ? '<p class="idea-text">' + esc(idea.text).replace(/\n/g, '<br>') + '</p>' : '') +
      mediaThumbs(idea.media, false) + linksHTML(idea.links) +
      '<div class="card-actions"><button type="button" class="btn btn-quiet btn-small" data-action="edit-idea" data-idea="' + esc(idea.id) + '">Edit</button>' +
      confirmBtn('delete-idea', 'data-idea="' + esc(idea.id) + '"', 'Delete', 'Tap again to delete idea', 'btn-danger-quiet btn-small') +
      '</div></article>';
  }

  function ideaForm() {
    const e = sheet.edit;
    return '<form data-form="idea" class="stack idea-form">' +
      '<label class="field"><span>Idea</span><textarea name="text" rows="3" placeholder="e.g. Tong pick-up race with pom-poms">' + esc(e.text) + '</textarea></label>' +
      '<label class="field"><span>Web links <em class="muted">(optional, one per line)</em></span><textarea name="links" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…">' +
      esc(e.links) + '</textarea></label>' +
      (mediaAvailable === false ? '' :
        '<div class="field"><span>Photos and videos <em class="muted">(stay on this device; not in backups)</em></span>' +
        mediaThumbs(e.media, true) +
        '<label class="btn file-btn">+ Add photos or videos<input type="file" accept="image/*,video/*" multiple data-input="idea-media" class="visually-hidden"></label>' +
        '<p class="muted small" id="mediaProgress" aria-live="polite">' + esc(sheet.mediaMsg || '') + '</p></div>') +
      '<div class="sheet-actions"><span class="spacer"></span>' +
      '<button type="button" class="btn" data-action="cancel-idea">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Save idea</button></div></form>';
  }

  function startIdeaEdit(ideaId) {
    const goal = goalById(sheet.goalId);
    const idea = ideaId ? (goal.ideas || []).find(i => i.id === ideaId) : null;
    sheet.edit = {
      ideaId: idea ? idea.id : null,
      text: idea ? idea.text : '',
      links: idea ? (idea.links || []).join('\n') : '',
      media: idea ? (idea.media || []).map(m => Object.assign({}, m)) : [],
      added: [], removed: [],
    };
    sheet.mediaMsg = '';
    renderSheet();
    const t = $('#sheet textarea[name=text]'); if (t) t.focus();
  }

  function readIdeaForm() {
    const form = $('#sheet form[data-form=idea]');
    if (!form || !sheet.edit) return;
    sheet.edit.text = form.elements.text.value;
    sheet.edit.links = form.elements.links.value;
  }

  function cancelIdeaEdit() {
    if (sheet && sheet.edit && sheet.edit.added.length) Media.remove(sheet.edit.added);
    if (sheet) sheet.edit = null;
  }

  async function addIdeaMedia(files) {
    readIdeaForm();
    const e = sheet.edit;
    const list = Array.from(files || []);
    const errors = [];
    for (let i = 0; i < list.length; i++) {
      sheet.mediaMsg = 'Saving ' + (i + 1) + ' of ' + list.length + '…';
      const p = $('#mediaProgress'); if (p) p.textContent = sheet.mediaMsg;
      try {
        const m = await Media.addFile(list[i], () => L.uid('media'));
        if (sheet && sheet.edit === e) { e.media.push(m); e.added.push(m.id); }
        else Media.remove([m.id]); // the form was closed meanwhile
      } catch (err) {
        errors.push(err && err.message ? err.message : 'Could not save a file.');
      }
    }
    if (!sheet || sheet.edit !== e) return;
    sheet.mediaMsg = errors.length ? errors.join(' ') : '';
    renderSheet();
  }

  function submitIdea(form) {
    readIdeaForm();
    const e = sheet.edit;
    const goal = goalById(sheet.goalId);
    const text = e.text.trim();
    const links = e.links.split(/[\n\s]+/).map(L.normalizeLink).filter(Boolean);
    if (!text && !links.length && !e.media.length) { setStatus('Add some text, a link or a photo first.', 'error'); return; }
    const idea = { id: e.ideaId || L.uid('idea'), text, links, media: e.media };
    goal.ideas = goal.ideas || [];
    const idx = goal.ideas.findIndex(i => i.id === idea.id);
    if (idx >= 0) goal.ideas[idx] = idea; else goal.ideas.push(idea);
    if (e.removed.length) Media.remove(e.removed);
    sheet.edit = null;
    persist('Idea saved');
    renderSheet();
    refreshIdeaCounts();
  }

  function deleteIdea(ideaId) {
    const goal = goalById(sheet.goalId);
    const idea = (goal.ideas || []).find(i => i.id === ideaId);
    if (!idea) return;
    Media.remove((idea.media || []).map(m => m.id));
    goal.ideas = goal.ideas.filter(i => i.id !== ideaId);
    persist('Idea deleted');
    renderSheet();
    refreshIdeaCounts();
  }

  function refreshIdeaCounts() {
    // Re-render the goals list; on Score session only update the button text so typing isn't lost.
    renderGoals();
    $$('#tab-score [data-action="open-ideas"]').forEach(b => {
      const g = goalById(b.dataset.goal);
      if (g) b.textContent = 'Ideas (' + (g.ideas || []).length + ')';
    });
  }

  async function checkMedia() {
    if (mediaAvailable !== null) return;
    mediaAvailable = await Media.isAvailable();
    if (sheet && sheet.type === 'ideas') renderSheet();
  }

  /* ---------- Media hydration (object URLs) ---------- */

  const liveUrls = new Map(); // container -> [urls]

  async function hydrateMedia(container) {
    (liveUrls.get(container) || []).forEach(u => URL.revokeObjectURL(u));
    const urls = [];
    liveUrls.set(container, urls);
    for (const el of $$('[data-media-id]', container)) {
      const blob = await Media.get(el.dataset.mediaId);
      if (!el.isConnected) continue;
      if (!blob) {
        const box = document.createElement('div');
        box.className = 'media-missing';
        box.textContent = 'Not on this device';
        (el.closest('.thumb-btn') || el).replaceWith(box);
        continue;
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      el.src = url;
    }
  }

  async function viewPhoto(id) {
    const dlg = $('#lightbox');
    const img = $('#lightboxImg');
    const blob = await Media.get(id);
    if (!blob) { setStatus('That photo is not on this device.', 'error'); return; }
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const url = URL.createObjectURL(blob);
    img.dataset.url = url;
    img.src = url;
    dlg.showModal();
  }

  /* ================= Progress tab ================= */

  function renderProgress() {
    const el = $('#tab-progress');
    const child = currentChild();
    if (!child) { el.innerHTML = noChildPanel(); return; }
    const sessions = childSessions();
    const goals = childGoals().filter(g => !g.archived || L.goalHasScores(g.id, sessions));
    let html = '<div class="print-only print-title"><h1>OT progress: ' + esc(child.name) + '</h1><p>Printed ' + esc(L.formatDate(L.todayISO())) + '</p></div>';
    html += '<div class="toolbar no-print"><h2 class="panel-title">Progress for ' + esc(child.name) + '</h2>' +
      '<button type="button" class="btn" data-action="print">Print / save PDF</button></div>';

    if (!goals.length) {
      el.innerHTML = html + '<div class="card empty"><p>Add goals and score a session to see progress here.</p></div>';
      return;
    }

    html += legendHTML(goals);
    html += areaFilterBar(goals, 'progress');
    const shown = applyFilter(goals, 'progress');
    html += groupedHTML(shown, g => progressCard(g, sessions));
    html += '<h2 class="section-title">Session history</h2>';
    html += sessions.length ? L.sortSessions(sessions, true).map(sessionCard).join('') : '<p class="muted">No sessions saved yet.</p>';
    el.innerHTML = html;
  }

  function legendHTML(goals) {
    const used = new Set(goals.map(g => g.method));
    const row = (method) => '<div class="legend-row"><span class="legend-name">' + esc(L.METHODS[method].name) + ':</span>' +
      L.METHODS[method].levels.map((lv, i) => '<span class="legend-item c-' + method + '-' + i + '"><span class="swatch" aria-hidden="true"></span>' + esc(lv.label) + '</span>').join('') + '</div>';
    let html = '<div class="card legend" aria-label="Color legend"><h2 class="legend-title">Legend</h2>';
    if (used.has('scale')) html += row('scale');
    if (used.has('help')) html += row('help');
    html += '<p class="muted small">Darker = further along. Each chart dot is one session; labels on the left name each step. ' +
      (used.has('trials') ? 'Trials show % that went well. ' : '') +
      (used.has('number') ? 'Dashed line = target. ' : '') + '</p></div>';
    return html;
  }

  function progressCard(goal, sessions) {
    const series = L.goalSeries(goal, sessions);
    const sl = L.startedLatest(goal, sessions);
    const last = series[series.length - 1];
    const lvl = last ? L.scoreLevel(goal, last.score) : null;
    const pill = last
      ? '<span class="pill' + (lvl != null ? ' c-' + goal.method + '-' + lvl : '') + '">' + (lvl != null ? '<span class="swatch" aria-hidden="true"></span>' : '') +
        '<span>Latest: <strong>' + esc(L.scoreLabel(goal, last.score)) + '</strong></span></span>'
      : '<span class="pill pill-empty">No scores yet</span>';
    return '<article class="card progress-card">' +
      '<div class="progress-head"><h3 class="goal-text">' + esc(goal.text) + (goal.archived ? ' <span class="tag">Archived</span>' : '') + '</h3>' + pill + '</div>' +
      '<p class="goal-meta">' + esc(methodName(goal)) + (goal.method === 'number' && goal.target != null ? ' · Target ' + esc(L.withUnit(goal.target, goal.unit)) : '') + '</p>' +
      (series.length ? chartSVG(goal, series) : '') +
      (sl ? '<p class="started-latest">' + esc(sl.text) + ' · ' + plural(sl.count, 'score') + '</p>' : '') +
      '</article>';
  }

  function chartSVG(goal, series) {
    const W = 320, H = 132;
    const isLevels = goal.method === 'scale' || goal.method === 'help';
    const padL = isLevels ? 98 : 42, padR = 14, padT = 10, padB = 24;
    const pw = W - padL - padR, ph = H - padT - padB;

    let min, max, ticks, tickLabel;
    if (isLevels) {
      const levels = L.METHODS[goal.method].levels;
      min = 0; max = levels.length - 1;
      ticks = levels.map((_, i) => i);
      tickLabel = i => levels[i].label;
    } else if (goal.method === 'trials') {
      min = 0; max = 100; ticks = [0, 50, 100];
      tickLabel = v => v + '%';
    } else {
      const r = L.numberRange(series.map(p => p.value), goal.target);
      min = r.min; max = r.max; ticks = r.ticks;
      tickLabel = v => L.formatNumber(v) + (goal.unit === '%' ? '%' : '');
    }
    const y = v => padT + ph - ((v - min) / ((max - min) || 1)) * ph;
    const n = series.length;
    const x = i => n === 1 ? padL + pw / 2 : padL + (i * pw) / (n - 1);

    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc('Trend chart, ' + plural(n, 'score') + ' from ' + L.formatDate(series[0].date) + ' to ' + L.formatDate(series[n - 1].date)) + '">';
    for (const t of ticks) {
      svg += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>';
      svg += '<text class="axis" x="' + (padL - 6) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + esc(tickLabel(t)) + '</text>';
    }
    if (goal.method === 'number' && goal.target != null) {
      svg += '<line class="target" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(goal.target) + '" y2="' + y(goal.target) + '"/>';
      svg += '<text class="target-label" x="' + (W - padR) + '" y="' + (y(goal.target) - 4) + '" text-anchor="end">Target</text>';
    }
    if (n > 1) {
      svg += '<polyline class="line" points="' + series.map((p, i) => x(i).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ') + '"/>';
    }
    series.forEach((p, i) => {
      const lvl = L.scoreLevel(goal, p.score);
      svg += '<circle class="pt' + (lvl != null ? ' c-' + goal.method + '-' + lvl : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.value).toFixed(1) +
        '" r="5"><title>' + esc(L.formatDate(p.date) + ': ' + L.scoreLabel(goal, p.score)) + '</title></circle>';
    });
    svg += '<text class="axis" x="' + (n === 1 ? x(0) : padL) + '" y="' + (H - 6) + '" text-anchor="' + (n === 1 ? 'middle' : 'start') + '">' + esc(shortDate(series[0].date)) + '</text>';
    if (n > 1) svg += '<text class="axis" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(shortDate(series[n - 1].date)) + '</text>';
    return svg + '</svg>';
  }

  function sessionCard(s) {
    const goalsInOrder = childGoals().filter(g => s.scores && s.scores[g.id]);
    const items = goalsInOrder.map(g => {
      const sc = s.scores[g.id];
      const lvl = L.scoreLevel(g, sc);
      const label = L.scoreLabel(g, sc) || 'Note only';
      return '<li><span class="hist-goal">' + esc(g.text) + '</span>' +
        '<span class="hist-result' + (lvl != null ? ' c-' + g.method + '-' + lvl : '') + '">' + (lvl != null ? '<span class="swatch" aria-hidden="true"></span>' : '') + esc(label) + '</span>' +
        (sc.note ? '<span class="hist-note">' + esc(sc.note) + '</span>' : '') + '</li>';
    }).join('');
    return '<article class="card session-card">' +
      '<div class="session-card-head"><h3>' + esc(L.formatDate(s.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) + '</h3>' +
      '<div class="card-actions no-print"><button type="button" class="btn btn-quiet btn-small" data-action="edit-session" data-session="' + esc(s.id) + '">Edit</button>' +
      confirmBtn('delete-session', 'data-session="' + esc(s.id) + '"', 'Delete', 'Tap again to delete session', 'btn-danger-quiet btn-small') + '</div></div>' +
      (items ? '<ul class="hist-list">' + items + '</ul>' : '') +
      (s.note ? '<p class="session-note"><strong>Session note:</strong> ' + esc(s.note) + '</p>' : '') +
      '</article>';
  }

  /* ================= Children sheet ================= */

  function childrenHTML() {
    const rows = state.children.map(c => {
      const nGoals = state.goals.filter(g => g.childId === c.id).length;
      const nSes = state.sessions.filter(s => s.childId === c.id).length;
      const cur = c.id === state.currentChildId;
      return '<li class="child-row">' +
        '<label class="field"><span class="visually-hidden">Name for ' + esc(c.name) + '</span>' +
        '<input value="' + esc(c.name) + '" maxlength="40" data-input="child-name" data-child="' + esc(c.id) + '" autocomplete="off"></label>' +
        '<p class="muted small">' + plural(nGoals, 'goal') + ', ' + plural(nSes, 'session') + '</p>' +
        '<div class="card-actions">' +
        (cur ? '<span class="tag tag-current">✓ Current</span>' : '<button type="button" class="btn btn-quiet btn-small" data-action="switch-child" data-child="' + esc(c.id) + '">Switch to</button>') +
        confirmBtn('delete-child', 'data-child="' + esc(c.id) + '"', 'Delete', 'Tap again to delete ' + c.name + ' and all their data', 'btn-danger-quiet btn-small') +
        '</div></li>';
    }).join('');
    return '<p class="note">Use initials or a nickname - never full names.</p>' +
      (rows ? '<ul class="child-list">' + rows + '</ul>' : '<p class="muted">No children yet.</p>') +
      '<h3 class="sub-title">Add a child</h3>' + addChildForm('sheet');
  }

  function addChild(name) {
    name = L.cleanText(name);
    if (!name) return false;
    const c = { id: L.uid('child'), name, createdAt: Date.now() };
    state.children.push(c);
    state.currentChildId = c.id;
    persist('Child added');
    return true;
  }

  function deleteChild(id) {
    const goals = state.goals.filter(g => g.childId === id);
    Media.remove(L.mediaIdsForGoals(goals));
    state.goals = state.goals.filter(g => g.childId !== id);
    state.sessions = state.sessions.filter(s => s.childId !== id);
    state.children = state.children.filter(c => c.id !== id);
    delete drafts[id];
    persistDrafts();
    if (state.currentChildId === id) state.currentChildId = state.children[0] ? state.children[0].id : null;
    persist('Child deleted');
  }

  function switchChild(id) {
    if (!state.children.some(c => c.id === id)) return;
    state.currentChildId = id;
    openNotes.clear();
    ui.filter = { score: 'all', progress: 'all' };
    persist('Switched to ' + currentChild().name);
    renderAll();
  }

  /* ================= Backup sheet ================= */

  function backupJSON() { return JSON.stringify(L.makeBackup(state), null, 2); }

  function backupFileName() { return 'ot-tracker-backup-' + L.todayISO() + '.json'; }

  function dataHTML() {
    const counts = plural(state.children.length, 'child', 'children') + ', ' + plural(state.goals.length, 'goal') + ', ' + plural(state.sessions.length, 'session');
    const canShareFiles = !!(navigator.canShare && window.File && (() => {
      try { return navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }); } catch (e) { return false; }
    })());
    let html = '<p>Your data is saved automatically <strong>on this device only</strong> (in this browser). Nothing is sent anywhere. ' +
      'Make a backup regularly - clearing website data or losing the device would erase it.</p>' +
      '<p class="note"><strong>Backups do not include photos and videos.</strong> Those stay on this device only.</p>' +
      '<h3 class="sub-title">Back up</h3><p class="muted small">Currently: ' + esc(counts) + '.</p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary" data-action="download-backup">Download backup</button>' +
      (canShareFiles ? '<button type="button" class="btn" data-action="share-backup">Share / Save to Files…</button>' : '') +
      '<button type="button" class="btn" data-action="show-backup-text">Backup as text</button></div>';

    if (sheet.showText) {
      html += '<label class="field"><span>Backup text - copy it and keep it somewhere safe (for example in a private note)</span>' +
        '<textarea id="backupText" rows="6" readonly spellcheck="false">' + esc(backupJSON()) + '</textarea></label>' +
        '<div class="btn-row"><button type="button" class="btn" data-action="copy-backup">Copy text</button></div>';
    }

    html += '<h3 class="sub-title">Restore</h3>' +
      '<p class="muted small">Restoring <strong>replaces</strong> all current data on this device with the backup.</p>' +
      '<div class="btn-row"><label class="btn file-btn">Restore backup file…<input type="file" accept=".json,application/json,text/plain" data-input="restore-file" class="visually-hidden"></label></div>' +
      '<label class="field"><span>Or paste backup text</span><textarea id="restoreText" rows="4" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="Paste backup text here">' +
      esc(sheet.pasteText || '') + '</textarea></label>' +
      '<div class="btn-row"><button type="button" class="btn" data-action="check-restore-text">Check pasted text</button></div>';

    if (sheet.restoreError) html += '<p class="form-error" role="alert">' + esc(sheet.restoreError) + '</p>';
    if (sheet.pending) {
      const p = sheet.pending;
      html += '<div class="restore-confirm" role="alert"><p>Ready to restore <strong>' + esc(sheet.pendingSource) + '</strong>: ' +
        esc(plural(p.children.length, 'child', 'children') + ', ' + plural(p.goals.length, 'goal') + ', ' + plural(p.sessions.length, 'session')) + '.</p>' +
        (sheet.confirmRestore
          ? '<p><strong>Are you sure?</strong> Everything currently in the app on this device will be replaced by this backup.</p>' +
            '<div class="btn-row"><button type="button" class="btn btn-danger" id="confirmRestoreBtn" data-action="do-restore">Yes, replace everything</button>' +
            '<button type="button" class="btn" data-action="cancel-restore">Cancel</button></div></div>'
          : '<div class="btn-row"><button type="button" class="btn btn-danger" data-action="ask-restore">Replace my data with this backup</button>' +
            '<button type="button" class="btn" data-action="cancel-restore">Cancel</button></div></div>');
    }
    return html;
  }

  function downloadBackup() {
    const blob = new Blob([backupJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = backupFileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('Backup downloaded. If nothing appeared, use “Backup as text”.', 'ok');
  }

  async function shareBackup() {
    try {
      const file = new File([backupJSON()], backupFileName(), { type: 'application/json' });
      await navigator.share({ files: [file], title: 'OT tracker backup' });
    } catch (e) {
      if (e && e.name !== 'AbortError') setStatus('Sharing failed - try “Backup as text”.', 'error');
    }
  }

  async function copyBackup() {
    const ta = $('#backupText');
    if (!ta) return;
    try {
      await navigator.clipboard.writeText(ta.value);
      setStatus('Backup text copied', 'ok');
    } catch (e) {
      ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      setStatus(ok ? 'Backup text copied' : 'Text selected - use Copy from the menu.', ok ? 'ok' : '');
    }
  }

  function prepareRestore(text, source) {
    sheet.pending = null; sheet.restoreError = ''; sheet.confirmRestore = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // close the iPad keyboard
    try {
      sheet.pending = L.normalizeState(text);
      sheet.pendingSource = source;
    } catch (e) {
      sheet.restoreError = e.message || 'Could not read that backup.';
    }
    renderSheet();
    revealRestorePanel();
  }

  /** Scroll the restore result into view once the on-screen keyboard has closed. */
  function revealRestorePanel(focusSel) {
    setTimeout(() => {
      const el = $('#sheet .restore-confirm') || $('#sheet .form-error');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const f = focusSel && $(focusSel);
      if (f) f.focus({ preventScroll: true });
    }, 350);
  }

  function doRestore() {
    if (!sheet || !sheet.pending) return;
    state = sheet.pending;
    drafts = {};
    openNotes.clear();
    persistDrafts();
    persist('Backup restored');
    closeSheet();
    renderAll();
  }

  /* ================= Sheet (dialog) ================= */

  function showSheet(title) {
    const dlg = $('#sheet');
    $('#sheetTitle').textContent = title;
    renderSheet();
    if (!dlg.open) dlg.showModal();
    $('#sheetBody').scrollTop = 0;
  }

  function renderSheet() {
    if (!sheet) return;
    const body = $('#sheetBody');
    if (sheet.type === 'goal') body.innerHTML = goalEditorHTML();
    else if (sheet.type === 'ideas') { body.innerHTML = ideasHTML(); hydrateMedia(body); }
    else if (sheet.type === 'children') body.innerHTML = childrenHTML();
    else if (sheet.type === 'data') body.innerHTML = dataHTML();
  }

  function closeSheet() {
    const dlg = $('#sheet');
    if (dlg.open) dlg.close(); else onSheetClosed();
  }

  function onSheetClosed() {
    if (sheet && sheet.type === 'ideas') cancelIdeaEdit();
    sheet = null;
    const body = $('#sheetBody');
    (liveUrls.get(body) || []).forEach(u => URL.revokeObjectURL(u));
    liveUrls.delete(body);
    body.innerHTML = '';
  }

  /* ================= Tabs ================= */

  function switchTab(tab) {
    ui.tab = tab;
    persistUI();
    renderTabs();
    if (tab === 'score') renderScore();
    if (tab === 'goals') renderGoals();
    if (tab === 'progress') renderProgress();
  }

  /* ================= Two-tap confirm ================= */

  function needsConfirm(btn) {
    if (!btn.dataset.confirm) return false;
    if (btn.dataset.armed === '1') return false;
    const ae = document.activeElement;
    if (ae && ae !== btn && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = btn.dataset.confirm;
    btn.classList.add('armed');
    btn.setAttribute('aria-live', 'assertive');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.label;
      btn.classList.remove('armed');
    }, CONFIRM_MS);
    return true;
  }

  /* ================= Events ================= */

  const actions = {
    'filter': b => { ui.filter[b.dataset.which] = b.dataset.value; persistUI(); b.dataset.which === 'score' ? renderScore() : renderProgress(); },
    'date-today': () => { getDraft().date = L.todayISO(); persistDrafts(); renderScore(); },
    'cancel-edit': () => { delete drafts[state.currentChildId]; persistDrafts(); openNotes.clear(); renderScore(); setStatus('Edit cancelled', ''); },
    'level': b => { const d = getDraft(); setDraftScore(b.dataset.goal, L.toggleLevel(d.scores[b.dataset.goal], Number(b.dataset.value))); rerenderScoreCard(b.dataset.goal); },
    'trial': b => { const d = getDraft(); setDraftScore(b.dataset.goal, L.toggleTrials(d.scores[b.dataset.goal], Number(b.dataset.value), Number(b.dataset.attempts))); rerenderScoreCard(b.dataset.goal); },
    'attempts': b => {
      const d = getDraft();
      const n = L.clampAttempts(Number(b.dataset.attempts) + Number(b.dataset.delta));
      const sc = L.setAttempts(d.scores[b.dataset.goal], n);
      d.scores[b.dataset.goal] = sc; // keep attempts even with no score yet
      persistDrafts();
      if (state.lastAttempts !== n) { state.lastAttempts = n; try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
      rerenderScoreCard(b.dataset.goal);
    },
    'not-worked': b => { const d = getDraft(); setDraftScore(b.dataset.goal, L.toggleNotWorked(d.scores[b.dataset.goal])); rerenderScoreCard(b.dataset.goal); },
    'open-note': b => { openNotes.add(b.dataset.goal); rerenderScoreCard(b.dataset.goal); const t = $('[data-goal-card="' + CSS.escape(b.dataset.goal) + '"] textarea'); if (t) t.focus(); },
    'save-session': saveSession,
    'new-goal': () => openGoalEditor(null),
    'edit-goal': b => openGoalEditor(b.dataset.goal),
    'archive-goal': b => { const g = goalById(b.dataset.goal); if (g) { g.archived = true; persist('Goal archived'); renderAll(); } },
    'restore-goal': b => { const g = goalById(b.dataset.goal); if (g) { g.archived = false; persist('Goal restored'); renderAll(); } },
    'delete-goal': b => deleteGoal(b.dataset.goal),
    'open-ideas': b => openIdeas(b.dataset.goal),
    'new-idea': () => startIdeaEdit(null),
    'edit-idea': b => startIdeaEdit(b.dataset.idea),
    'cancel-idea': () => { cancelIdeaEdit(); renderSheet(); },
    'delete-idea': b => deleteIdea(b.dataset.idea),
    'remove-media': b => {
      readIdeaForm();
      const e = sheet.edit, id = b.dataset.media;
      e.media = e.media.filter(m => m.id !== id);
      if (e.added.includes(id)) { e.added = e.added.filter(x => x !== id); Media.remove([id]); } else e.removed.push(id);
      renderSheet();
    },
    'view-photo': b => viewPhoto(b.dataset.media),
    'edit-session': b => startEditSession(b.dataset.session),
    'delete-session': b => {
      const id = b.dataset.session;
      state.sessions = state.sessions.filter(s => s.id !== id);
      for (const d of Object.values(drafts)) if (d.editingSessionId === id) d.editingSessionId = null;
      persistDrafts();
      persist('Session deleted');
      renderProgress(); renderScore();
    },
    'print': () => window.print(),
    'open-children': () => { sheet = { type: 'children' }; showSheet('Children'); },
    'open-data': () => { sheet = { type: 'data' }; showSheet('Backup & restore'); },
    'switch-child': b => { switchChild(b.dataset.child); renderSheet(); },
    'delete-child': b => { deleteChild(b.dataset.child); renderAll(); renderSheet(); },
    'download-backup': downloadBackup,
    'share-backup': shareBackup,
    'show-backup-text': () => { sheet.showText = !sheet.showText; renderSheet(); const t = $('#backupText'); if (t) t.focus(); },
    'copy-backup': copyBackup,
    'check-restore-text': () => { sheet.pasteText = $('#restoreText').value; prepareRestore(sheet.pasteText, 'pasted text'); },
    'ask-restore': () => { sheet.confirmRestore = true; renderSheet(); revealRestorePanel('#confirmRestoreBtn'); },
    'cancel-restore': () => { sheet.pending = null; sheet.confirmRestore = false; renderSheet(); },
    'do-restore': doRestore,
    'close-sheet': closeSheet,
  };

  function onClick(ev) {
    const tab = ev.target.closest('.tab');
    if (tab) { switchTab(tab.dataset.tab); return; }
    const b = ev.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (!fn) return;
    if (needsConfirm(b)) return;
    fn(b, ev);
  }

  let draftTimer = null;
  function onInput(ev) {
    const t = ev.target;
    const kind = t.dataset.input;
    if (kind === 'goal-note' || kind === 'number') {
      const d = getDraft();
      const id = t.dataset.goal;
      const sc = Object.assign({}, d.scores[id] || {});
      if (kind === 'goal-note') sc.note = t.value;
      else {
        const n = L.parseNumberInput(t.value);
        const err = t.closest('.number-row').querySelector('.input-error');
        const bad = t.value.trim() !== '' && n == null;
        err.hidden = !bad;
        t.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (n == null) delete sc.value; else { sc.value = n; delete sc.notWorked; }
        const nw = t.closest('.goal-card').querySelector('[data-action="not-worked"]');
        if (n != null && nw && nw.getAttribute('aria-pressed') === 'true') { nw.setAttribute('aria-pressed', 'false'); nw.textContent = 'Not worked on'; }
      }
      if (L.isEmptyScore(sc)) delete d.scores[id]; else d.scores[id] = sc;
      clearTimeout(draftTimer); draftTimer = setTimeout(persistDrafts, 300);
      updateSaveLabel();
    } else if (kind === 'session-note') {
      getDraft().note = t.value;
      clearTimeout(draftTimer); draftTimer = setTimeout(persistDrafts, 300);
      updateSaveLabel();
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === 'childSelect') { switchChild(t.value); return; }
    if (t.id === 'sessionDate') {
      if (L.isISODate(t.value)) { getDraft().date = t.value; persistDrafts(); renderScore(); }
      return;
    }
    const kind = t.dataset.input;
    if (kind === 'goal-area' || (t.name === 'method' && sheet && sheet.type === 'goal')) {
      readGoalForm(t.form);
      renderSheet();
      const focusSel = kind === 'goal-area' ? (sheet.form.area === '__new__' ? '[name=newArea]' : '[name=area]') : 'input[name=method]:checked';
      const f = $('#sheetBody ' + focusSel); if (f) f.focus();
    } else if (kind === 'child-name') {
      const c = state.children.find(x => x.id === t.dataset.child);
      const name = L.cleanText(t.value);
      if (c && name && name !== c.name) { c.name = name; persist('Name saved'); renderHeader(); renderGoals(); renderProgress(); }
      else if (c) t.value = c.name;
    } else if (kind === 'idea-media') {
      const files = t.files; addIdeaMedia(files);
    } else if (kind === 'restore-file') {
      const file = t.files && t.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => prepareRestore(String(reader.result || ''), file.name);
      reader.onerror = () => { sheet.restoreError = 'Could not read that file.'; renderSheet(); };
      reader.readAsText(file);
    }
  }

  function onSubmit(ev) {
    const form = ev.target;
    const kind = form.dataset.form;
    if (!kind) return;
    ev.preventDefault();
    if (kind === 'add-child') {
      if (addChild(form.elements.name.value)) {
        form.reset();
        renderAll();
        if (sheet && sheet.type === 'children') renderSheet();
      }
    } else if (kind === 'goal') submitGoal(form);
    else if (kind === 'idea') submitIdea(form);
  }

  function onKeydown(ev) {
    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    const tab = ev.target.closest && ev.target.closest('.tab');
    if (tab && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
      const tabs = $$('.tab');
      const i = tabs.indexOf(tab) + (ev.key === 'ArrowRight' ? 1 : -1);
      const next = tabs[(i + tabs.length) % tabs.length];
      switchTab(next.dataset.tab); next.focus();
      ev.preventDefault();
    }
  }

  function init() {
    loadAll();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('toggle', ev => {
      if (ev.target.dataset && ev.target.dataset.toggle === 'archived') ui.archivedOpen = ev.target.open;
    }, true);
    $('#sheet').addEventListener('close', onSheetClosed);
    const lb = $('#lightbox');
    lb.addEventListener('click', () => lb.close());
    lb.addEventListener('close', () => { const img = $('#lightboxImg'); if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); img.dataset.url = ''; img.removeAttribute('src'); } });
    // Keep data in sync if the app is open in two tabs.
    window.addEventListener('storage', ev => {
      if (ev.key === STORE_KEY && ev.newValue) {
        try { state = L.normalizeState(ev.newValue); renderAll(); } catch (e) { /* ignore */ }
      }
    });
    renderAll();
    if (!storageOk) setStatus('Saving is not available in this browser mode. Use Backup to keep your work.', 'error', true);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    }
  }

  // Exposed for automated UI tests only.
  window.OTApp = { getState: () => state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
