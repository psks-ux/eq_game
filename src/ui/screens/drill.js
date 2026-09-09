/**
 * Screen: drill. The training runner. Reads :levelId, builds a drill session, shows
 * the wordless demonstration for that drill, then drives all four Run kinds — choice,
 * stream, span and sequence — with immediate feedback and an adaptive level meter.
 */

import { mountSvg, button, optionGrid } from '../components.js';
import { icon } from '../icons.js';
import { demoFor } from '../demos.js';
import { t, labelsEnabled, setLabelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { levelById, unlockedLevels, nextLevel } from '../../train/curriculum.js';
import { createDrillSession } from '../../train/session.js';
import { drillById } from '../../train/drills/index.js';
import { makeRng } from '../../core/rng.js';
import { saveProfile } from '../../core/store.js';

const FACTOR_COLORS = {
  induction: '#0072B2',
  spatial: '#E69F00',
  workingMemory: '#009E73',
  relational: '#CC79A7',
  speed: '#56B4E9',
  flexibility: '#D55E00'
};

const FEEDBACK_MS = 620;
const HARD_TRIAL_CAP = 400;
/* No deadline may leave less than this to actually answer in, however the drill
 * budgeted the trial: a window shorter than a reaction is a bug, not a challenge. */
const MIN_DEADLINE_MS = 1200;

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-4,16px);' +
  'padding:var(--sp-4,16px);max-width:860px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-4,16px);' +
  'display:flex;flex-direction:column;gap:var(--sp-3,12px)';

const STAGE_STYLE =
  'display:flex;align-items:center;justify-content:center;background:var(--bg-elev,#16171c);' +
  'border:3px solid var(--line,#2a2c34);border-radius:var(--r-lg,16px);' +
  'padding:var(--sp-4,16px);min-height:250px;transition:border-color .12s linear';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const GLYPH = {
  play: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M7 4 L20 12 L7 20 Z" fill="currentColor"/></svg>',
  leave: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>',
  match: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="10" cy="16" r="7" fill="currentColor"/>' +
    '<circle cx="22" cy="16" r="7" fill="currentColor"/></svg>',
  nomatch: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="10" cy="16" r="7" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<rect x="18" y="9" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="3" transform="translate(-3,0)"/></svg>',
  undo: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="7" cy="16" r="4" fill="currentColor"/>' +
    '<circle cx="17" cy="16" r="4" fill="currentColor"/>' +
    '<circle cx="27" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-dasharray="3 3"/></svg>',
  submit: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="5" width="22" height="22" rx="5" fill="currentColor"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M12 3 A9 9 0 1 1 4.2 16.5" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"/><circle cx="12" cy="3" r="2.4" fill="currentColor"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="2.6" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="2.6" fill="currentColor"/>' +
    '<circle cx="19" cy="12" r="2.6" fill="currentColor"/>' +
    '<rect x="5" y="11" width="14" height="2" fill="currentColor" opacity=".5"/></svg>',
  pause: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="9" y="7" width="5" height="18" fill="currentColor"/>' +
    '<rect x="18" y="7" width="5" height="18" fill="currentColor"/></svg>'
};

let cleanup = [];
let live = null;

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  syncLabels(profile);
  const root = h('main', { class: 'screen screen-drill', style: SCREEN_STYLE });

  if (profile.status === 'eliminated') {
    navigate(ctx, '#/eliminated');
    return root;
  }
  if (profile.status !== 'qualified') {
    navigate(ctx, '#/');
    return root;
  }

  const levelId = readLevelId(ctx);
  const level = levelId ? safeCall(() => levelById(levelId), null) : null;
  if (!level || !level.id) {
    navigate(ctx, '#/train');
    return root;
  }
  if (!isUnlocked(profile, level)) {
    /* Locked levels are not playable, whatever URL was typed. */
    navigate(ctx, '#/train');
    return root;
  }

  const color = FACTOR_COLORS[level.factor] || 'var(--accent,#5b8cff)';
  const levelMeter = meterEl(0, tx(['drill.level', 'level'], 'Difficulty'), color);
  const trialMeter = meterEl(0, tx('drill.trials', 'Trials done'), 'var(--accent,#5b8cff)');
  const leaveBtn = actionButton({
    iconKey: 'leave', glyph: GLYPH.leave, labelKey: 'drill.leave',
    fallbackLabel: 'Leave', compact: true, onClick: () => navigate(ctx, '#/train')
  });

  const header = h('header', { style: 'display:flex;align-items:center;gap:var(--sp-3,12px)' }, [
    leaveBtn,
    h('div', { style: 'flex:1 1 auto;display:flex;flex-direction:column;gap:6px' }, [
      trialMeter.el, levelMeter.el
    ])
  ]);

  const stage = h('section', { style: STAGE_STYLE });
  const stageInner = h('div', { style: 'width:100%;max-width:520px;min-height:180px;' +
    'display:flex;align-items:center;justify-content:center' });
  stage.appendChild(stageInner);

  const responseHost = h('section', { style: 'min-height:130px' });
  const overlay = h('section', { style: 'display:none' });
  const status = h('div', {
    role: 'status',
    'aria-live': 'assertive',
    style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap'
  });

  root.appendChild(header);
  root.appendChild(overlay);
  root.appendChild(stage);
  root.appendChild(responseHost);
  root.appendChild(status);

  live = {
    ctx,
    profile,
    level,
    color,
    root,
    header,
    stage,
    stageInner,
    responseHost,
    overlay,
    status,
    levelMeter,
    trialMeter,
    session: null,
    kind: 'choice',
    totalTrials: num(level.goal && level.goal.trials, 20),
    answered: 0,
    maxLevelSeen: 1,
    trial: null,
    lastAnsweredId: null,
    repeatGuard: 0,
    guard: 0,
    shownAt: 0,
    locked: true,
    finished: false,
    selection: [],
    pressed: [],
    scheduler: makeScheduler(),
    /* A second timer so a response deadline is never cancelled by the frame player,
     * and so both freeze together when the tab goes away. */
    deadline: makeScheduler(),
    deadlineBar: null,
    rafIds: [],
    reduced: prefersReducedMotion(profile)
  };
  cleanup.push(() => {
    if (!live) return;
    live.scheduler.clear();
    live.deadline.clear();
  });

  const onVisibility = () => {
    if (!live || live.finished) return;
    if (document.hidden) {
      live.scheduler.pause();
      live.deadline.pause();
      if (live.deadlineBar) live.deadlineBar.pause();
      showPaused(true);
    } else {
      showPaused(false);
      live.scheduler.resume();
      live.deadline.resume();
      if (live.deadlineBar) live.deadlineBar.resume();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));

  begin();
  return root;
}

export function destroy() {
  if (live) {
    live.finished = true;
    live.scheduler.clear();
    live.deadline.clear();
    live.deadlineBar = null;
    for (const id of live.rafIds) cancelAnimationFrame(id);
    live.rafIds = [];
  }
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
  live = null;
}

/* ------------------------------------------------------------------ start-up */

function begin() {
  const s = live;
  if (!s) return;
  const rng = freshRng(s.ctx, s.level.id);
  let session = null;
  try {
    session = createDrillSession({ rng, level: s.level, profile: s.profile });
  } catch (err) {
    showFailure(err);
    return;
  }
  if (!session || typeof session.respond !== 'function') {
    showFailure(new Error('drill session unavailable'));
    return;
  }
  s.session = session;
  s.kind = resolveKind(session, s.level, rng);
  s.totalTrials = resolveTotalTrials(session, s.level, rng);

  /* The demonstration runs before the first trial, so the format is never a surprise. */
  showDemoGate(s.level.drill, () => {
    if (live !== s || s.finished) return;
    let first = null;
    try {
      first = session.start();
    } catch (err) {
      showFailure(err);
      return;
    }
    s.firstFromStart = first && typeof first === 'object' && first.id !== undefined ? first : null;
    step();
  });
}

function resolveKind(session, level, rng) {
  const direct = session && typeof session.kind === 'string' ? session.kind : null;
  if (isKind(direct)) return direct;
  const st = stateOf(session);
  if (isKind(st.kind)) return st.kind;
  if (session && session.run && isKind(session.run.kind)) return session.run.kind;
  const probe = safeCall(() => {
    const mod = drillById(level.drill);
    if (!mod || typeof mod.makeRun !== 'function') return null;
    const probeRng = rng && typeof rng.fork === 'function' ? rng.fork('kind-probe') : rng;
    return mod.makeRun(probeRng, (level && level.params) || {});
  }, null);
  if (probe && isKind(probe.kind)) return probe.kind;
  return 'choice';
}

function resolveTotalTrials(session, level, rng) {
  const st = stateOf(session);
  const fromState = num(st.totalTrials, num(st.total, null));
  if (Number.isFinite(fromState) && fromState > 0) return fromState;
  if (session && session.run && Number.isFinite(session.run.totalTrials)) return session.run.totalTrials;
  const probe = safeCall(() => {
    const mod = drillById(level.drill);
    if (!mod || typeof mod.makeRun !== 'function') return null;
    const probeRng = rng && typeof rng.fork === 'function' ? rng.fork('trials-probe') : rng;
    return mod.makeRun(probeRng, (level && level.params) || {});
  }, null);
  if (probe && Number.isFinite(probe.totalTrials) && probe.totalTrials > 0) return probe.totalTrials;
  return Math.max(1, num(level.goal && level.goal.trials, 20));
}

function isKind(k) {
  return k === 'choice' || k === 'stream' || k === 'span' || k === 'sequence';
}

/* --------------------------------------------------------------- trial cycle */

function step() {
  const s = live;
  if (!s || s.finished) return;
  s.guard += 1;
  if (s.guard > HARD_TRIAL_CAP) {
    finishUp();
    return;
  }
  if (stateOf(s.session).done === true) {
    finishUp();
    return;
  }
  let trial = null;
  if (s.firstFromStart) {
    trial = s.firstFromStart;
    s.firstFromStart = null;
  } else {
    trial = safeCall(() => s.session.current(), null);
  }
  if (!trial || typeof trial !== 'object') {
    finishUp();
    return;
  }
  if (s.lastAnsweredId !== null && trial.id === s.lastAnsweredId) {
    s.repeatGuard += 1;
    /* The session did not advance; stop rather than loop on one trial forever. */
    if (s.repeatGuard >= 2) {
      finishUp();
      return;
    }
  } else {
    s.repeatGuard = 0;
  }
  s.trial = trial;
  s.selection = [];
  s.pressed = [];
  s.locked = true;
  s.shownAt = 0;
  const lvl = num(trial.level, num(stateOf(s.session).level, 1));
  s.maxLevelSeen = Math.max(s.maxLevelSeen, lvl);
  s.levelMeter.set(lvl / Math.max(6, s.maxLevelSeen + 1));
  s.trialMeter.set(s.totalTrials > 0 ? Math.min(1, s.answered / s.totalTrials) : 0);
  clearNode(s.responseHost);
  setStageState('neutral');

  if (s.kind === 'stream') presentStream(trial);
  else if (s.kind === 'span') presentSpan(trial);
  else if (s.kind === 'sequence') presentSequence(trial);
  else presentChoice(trial);
}

function presentChoice(trial) {
  const s = live;
  mountStimulus(trial);
  const options = Array.isArray(trial.options) ? trial.options : [];
  if (!options.length) {
    /* A choice trial with no options cannot be answered; end cleanly. */
    finishUp();
    return;
  }
  const columns = options.length >= 8 ? 4 : (options.length >= 6 ? 3 : 2);
  const grid = compose(
    () => optionGrid({
      options,
      columns,
      onPick: (picked) => {
        const id = resolvePickedId(picked, options);
        if (id) submit(id);
      }
    }),
    () => localOptionGrid(options, columns, (id) => submit(id))
  );
  grid.setAttribute('aria-label', tx('drill.choose', 'Choose one'));
  s.responseHost.appendChild(grid);
  installRovingFocus(grid);
  armResponse();
}

function presentSequence(trial) {
  const s = live;
  mountStimulus(trial);
  const options = Array.isArray(trial.options) ? trial.options : [];
  if (!options.length) {
    finishUp();
    return;
  }
  const columns = options.length >= 8 ? 4 : (options.length >= 6 ? 3 : 2);
  const chosen = h('div', {
    role: 'img',
    'aria-label': tx('drill.chosen', 'Chosen so far') + ': 0',
    style: 'display:flex;gap:6px;min-height:18px;align-items:center;flex-wrap:wrap'
  });
  const grid = compose(
    () => optionGrid({
      options,
      columns,
      onPick: (picked) => {
        const id = resolvePickedId(picked, options);
        if (id) addToSelection(id, chosen, options.length);
      }
    }),
    () => localOptionGrid(options, columns, (id) => addToSelection(id, chosen, options.length))
  );
  grid.setAttribute('aria-label', tx('drill.chooseOrder', 'Choose in order'));
  s.responseHost.appendChild(grid);
  installRovingFocus(grid);
  s.responseHost.appendChild(h('div', { style: ROW_STYLE }, [
    chosen,
    actionButton({
      iconKey: 'undo', glyph: GLYPH.undo, labelKey: 'drill.undo',
      fallbackLabel: 'Undo', onClick: () => undoSelection(chosen, options.length)
    }),
    actionButton({
      iconKey: 'submit', glyph: GLYPH.submit, labelKey: 'drill.submit',
      fallbackLabel: 'Submit', variant: 'primary',
      onClick: () => { if (live && !live.locked) submit(live.selection.slice()); }
    })
  ]));
  armResponse();
}

function presentSpan(trial) {
  const s = live;
  const frames = framesOf(trial);
  const grid = resolveGrid(trial, s.level);
  if (!frames.length) {
    /* Nothing to memorise: go straight to the response grid. */
    buildSpanResponse(grid);
    return;
  }
  clearNode(s.responseHost);
  playFrames(frames, num(trial.isiMs, 220), () => buildSpanResponse(grid));
}

function buildSpanResponse(grid) {
  const s = live;
  if (!s || s.finished) return;
  clearNode(s.stageInner);
  clearNode(s.responseHost);
  const chosen = h('div', {
    role: 'img',
    'aria-label': tx('drill.chosen', 'Chosen so far') + ': 0',
    style: 'display:flex;gap:6px;min-height:18px;align-items:center;flex-wrap:wrap'
  });
  const board = h('div', {
    role: 'group',
    'aria-label': tx('drill.tapOrder', 'Tap the cells in order'),
    style: 'display:grid;gap:10px;margin:0 auto;width:100%;max-width:340px;' +
      'grid-template-columns:repeat(' + grid.cols + ',minmax(0,1fr))'
  });
  const cells = [];
  for (let i = 0; i < grid.rows * grid.cols; i += 1) {
    const idx = i;
    const cell = h('button', {
      type: 'button',
      'data-span-cell': String(idx),
      'aria-label': tx('drill.cell', 'Cell') + ' ' + (Math.floor(idx / grid.cols) + 1) +
        '·' + ((idx % grid.cols) + 1),
      style: 'aspect-ratio:1/1;border-radius:var(--r-sm,8px);cursor:pointer;padding:4px;' +
        'background:var(--bg-elev-2,#1d1f26);border:2px solid var(--line,#2a2c34);' +
        'display:flex;align-items:center;justify-content:center'
    });
    cell.addEventListener('click', () => {
      if (!live || live.locked) return;
      live.selection.push(idx);
      paintSpanCells(cells);
      updateChosen(chosen, live.selection.length);
    });
    cells.push(cell);
    board.appendChild(cell);
  }
  s.stageInner.appendChild(board);
  s.responseHost.appendChild(h('div', { style: ROW_STYLE + ';justify-content:center' }, [
    chosen,
    actionButton({
      iconKey: 'undo', glyph: GLYPH.undo, labelKey: 'drill.undo',
      fallbackLabel: 'Undo',
      onClick: () => {
        if (!live || live.locked) return;
        live.selection.pop();
        paintSpanCells(cells);
        updateChosen(chosen, live.selection.length);
      }
    }),
    actionButton({
      iconKey: 'submit', glyph: GLYPH.submit, labelKey: 'drill.submit',
      fallbackLabel: 'Submit', variant: 'primary',
      onClick: () => { if (live && !live.locked) submit(live.selection.slice()); }
    })
  ]));
  installRovingFocus(board);
  armResponse();
}

function paintSpanCells(cells) {
  const s = live;
  if (!s) return;
  const order = new Map();
  s.selection.forEach((idx, i) => {
    if (!order.has(idx)) order.set(idx, []);
    order.get(idx).push(i + 1);
  });
  cells.forEach((cell, idx) => {
    clearNode(cell);
    if (order.has(idx)) {
      cell.style.borderColor = s.color;
      const mark = h('span', { 'aria-hidden': 'true', style: 'width:70%;height:70%;display:block' });
      mountSvg(mark, pipClusterSvg(order.get(idx)[order.get(idx).length - 1], s.color));
      cell.appendChild(mark);
    } else {
      cell.style.borderColor = 'var(--line,#2a2c34)';
    }
  });
}

function presentStream(trial) {
  const s = live;
  const frames = framesOf(trial);
  const channels = streamChannels(trial, s.level);
  buildStreamControls(channels);
  armResponse();
  if (!frames.length) {
    mountStimulus(trial);
    return;
  }
  playFrames(frames, num(trial.isiMs, 250), () => {
    if (!live || live.locked || live.finished) return;
    /* The response window closed with nothing pressed: that is itself the answer. */
    submit(buildStreamResponse(channels));
  });
}

function buildStreamControls(channels) {
  const s = live;
  const row = h('div', { style: ROW_STYLE + ';justify-content:center' });
  if (channels.length <= 1) {
    row.appendChild(bigControl({
      glyph: GLYPH.match, labelKey: 'drill.match', fallbackLabel: 'Same',
      color: 'var(--good,#43c08a)', onClick: () => submit('match')
    }));
    row.appendChild(bigControl({
      glyph: GLYPH.nomatch, labelKey: 'drill.nomatch', fallbackLabel: 'Different',
      color: 'var(--line-strong,#3a3d47)', onClick: () => submit('nomatch')
    }));
  } else {
    channels.forEach((channel, i) => {
      const btn = bigControl({
        glyph: channelGlyph(i),
        labelKey: 'drill.channel.' + channel,
        fallbackLabel: tx('drill.channel', 'Channel') + ' ' + (i + 1),
        color: i === 0 ? 'var(--good,#43c08a)' : 'var(--accent,#5b8cff)',
        onClick: () => {
          if (!live || live.locked) return;
          const at = live.pressed.indexOf(channel);
          if (at === -1) live.pressed.push(channel);
          else live.pressed.splice(at, 1);
          btn.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
          btn.style.background = at === -1 ? 'var(--bg-elev-2,#1d1f26)' : 'transparent';
          btn.style.outline = at === -1 ? '3px solid var(--accent,#5b8cff)' : 'none';
        }
      });
      btn.setAttribute('aria-pressed', 'false');
      row.appendChild(btn);
    });
  }
  s.responseHost.appendChild(row);
}

/**
 * Stream responses. A single-channel run answers with 'match' / 'nomatch'; a
 * multi-channel run (dual n-back) answers with the list of channels pressed during
 * the window, empty when nothing was pressed.
 */
function buildStreamResponse(channels) {
  const s = live;
  if (channels.length <= 1) return s && s.pressed.length ? 'match' : 'nomatch';
  return s ? s.pressed.slice() : [];
}

function streamChannels(trial, level) {
  if (Array.isArray(trial.channels) && trial.channels.length) return trial.channels.map(String);
  const params = (level && level.params) || {};
  if (Array.isArray(params.channels) && params.channels.length) return params.channels.map(String);
  if (params.dual === true || num(params.streams, 1) === 2) return ['position', 'shape'];
  return ['match'];
}

function channelGlyph(i) {
  return i === 0
    ? '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
      '<rect x="5" y="5" width="10" height="10" fill="currentColor"/>' +
      '<rect x="17" y="17" width="10" height="10" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5"/></svg>'
    : '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
      '<circle cx="16" cy="16" r="10" fill="currentColor"/></svg>';
}

/* ------------------------------------------------------------------ response */

function addToSelection(id, chosen, total) {
  const s = live;
  if (!s || s.locked) return;
  s.selection.push(id);
  updateChosen(chosen, s.selection.length, total);
}

function undoSelection(chosen, total) {
  const s = live;
  if (!s || s.locked) return;
  s.selection.pop();
  updateChosen(chosen, s.selection.length, total);
}

function updateChosen(chosen, n, total) {
  clearNode(chosen);
  const shown = Math.min(12, n);
  for (let i = 0; i < shown; i += 1) {
    chosen.appendChild(h('span', {
      style: 'width:10px;height:10px;border-radius:50%;display:inline-block;' +
        'background:var(--accent,#5b8cff)'
    }));
  }
  chosen.setAttribute('aria-label',
    tx('drill.chosen', 'Chosen so far') + ': ' + n + (total ? ' / ' + total : ''));
}

function armResponse() {
  const s = live;
  if (!s || s.finished) return;
  const raf1 = requestAnimationFrame(() => {
    const raf2 = requestAnimationFrame(() => {
      if (!live || live.finished) return;
      live.shownAt = performance.now();
      live.locked = false;
      armDeadline(live.trial);
    });
    if (live) live.rafIds.push(raf2);
  });
  s.rafIds.push(raf1);
}

/**
 * `Trial.timeLimitMs` is part of the drill contract and only the UI can enforce it:
 * every drill grades a null/empty response as a miss, so a window that never closes
 * silently removes the deadline from every speeded task. Streams are excluded because
 * their window is the frame sequence itself, which the frame player already ends.
 */
function armDeadline(trial) {
  const s = live;
  if (!s || s.finished || s.kind === 'stream') return;
  const limit = num(trial && trial.timeLimitMs, null);
  if (!Number.isFinite(limit) || limit <= 0) return;

  /* For a span or sequence the drill budgets presentation plus recall in one figure;
   * the presentation is already spent by the time the response window opens. */
  let ms = limit;
  if (s.kind === 'span' || s.kind === 'sequence') {
    let shown = 0;
    for (const frame of framesOf(trial)) shown += Math.max(0, num(frame.ms, 0));
    ms = limit - shown;
  }
  ms = Math.max(MIN_DEADLINE_MS, ms);

  s.deadlineBar = deadlineBar(ms, s.reduced);
  if (s.deadlineBar) s.responseHost.appendChild(s.deadlineBar.el);
  s.deadline.set(ms, () => {
    if (!live || live.finished || live.locked) return;
    submit(missResponse());
  });
}

/** What a drill is handed when the window closes with nothing more to say. */
function missResponse() {
  const s = live;
  if (!s) return null;
  if (s.kind === 'span' || s.kind === 'sequence') return s.selection.slice();
  return null;
}

function clearDeadline() {
  const s = live;
  if (!s) return;
  s.deadline.clear();
  if (s.deadlineBar) {
    s.deadlineBar.remove();
    s.deadlineBar = null;
  }
}

/* A wordless response-window indicator: a bar that empties as the time does. It is a
 * plain shrinking rectangle, so it carries no glyph and needs no reading. */
function deadlineBar(ms, reduced) {
  const el = h('div', {
    'aria-hidden': 'true',
    style: 'height:6px;border-radius:999px;margin-top:var(--sp-3,12px);overflow:hidden;' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  const fill = h('div', {
    style: 'height:100%;width:100%;background:var(--accent-dim,#33487f);border-radius:999px'
  });
  el.appendChild(fill);

  let startedAt = performance.now();
  let remaining = ms;
  const run = () => {
    fill.style.transition = 'none';
    fill.style.width = ((remaining / ms) * 100).toFixed(2) + '%';
    /* Two frames so the browser commits the start width before the transition. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.transition = 'width ' + Math.max(0, Math.round(remaining)) + 'ms linear';
        fill.style.width = '0%';
      });
    });
    startedAt = performance.now();
  };
  if (reduced) {
    /* No animation under reduced motion: the bar simply marks that a window exists. */
    fill.style.width = '100%';
  } else {
    run();
  }
  return {
    el,
    pause() {
      if (reduced) return;
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
      fill.style.transition = 'none';
      fill.style.width = ((remaining / ms) * 100).toFixed(2) + '%';
    },
    resume() {
      if (reduced) return;
      run();
    },
    remove() {
      if (el.parentNode) el.remove();
    }
  };
}

function submit(response) {
  const s = live;
  if (!s || s.finished || s.locked) return;
  s.locked = true;
  s.scheduler.clear();
  const rt = s.shownAt > 0 ? Math.max(0, Math.round(performance.now() - s.shownAt)) : 0;
  let outcome = null;
  try {
    outcome = s.session.respond(response, rt);
  } catch (err) {
    showFailure(err);
    return;
  }
  s.answered += 1;
  s.lastAnsweredId = s.trial ? s.trial.id : null;
  s.trialMeter.set(s.totalTrials > 0 ? Math.min(1, s.answered / s.totalTrials) : 0);

  /* Training gives immediate correct/incorrect feedback on every trial. This is the
   * deliberate opposite of the assessment in test.js, where feedback would corrupt
   * the measurement: here the feedback is the whole point, because learning a
   * relational rule needs an error signal. */
  const correct = readCorrect(outcome, s.session);
  showFeedback(correct);

  const st = stateOf(s.session);
  const lvl = num(st.level, null);
  if (Number.isFinite(lvl)) {
    s.maxLevelSeen = Math.max(s.maxLevelSeen, lvl);
    s.levelMeter.set(lvl / Math.max(6, s.maxLevelSeen + 1));
  }

  const done = (outcome && outcome.done === true) || st.done === true;
  s.scheduler.set(s.reduced ? 260 : FEEDBACK_MS, () => {
    if (!live || live.finished) return;
    setStageState('neutral');
    if (done) finishUp();
    else step();
  });
}

function readCorrect(outcome, session) {
  if (outcome === true) return true;
  if (outcome === false) return false;
  if (outcome && typeof outcome === 'object') {
    if (typeof outcome.correct === 'boolean') return outcome.correct;
    if (outcome.result && typeof outcome.result.correct === 'boolean') return outcome.result.correct;
  }
  const st = stateOf(session);
  if (typeof st.lastCorrect === 'boolean') return st.lastCorrect;
  return null;
}

/* Feedback is shape plus colour, never colour alone: a filled disc for a correct
 * answer, an open dashed ring for an incorrect one. */
function showFeedback(correct) {
  const s = live;
  if (!s) return;
  if (correct === null) {
    setStageState('neutral');
    return;
  }
  setStageState(correct ? 'good' : 'bad');
  const mark = h('div', {
    'aria-hidden': 'true',
    style: 'position:absolute;right:14px;top:14px;width:34px;height:34px'
  });
  mountSvg(mark, correct
    ? '<svg viewBox="0 0 34 34" width="100%" height="100%">' +
      '<circle cx="17" cy="17" r="13" fill="var(--good,#43c08a)"/></svg>'
    : '<svg viewBox="0 0 34 34" width="100%" height="100%">' +
      '<circle cx="17" cy="17" r="13" fill="none" stroke="var(--bad,#e0605e)" ' +
      'stroke-width="4" stroke-dasharray="5 5"/></svg>');
  s.stage.style.position = 'relative';
  s.stage.appendChild(mark);
  s.status.textContent = correct
    ? tx('drill.correct', 'Correct')
    : tx('drill.incorrect', 'Not this time');
  const timer = setTimeout(() => mark.remove(), s.reduced ? 260 : FEEDBACK_MS);
  cleanup.push(() => clearTimeout(timer));
}

function setStageState(kind) {
  const s = live;
  if (!s) return;
  const color = kind === 'good'
    ? 'var(--good,#43c08a)'
    : (kind === 'bad' ? 'var(--bad,#e0605e)' : 'var(--line,#2a2c34)');
  s.stage.style.borderColor = color;
}

/* -------------------------------------------------------------------- frames */

function framesOf(trial) {
  const stim = trial && trial.stimulus;
  if (stim && Array.isArray(stim.frames)) return stim.frames.filter((f) => f && f.svg);
  return [];
}

function mountStimulus(trial) {
  const s = live;
  const stim = (trial && trial.stimulus) || {};
  if (typeof stim.svg === 'string') {
    mountSvg(s.stageInner, stim.svg);
    return;
  }
  const frames = framesOf(trial);
  if (frames.length) mountSvg(s.stageInner, frames[frames.length - 1].svg);
  else clearNode(s.stageInner);
}

function playFrames(frames, isiMs, onDone) {
  const s = live;
  if (!s) return;
  let i = 0;
  const showBlank = () => {
    clearNode(s.stageInner);
  };
  const step2 = () => {
    if (!live || live.finished) return;
    if (i >= frames.length) {
      onDone();
      return;
    }
    const frame = frames[i];
    i += 1;
    mountSvg(s.stageInner, frame.svg);
    const dur = Math.max(60, Math.min(6000, num(frame.ms, 700)));
    s.scheduler.set(dur, () => {
      const gap = Math.max(0, num(isiMs, 0));
      if (gap > 0) {
        showBlank();
        s.scheduler.set(gap, step2);
      } else {
        step2();
      }
    });
  };
  step2();
}

function makeScheduler() {
  let id = null;
  let fn = null;
  let endAt = 0;
  let remaining = 0;
  let paused = false;
  const api = {
    set(ms, callback) {
      api.clear();
      fn = callback;
      remaining = Math.max(0, Number(ms) || 0);
      if (paused) return;
      endAt = performance.now() + remaining;
      id = setTimeout(() => {
        id = null;
        const f = fn;
        fn = null;
        if (f) f();
      }, remaining);
    },
    pause() {
      if (paused) return;
      paused = true;
      if (id !== null) {
        clearTimeout(id);
        id = null;
        remaining = Math.max(0, endAt - performance.now());
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (fn) {
        const f = fn;
        const ms = remaining;
        fn = null;
        api.set(ms, f);
      }
    },
    clear() {
      if (id !== null) clearTimeout(id);
      id = null;
      fn = null;
      remaining = 0;
    }
  };
  return api;
}

function showPaused(on) {
  const s = live;
  if (!s) return;
  const existing = s.root.querySelector('[data-paused]');
  if (!on) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const panel = h('div', {
    'data-paused': 'true',
    role: 'status',
    style: 'display:flex;align-items:center;justify-content:center;gap:var(--sp-3,12px);' +
      'padding:var(--sp-3,12px);border:1px solid var(--warn,#d9a441);' +
      'border-radius:var(--r-md,12px);background:var(--bg-elev,#16171c)'
  });
  const mark = h('span', { 'aria-hidden': 'true', style: 'width:24px;height:24px;display:block' });
  mountSvg(mark, GLYPH.pause);
  panel.appendChild(mark);
  panel.appendChild(h('span', {
    style: 'font-size:14px;color:var(--fg-dim,#a9abb6)',
    text: tx('drill.paused', 'Paused')
  }));
  s.root.insertBefore(panel, s.stage);
}

/* --------------------------------------------------------------- demo gating */

function showDemoGate(drillId, done) {
  const s = live;
  if (!s) return;
  clearNode(s.overlay);
  s.overlay.setAttribute('style',
    'display:flex;flex-direction:column;gap:var(--sp-4,16px);align-items:center;' +
    'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
    'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px)');
  s.stage.style.display = 'none';
  s.header.style.visibility = 'hidden';

  const host = h('div', {
    style: 'width:100%;max-width:420px;min-height:200px;display:flex;' +
      'align-items:center;justify-content:center'
  });
  const stop = mountDemo(host, drillId, s.reduced);
  cleanup.push(stop);

  const proceed = actionButton({
    iconKey: 'play', glyph: GLYPH.play, labelKey: ['drill.begin', 'start'],
    fallbackLabel: 'Begin', variant: 'primary', large: true,
    onClick: () => {
      stop();
      s.overlay.setAttribute('style', 'display:none');
      clearNode(s.overlay);
      s.stage.style.display = 'flex';
      s.header.style.visibility = 'visible';
      done();
    }
  });
  s.overlay.appendChild(host);
  s.overlay.appendChild(proceed);
  const raf = requestAnimationFrame(() => {
    if (proceed && proceed.focus) proceed.focus();
  });
  s.rafIds.push(raf);
}

function mountDemo(host, kindId, reduced) {
  let demo = null;
  try { demo = demoFor(kindId); } catch (err) { demo = null; }
  const frames = demo && Array.isArray(demo.frames) ? demo.frames.filter((f) => f && f.svg) : [];
  if (!frames.length) {
    host.appendChild(h('p', {
      style: 'color:var(--fg-dim,#a9abb6);font-size:14px;text-align:center;margin:0',
      text: tx('drill.noDemo', 'Watch, then respond as quickly as you can be accurate.')
    }));
    return () => {};
  }
  if (reduced) {
    const strip = h('div', {
      style: 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center'
    });
    for (const frame of frames) {
      const cellEl = h('div', { style: 'width:100px;height:100px' });
      mountSvg(cellEl, frame.svg);
      strip.appendChild(cellEl);
    }
    host.appendChild(strip);
    return () => {};
  }
  const view = h('div', { style: 'width:100%;display:flex;justify-content:center' });
  host.appendChild(view);
  let i = 0;
  let timer = null;
  let stopped = false;
  const stepDemo = () => {
    if (stopped) return;
    const frame = frames[i % frames.length];
    mountSvg(view, frame.svg);
    const ms = Math.max(150, Math.min(4000, num(frame.ms, 700)));
    i += 1;
    if (demo.loop === false && i >= frames.length) return;
    timer = setTimeout(stepDemo, ms);
  };
  stepDemo();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/* --------------------------------------------------------------- finishing up */

function finishUp() {
  const s = live;
  if (!s || s.finished) return;
  s.finished = true;
  s.scheduler.clear();
  let outcome = safeCall(() => s.session ? s.session.finish() : null, null);
  if (!outcome || typeof outcome !== 'object') {
    outcome = {
      levelId: s.level.id,
      drill: s.level.drill,
      accuracy: 0,
      trials: s.answered,
      meanMs: 0,
      finalLevel: s.maxLevelSeen,
      stars: 0,
      xp: 0,
      factorDelta: 0,
      passed: false
    };
  }
  writeOutcome(s.profile, s.level, outcome);
  try { saveProfile(s.profile); } catch (err) { /* store handles its own fallback */ }
  emit(s.ctx, 'profile:changed', s.profile);
  emit(s.ctx, 'drill:complete', outcome);
  renderSummary(outcome);
}

function writeOutcome(profile, level, outcome) {
  const at = Date.now();
  if (!profile.levels || typeof profile.levels !== 'object') profile.levels = {};
  if (!profile.drillStats || typeof profile.drillStats !== 'object') profile.drillStats = {};
  if (!profile.factorScores || typeof profile.factorScores !== 'object') profile.factorScores = {};

  const prev = profile.levels[level.id] || {};
  const stars = Math.max(0, Math.floor(num(outcome.stars, 0)));
  const accuracy = clamp01(num(outcome.accuracy, 0));
  const finalLevel = Math.max(0, num(outcome.finalLevel, 0));
  profile.levels[level.id] = {
    unlocked: true,
    stars: Math.max(Math.max(0, Math.floor(num(prev.stars, 0))), stars),
    bestScore: Math.max(clamp01(num(prev.bestScore, 0)), accuracy),
    attempts: Math.max(0, Math.floor(num(prev.attempts, 0))) + 1,
    lastAt: at,
    bestLevel: Math.max(Math.max(0, num(prev.bestLevel, 0)), finalLevel)
  };

  const drillId = outcome.drill || level.drill;
  if (drillId) {
    const ds = profile.drillStats[drillId] || {};
    const prevTrials = Math.max(0, Math.floor(num(ds.totalTrials, 0)));
    const trials = Math.max(0, Math.floor(num(outcome.trials, 0)));
    const total = prevTrials + trials;
    profile.drillStats[drillId] = {
      sessions: Math.max(0, Math.floor(num(ds.sessions, 0))) + 1,
      totalTrials: total,
      accuracy: total > 0
        ? (clamp01(num(ds.accuracy, 0)) * prevTrials + accuracy * trials) / total
        : clamp01(num(ds.accuracy, 0)),
      bestLevel: Math.max(Math.max(0, num(ds.bestLevel, 0)), finalLevel),
      msPerTrial: total > 0
        ? (Math.max(0, num(ds.msPerTrial, 0)) * prevTrials +
           Math.max(0, num(outcome.meanMs, 0)) * trials) / total
        : Math.max(0, num(ds.msPerTrial, 0))
    };
  }

  profile.xp = Math.max(0, Math.round(num(profile.xp, 0) + num(outcome.xp, 0)));

  const factor = level.factor;
  if (factor) {
    const before = num(profile.factorScores[factor], 0);
    const delta = num(outcome.factorDelta, 0);
    /* factorScores has no contracted range; the delta is applied and only bounded
     * below at zero and above at 100 so a runaway value cannot corrupt the radar. */
    profile.factorScores[factor] = Math.max(0, Math.min(100, before + delta));
  }

  touchStreak(profile, at);
  profile.updatedAt = at;

  /* Keep the stored unlock flags in step with what the curriculum now derives. */
  const unlocked = safeCall(() => unlockedLevels(profile), null);
  if (Array.isArray(unlocked)) {
    for (const entry of unlocked) {
      const id = typeof entry === 'string' ? entry : (entry && entry.id);
      if (!id) continue;
      const rec = profile.levels[id] || {
        unlocked: true, stars: 0, bestScore: 0, attempts: 0, lastAt: null, bestLevel: 0
      };
      rec.unlocked = true;
      profile.levels[id] = rec;
    }
  }
}

function renderSummary(outcome) {
  const s = live;
  if (!s) return;
  clearNode(s.responseHost);
  clearNode(s.stageInner);
  s.stage.style.display = 'flex';
  s.header.style.visibility = 'visible';
  setStageState('neutral');
  s.levelMeter.set(num(outcome.finalLevel, s.maxLevelSeen) / Math.max(6, s.maxLevelSeen + 1));
  s.trialMeter.set(1);

  const stars = Math.max(0, Math.floor(num(outcome.stars, 0)));
  const total = Array.isArray(s.level.stars) && s.level.stars.length ? s.level.stars.length : 3;
  const accuracy = clamp01(num(outcome.accuracy, 0));

  const card = h('section', { style: CARD_STYLE + ';align-items:center' });
  card.appendChild(starRow(stars, total, true));
  card.appendChild(h('div', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:32px',
    text: Math.round(accuracy * 100) + '%'
  }));
  const facts = h('div', {
    style: 'display:flex;flex-wrap:wrap;gap:var(--sp-4,16px);justify-content:center;' +
      'font-size:13px;color:var(--fg-mute,#7b7d88);font-family:var(--mono,ui-monospace,monospace)'
  });
  facts.appendChild(h('span', {
    text: '+' + Math.max(0, Math.round(num(outcome.xp, 0))) + ' XP'
  }));
  if (Number.isFinite(num(outcome.finalLevel, null))) {
    facts.appendChild(h('span', {
      'aria-label': tx('drill.finalLevel', 'Final difficulty'),
      text: '● ' + Math.round(num(outcome.finalLevel, 0) * 10) / 10
    }));
  }
  if (Number.isFinite(num(outcome.meanMs, null)) && outcome.meanMs > 0) {
    facts.appendChild(h('span', { text: Math.round(num(outcome.meanMs, 0)) + ' ms' }));
  }
  card.appendChild(facts);

  const row = h('div', { style: ROW_STYLE + ';justify-content:center' });
  row.appendChild(actionButton({
    iconKey: 'retry', glyph: GLYPH.retry, labelKey: ['drill.retry', 'retry'],
    fallbackLabel: 'Again', variant: 'primary',
    onClick: () => {
      const ctx = s.ctx;
      const root = s.root;
      const fresh = render(ctx);
      if (root.parentNode) root.replaceWith(fresh);
    }
  }));
  const next = safeCall(() => nextLevel(s.profile), null);
  if (next && next.id && next.id !== s.level.id) {
    row.appendChild(actionButton({
      iconKey: 'play', glyph: GLYPH.play, labelKey: ['drill.next', 'continue'],
      fallbackLabel: 'Next level',
      onClick: () => navigate(s.ctx, '#/train/' + encodeURIComponent(next.id))
    }));
  }
  row.appendChild(actionButton({
    iconKey: 'map', glyph: GLYPH.map, labelKey: ['drill.map', 'train'],
    fallbackLabel: 'Level map', onClick: () => navigate(s.ctx, '#/train')
  }));
  card.appendChild(row);

  if (outcome.passed === false && stars === 0) {
    card.appendChild(h('p', {
      style: 'margin:0;font-size:13px;line-height:1.55;color:var(--fg-mute,#7b7d88);text-align:center',
      text: tx('drill.notPassed',
        'Not passed this time. The difficulty adapts to you, so repeating the same level ' +
        'is normal and is how the gain happens.')
    }));
  }
  s.responseHost.appendChild(card);
  const focusable = card.querySelector('button');
  if (focusable) focusable.focus();
}

function starRow(earned, total, large) {
  const size = large ? 22 : 12;
  const row = h('div', {
    role: 'img',
    'aria-label': earned + ' / ' + total,
    style: 'display:flex;gap:8px;align-items:center'
  });
  for (let i = 0; i < total; i += 1) {
    const on = i < earned;
    row.appendChild(h('span', {
      style: 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;display:inline-block;' +
        'border:3px solid ' + (on ? 'var(--good,#43c08a)' : 'var(--line-strong,#3a3d47)') + ';' +
        'background:' + (on ? 'var(--good,#43c08a)' : 'transparent')
    }));
  }
  return row;
}

function showFailure(err) {
  const s = live;
  if (!s) return;
  s.finished = true;
  s.scheduler.clear();
  clearNode(s.responseHost);
  clearNode(s.stageInner);
  s.overlay.setAttribute('style', 'display:none');
  s.stage.style.display = 'flex';
  const box = h('div', {
    role: 'alert',
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);align-items:center;' +
      'padding:var(--sp-5,20px);border:1px solid var(--bad,#e0605e);border-radius:var(--r-md,12px)'
  });
  box.appendChild(h('p', {
    style: 'margin:0;color:var(--fg-dim,#a9abb6);text-align:center;font-size:14px',
    text: tx('drill.error', 'This drill could not run.') +
      (err && err.message ? ' (' + err.message + ')' : '')
  }));
  box.appendChild(actionButton({
    iconKey: 'map', glyph: GLYPH.map, labelKey: ['drill.map', 'train'],
    fallbackLabel: 'Level map', variant: 'primary',
    onClick: () => navigate(s.ctx, '#/train')
  }));
  s.responseHost.appendChild(box);
}

/* ------------------------------------------------------------------- helpers */

function readLevelId(ctx) {
  const params = (ctx && ctx.params) || {};
  const raw = params.levelId || params.id || params[0] || '';
  if (typeof raw !== 'string' || !raw.length) return '';
  try { return decodeURIComponent(raw); } catch (err) { return raw; }
}

function isUnlocked(profile, level) {
  const rec = ((profile && profile.levels) || {})[level.id];
  if (rec && rec.unlocked === true) return true;
  const list = safeCall(() => unlockedLevels(profile), null);
  if (Array.isArray(list)) {
    for (const entry of list) {
      const id = typeof entry === 'string' ? entry : (entry && entry.id);
      if (id === level.id) return true;
    }
    return false;
  }
  return false;
}

/**
 * The response grid for span trials. The Trial contract does not carry a grid shape,
 * so every plausible source is tried in order and the answer's largest index is the
 * last resort — a mismatch there would misplace cells, so explicit params win.
 */
function resolveGrid(trial, level) {
  const params = (level && level.params) || {};
  for (const cand of [trial && trial.grid, params.grid]) {
    if (cand && typeof cand === 'object') {
      const rows = num(cand.rows, 0);
      const cols = num(cand.cols, 0);
      if (rows > 0 && cols > 0) return { rows, cols };
    }
  }
  const rows = num(trial && trial.rows, num(params.rows, 0));
  const cols = num(trial && trial.cols, num(params.cols, 0));
  if (rows > 0 && cols > 0) return { rows, cols };
  const flat = num(trial && trial.gridCells, num(params.gridCells,
    num(trial && trial.gridSize, num(params.gridSize,
      num(trial && trial.cellCount, num(params.cellCount, num(params.cells, 0)))))));
  if (flat > 0) {
    const side = Math.round(Math.sqrt(flat));
    if (side * side === flat) return { rows: side, cols: side };
    const c = Math.ceil(Math.sqrt(flat));
    return { rows: Math.ceil(flat / c), cols: c };
  }
  const answer = Array.isArray(trial && trial.answer) ? trial.answer : [];
  const idxs = answer.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const needed = idxs.length ? Math.max.apply(null, idxs) + 1 : 9;
  for (const side of [3, 4, 5, 6]) {
    if (side * side >= needed) return { rows: side, cols: side };
  }
  return { rows: 3, cols: 3 };
}

/* Order marks inside a span cell, as a subitizable dot cluster rather than a numeral. */
function pipClusterSvg(order, color) {
  const n = Math.max(1, Math.min(9, Math.round(order)));
  const cols = n <= 3 ? n : (n <= 6 ? 3 : 3);
  const rows = Math.ceil(n / cols);
  const cell = 30;
  const w = cols * cell;
  const hh = rows * cell;
  let dots = '';
  for (let i = 0; i < n; i += 1) {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    dots += '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="' + color + '"/>';
  }
  return '<svg viewBox="0 0 ' + w + ' ' + hh + '" width="100%" height="100%" ' +
    'preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + dots + '</svg>';
}

function stateOf(session) {
  try {
    const v = session && session.state;
    return (typeof v === 'function' ? v.call(session) : v) || {};
  } catch (err) {
    return {};
  }
}

function freshRng(ctx, levelId) {
  const tag = 'drill:' + levelId + ':' + Date.now();
  if (ctx && ctx.rng && typeof ctx.rng.fork === 'function') {
    const forked = safeCall(() => ctx.rng.fork(tag), null);
    if (forked && typeof forked.next === 'function') return forked;
  }
  return makeRng(tag);
}

function touchStreak(profile, at) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  const day = Math.floor(d.getTime() / 86400000);
  const streak = profile.streak && typeof profile.streak === 'object'
    ? profile.streak
    : { days: 0, lastDay: null };
  if (streak.lastDay === day) streak.days = Math.max(1, Math.floor(num(streak.days, 0)));
  else if (streak.lastDay === day - 1) streak.days = Math.max(1, Math.floor(num(streak.days, 0))) + 1;
  else streak.days = 1;
  streak.lastDay = day;
  profile.streak = streak;
}

function resolvePickedId(picked, options) {
  if (typeof picked === 'string') return picked;
  if (picked && typeof picked === 'object' && typeof picked.id === 'string') return picked.id;
  if (typeof picked === 'number' && options[picked]) return options[picked].id;
  return null;
}

function localOptionGrid(options, columns, onPickId) {
  const grid = h('div', {
    role: 'group',
    style: 'display:grid;gap:var(--sp-3,12px);grid-template-columns:repeat(' +
      columns + ',minmax(0,1fr))'
  });
  options.forEach((opt, i) => {
    const id = opt && opt.id ? opt.id : 'o' + i;
    const cell = h('button', {
      type: 'button',
      'data-option-id': id,
      'aria-label': tx('drill.option', 'Option') + ' ' + (i + 1),
      style: 'padding:8px;cursor:pointer;background:var(--bg-elev,#16171c);' +
        'border:2px solid var(--line,#2a2c34);border-radius:var(--r-md,12px);' +
        'aspect-ratio:1/1;display:flex;align-items:center;justify-content:center'
    });
    const inner = h('div', { style: 'width:100%;height:100%' });
    mountSvg(inner, opt && typeof opt.svg === 'string' ? opt.svg : '');
    cell.appendChild(inner);
    cell.addEventListener('click', () => onPickId(id));
    grid.appendChild(cell);
  });
  return grid;
}

function installRovingFocus(grid) {
  const handler = (ev) => {
    if (ev.defaultPrevented) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (keys.indexOf(ev.key) === -1) return;
    const items = focusables(grid);
    if (items.length < 2) return;
    const cur = items.indexOf(document.activeElement);
    const cols = columnCount(grid, items.length);
    let next = cur;
    if (ev.key === 'ArrowRight') next = cur < 0 ? 0 : (cur + 1) % items.length;
    else if (ev.key === 'ArrowLeft') next = cur < 0 ? 0 : (cur - 1 + items.length) % items.length;
    else if (ev.key === 'ArrowDown') next = cur < 0 ? 0 : Math.min(items.length - 1, cur + cols);
    else if (ev.key === 'ArrowUp') next = cur < 0 ? 0 : Math.max(0, cur - cols);
    else if (ev.key === 'Home') next = 0;
    else next = items.length - 1;
    if (next !== cur && items[next]) {
      ev.preventDefault();
      items[next].focus();
    }
  };
  grid.addEventListener('keydown', handler);
  cleanup.push(() => grid.removeEventListener('keydown', handler));
}

function columnCount(grid, fallbackCount) {
  try {
    const cols = window.getComputedStyle(grid).gridTemplateColumns;
    if (cols && cols !== 'none') {
      const n = cols.trim().split(/\s+/).length;
      if (n > 0) return n;
    }
  } catch (err) { /* fall through */ }
  return Math.max(1, Math.round(Math.sqrt(fallbackCount)));
}

function focusables(root) {
  return Array.prototype.slice.call(
    root.querySelectorAll('button, [role="button"], [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled'));
}

function meterEl(value, ariaLabel, color) {
  const track = h('div', {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    'aria-label': ariaLabel,
    style: 'height:10px;border-radius:999px;overflow:hidden;' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  const fill = h('div', {
    style: 'height:100%;width:0%;background:' + (color || 'var(--accent,#5b8cff)') +
      ';transition:width .3s ease'
  });
  track.appendChild(fill);
  return {
    el: track,
    set(v) {
      const pct = Math.max(0, Math.min(1, Number(v) || 0)) * 100;
      fill.style.width = pct.toFixed(1) + '%';
      track.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
  };
}

function bigControl(spec) {
  const label = tx(spec.labelKey, spec.fallbackLabel);
  const btn = h('button', {
    type: 'button',
    'aria-label': label,
    title: label,
    style: 'display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;' +
      'min-width:120px;padding:16px 22px;border-radius:var(--r-md,12px);font:inherit;' +
      'border:3px solid ' + spec.color + ';background:transparent;color:var(--fg,#e9e9ee)'
  });
  const mark = h('span', { 'aria-hidden': 'true', style: 'width:34px;height:34px;display:block' });
  mountSvg(mark, spec.glyph);
  btn.appendChild(mark);
  if (labelsOn()) btn.appendChild(h('span', { style: 'font-size:13px', text: label }));
  btn.addEventListener('click', spec.onClick);
  return btn;
}

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = String(value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  const list = kids === undefined || kids === null ? [] : [].concat(kids);
  for (const kid of list) {
    if (!kid) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function compose(make, fallback) {
  try {
    const node = make();
    if (node && node.nodeType === 1) return node;
  } catch (err) { /* component drift must not stall the drill */ }
  return fallback();
}

function safeCall(fn, fallback) {
  try {
    const out = fn();
    return out === undefined ? fallback : out;
  } catch (err) {
    return fallback;
  }
}

/**
 * Push the profile's label preference into the i18n layer before the screen
 * builds. Labels are supplementary only -- the drill stays fully playable with
 * them off -- so a missing or malformed setting simply leaves i18n as it is.
 */
function syncLabels(profile) {
  const settings = (profile && profile.settings) || {};
  if (typeof settings.showLabels !== 'boolean') return;
  safeCall(() => setLabelsEnabled(settings.showLabels), null);
}

/**
 * Look a label up in i18n, accepting a list of candidate keys so a screen can use its
 * own specific key and still fall back to the shared chrome vocabulary. The English
 * fallback is always the last resort: nothing functional depends on any of them.
 */
function tx(key, fallback) {
  const keys = Array.isArray(key) ? key : [key];
  for (const candidate of keys) {
    const s = safeCall(() => t(candidate), '');
    if (typeof s === 'string' && s.length) return s;
  }
  return fallback;
}

function labelsOn() {
  return safeCall(() => labelsEnabled(), true) !== false;
}

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp01(v) {
  const n = num(v, 0);
  if (n > 1 && n <= 100) return n / 100;
  return Math.max(0, Math.min(1, n));
}

function iconEl(key, size, fallbackSvg) {
  const host = h('span', {
    'aria-hidden': 'true',
    style: 'display:inline-flex;align-items:center;justify-content:center;width:' +
      size + 'px;height:' + size + 'px;flex:0 0 auto'
  });
  let out = null;
  try { out = icon(key, size); } catch (err) { out = null; }
  if (out && out.nodeType === 1) host.appendChild(out);
  else if (typeof out === 'string' && out.trim().length) mountSvg(host, out);
  else if (fallbackSvg) mountSvg(host, fallbackSvg);
  return host;
}

function actionButton(spec) {
  const label = tx(spec.labelKey, spec.fallbackLabel);
  const node = compose(
    () => button({
      icon: spec.iconKey,
      label: labelsOn() ? label : '',
      onClick: spec.onClick,
      variant: spec.variant || 'default'
    }),
    () => localButton(spec, label)
  );
  if (!node.getAttribute('aria-label') && !node.textContent.trim()) {
    node.setAttribute('aria-label', label);
  }
  if (!node.getAttribute('title')) node.setAttribute('title', label);
  return node;
}

function localButton(spec, label) {
  const primary = spec.variant === 'primary';
  const btn = h('button', {
    type: 'button',
    class: 'btn' + (primary ? ' btn-primary' : ''),
    'aria-label': label,
    style: 'display:inline-flex;align-items:center;gap:var(--sp-2,8px);cursor:pointer;' +
      'padding:' + (spec.large ? '14px 24px' : '10px 14px') + ';' +
      'border-radius:var(--r-md,12px);font:inherit;font-size:' + (spec.large ? '17px' : '15px') + ';' +
      'border:1px solid ' + (primary ? 'var(--accent,#5b8cff)' : 'var(--line-strong,#3a3d47)') + ';' +
      'background:' + (primary ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)') + ';' +
      'color:' + (primary ? 'var(--bg,#0e0f13)' : 'var(--fg,#e9e9ee)') + ';flex:0 0 auto'
  });
  btn.appendChild(iconEl(spec.iconKey, spec.large ? 26 : 20, spec.glyph));
  if (labelsOn() && label && !spec.compact) btn.appendChild(h('span', { text: label }));
  if (typeof spec.onClick === 'function') btn.addEventListener('click', spec.onClick);
  return btn;
}

function emit(ctx, type, payload) {
  if (ctx && ctx.bus && typeof ctx.bus.emit === 'function') {
    try { ctx.bus.emit(type, payload); } catch (err) { /* bus is advisory */ }
  }
}

function prefersReducedMotion(profile) {
  const flag = profile && profile.settings && profile.settings.reducedMotion;
  if (flag === true) return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (err) {
    return false;
  }
}

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
}
