/**
 * Screen: test. The adaptive assessment runner. Drives a CAT session, shows a
 * wordless demonstration the first time each item family appears, records response
 * time from first paint, and writes the finished assessment into the profile.
 */

import { mountSvg, button, optionGrid } from '../components.js';
import { icon } from '../icons.js';
import { demoFor } from '../demos.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { createSession, CAT_DEFAULTS } from '../../core/cat.js';
import { makeRng } from '../../core/rng.js';
import { saveProfile } from '../../core/store.js';
import { tierFor } from '../../core/scale.js';

const LAST_RESULT_KEY = 'eqgame.lastResult.v1';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-4,16px);' +
  'padding:var(--sp-4,16px);max-width:840px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;min-height:100%;color:var(--fg,#e9e9ee);' +
  'font-family:var(--font,system-ui,sans-serif)';

const STAGE_STYLE =
  'display:flex;align-items:center;justify-content:center;background:var(--bg-elev,#16171c);' +
  'border:1px solid var(--line,#2a2c34);border-radius:var(--r-lg,16px);' +
  'padding:var(--sp-4,16px);min-height:220px';

const GLYPH = {
  skip: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-dasharray="4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M7 4 L20 12 L7 20 Z" fill="currentColor"/></svg>',
  leave: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>'
};

let cleanup = [];
let live = null;

export function render(ctx) {
  destroy();

  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-test', style: SCREEN_STYLE });

  const meter = abstractMeter(tx('test.progress', 'Completion'));
  const skipBtn = actionButton({
    iconKey: 'skip', glyph: GLYPH.skip, labelKey: 'test.skip',
    fallbackLabel: 'Skip', onClick: () => onSkip()
  });
  const leaveBtn = actionButton({
    iconKey: 'leave', glyph: GLYPH.leave, labelKey: 'test.leave',
    fallbackLabel: 'Leave', compact: true, onClick: () => onLeaveRequest()
  });

  const bar = h('header', {
    style: 'display:flex;align-items:center;gap:var(--sp-3,12px)'
  }, [leaveBtn, meter.el, skipBtn]);

  const stage = h('section', { class: 'stage', style: STAGE_STYLE });
  const stageInner = h('div', { style: 'width:100%;max-width:520px' });
  stage.appendChild(stageInner);

  const optionsHost = h('section', { class: 'options', style: 'min-height:120px' });
  const overlay = h('section', { class: 'demo-gate', style: 'display:none' });
  const status = h('div', {
    role: 'status',
    'aria-live': 'polite',
    style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap'
  });

  root.appendChild(bar);
  root.appendChild(overlay);
  root.appendChild(stage);
  root.appendChild(optionsHost);
  root.appendChild(status);

  live = {
    ctx,
    profile,
    root,
    stage,
    stageInner,
    optionsHost,
    overlay,
    status,
    meter,
    skipBtn,
    bar,
    session: null,
    item: null,
    seenFamilies: new Set(),
    shownAt: 0,
    locked: true,
    finished: false,
    keyboardInput: false,
    rafIds: [],
    timers: []
  };

  /* Track the pointer/keyboard modality so focus is only moved for keyboard users. */
  const onKeyGlobal = () => { if (live) live.keyboardInput = true; };
  const onPointerGlobal = () => { if (live) live.keyboardInput = false; };
  window.addEventListener('keydown', onKeyGlobal, true);
  window.addEventListener('pointerdown', onPointerGlobal, true);
  cleanup.push(() => {
    window.removeEventListener('keydown', onKeyGlobal, true);
    window.removeEventListener('pointerdown', onPointerGlobal, true);
  });

  startSession();
  return root;
}

export function destroy() {
  if (live) {
    for (const id of live.rafIds) cancelAnimationFrame(id);
    for (const id of live.timers) clearTimeout(id);
    live.rafIds = [];
    live.timers = [];
    live.finished = true;
  }
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
  live = null;
}

/* ------------------------------------------------------------------- session */

function startSession() {
  const state = live;
  if (!state) return;
  const rng = freshRng(state.ctx);
  let session = null;
  try {
    session = createSession({
      rng,
      bank: state.profile && state.profile.bank ? state.profile.bank : null,
      optionCount: CAT_DEFAULTS && CAT_DEFAULTS.optionCount ? CAT_DEFAULTS.optionCount : 8
    });
  } catch (err) {
    showFailure(err);
    return;
  }
  if (!session || typeof session.nextItem !== 'function') {
    showFailure(new Error('cat session unavailable'));
    return;
  }
  state.session = session;
  advance();
}

function advance() {
  const state = live;
  if (!state || state.finished) return;
  let item = null;
  try {
    item = state.session.nextItem();
  } catch (err) {
    showFailure(err);
    return;
  }
  if (!item) {
    finish();
    return;
  }
  state.item = item;
  const family = item.family || 'item';
  if (!state.seenFamilies.has(family)) {
    state.seenFamilies.add(family);
    /* Nobody meets a format for the first time inside a scored item. */
    showDemoGate(family, () => present(item));
  } else {
    present(item);
  }
}

function present(item) {
  const state = live;
  if (!state || state.finished) return;
  state.locked = true;
  state.shownAt = 0;
  state.overlay.style.display = 'none';
  clearNode(state.overlay);
  state.bar.style.visibility = 'visible';
  const stalePanel = state.root.querySelector('[data-leave-confirm]');
  if (stalePanel) {
    stalePanel.remove();
    state.leaving = false;
  }

  const prompt = item.prompt || {};
  mountSvg(state.stageInner, typeof prompt.svg === 'string' ? prompt.svg : '');

  clearNode(state.optionsHost);
  const options = Array.isArray(item.options) ? item.options : [];
  const columns = options.length >= 8 ? 4 : (options.length >= 6 ? 3 : 2);
  const grid = compose(
    () => optionGrid({
      options,
      columns,
      onPick: (picked) => onPick(resolvePickedId(picked, options))
    }),
    () => localOptionGrid(options, columns, (id) => onPick(id))
  );
  grid.setAttribute('aria-label', tx('test.options', 'Choose the piece that fits'));
  state.optionsHost.appendChild(grid);
  installRovingFocus(grid);

  state.status.textContent = tx('test.newItem', 'New puzzle');

  /* Response time starts at the first frame the stimulus is actually painted. */
  const raf1 = requestAnimationFrame(() => {
    const raf2 = requestAnimationFrame(() => {
      if (!live || live.finished) return;
      live.shownAt = performance.now();
      live.locked = false;
      if (live.keyboardInput) {
        const first = firstFocusable(grid);
        if (first) first.focus();
      }
    });
    if (live) live.rafIds.push(raf2);
  });
  state.rafIds.push(raf1);
}

function onPick(optionId) {
  const state = live;
  if (!state || state.finished || state.locked || !optionId) return;
  state.locked = true;
  const rt = state.shownAt > 0 ? Math.max(0, Math.round(performance.now() - state.shownAt)) : 0;
  let outcome = null;
  try {
    outcome = state.session.submit(optionId, rt);
  } catch (err) {
    showFailure(err);
    return;
  }
  /* No correct/incorrect feedback is shown during the assessment. Feedback would let
   * the examinee infer the rule set mid-test and would change their strategy after an
   * error, which corrupts the measurement the adaptive algorithm is making. Training
   * (drill.js) does the opposite and gives feedback on every trial. */
  updateMeter();
  if (outcome && outcome.done === true) finish();
  else if (readState().done === true) finish();
  else advance();
}

function onSkip() {
  const state = live;
  if (!state || state.finished || state.locked) return;
  state.locked = true;
  try {
    state.session.skip();
  } catch (err) {
    showFailure(err);
    return;
  }
  /* A skip is scored as incorrect, per the contract. It is still not fed back. */
  updateMeter();
  if (readState().done === true) finish();
  else advance();
}

function finish() {
  const state = live;
  if (!state || state.finished) return;
  state.finished = true;
  let result = null;
  try {
    result = state.session.result();
  } catch (err) {
    showFailure(err);
    return;
  }
  if (!result || !Number.isFinite(result.index)) {
    showFailure(new Error('assessment produced no index'));
    return;
  }

  const profile = state.profile;
  const at = Date.now();
  if (!Array.isArray(profile.assessments)) profile.assessments = [];
  profile.assessments.push({
    at,
    index: result.index,
    ci: result.ci && Number.isFinite(result.ci.lo) ? { lo: result.ci.lo, hi: result.ci.hi } : null,
    theta: result.theta,
    se: result.se,
    itemsUsed: result.itemsUsed,
    reliability: result.reliability,
    byFamily: result.byFamily || {}
  });
  profile.currentIndex = result.index;
  profile.peakIndex = Number.isFinite(profile.peakIndex)
    ? Math.max(profile.peakIndex, result.index)
    : result.index;
  const tier = safeCall(() => tierFor(result.index), -1);
  /* `tierFor` returns -1 below the qualification floor; the stored tier stays a valid
   * curriculum tier and the elimination is carried by `status`. */
  profile.tier = Number.isFinite(tier) && tier >= 0 ? tier : 0;
  profile.status = result.eliminated === true ? 'eliminated' : 'qualified';
  profile.updatedAt = at;
  touchStreak(profile, at);

  try { saveProfile(profile); } catch (err) { /* store falls back to memory itself */ }
  cacheResult(result);
  emit(state.ctx, 'profile:changed', profile);
  emit(state.ctx, 'assessment:complete', result);

  navigate(state.ctx, result.eliminated === true ? '#/eliminated' : '#/result');
}

/* --------------------------------------------------------------- demo gating */

function showDemoGate(family, done) {
  const state = live;
  if (!state) return;
  const reduced = prefersReducedMotion(state.profile);
  clearNode(state.overlay);
  state.overlay.style.display = 'block';
  state.overlay.setAttribute('style',
    'display:flex;flex-direction:column;gap:var(--sp-4,16px);align-items:center;' +
    'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
    'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px)');
  state.bar.style.visibility = 'hidden';
  clearNode(state.stageInner);
  clearNode(state.optionsHost);

  const host = h('div', { style: 'width:100%;max-width:420px;min-height:200px;' +
    'display:flex;align-items:center;justify-content:center' });
  const stop = mountDemo(host, family, reduced);
  cleanup.push(stop);

  const proceed = actionButton({
    iconKey: 'play', glyph: GLYPH.play, labelKey: ['test.beginFormat', 'start'],
    fallbackLabel: 'Continue', variant: 'primary', large: true,
    onClick: () => {
      stop();
      done();
    }
  });

  state.overlay.appendChild(host);
  state.overlay.appendChild(proceed);
  const raf = requestAnimationFrame(() => {
    if (live && live.keyboardInput && proceed.focus) proceed.focus();
  });
  state.rafIds.push(raf);
}

/* -------------------------------------------------------------------- meter */

function updateMeter() {
  const state = live;
  if (!state) return;
  state.meter.set(completion(readState()));
}

/**
 * An abstract completion figure: how far the session is through the work it has left,
 * blending item count with the precision actually reached. It is deliberately not a
 * fraction of items and never exposes a count or a score.
 */
function completion(s) {
  const maxItems = numberOr(CAT_DEFAULTS && CAT_DEFAULTS.maxItems, 40);
  const minItems = numberOr(CAT_DEFAULTS && CAT_DEFAULTS.minItems, 18);
  const targetSE = numberOr(CAT_DEFAULTS && CAT_DEFAULTS.targetSE, 0.3);
  const n = numberOr(s.n, 0);
  const byCount = maxItems > 0 ? n / maxItems : 0;
  let byPrecision = 0;
  if (n >= Math.min(minItems, 4) && Number.isFinite(s.se) && s.se > 0) {
    const startSE = 1.2;
    const now = 1 / s.se;
    const from = 1 / startSE;
    const to = 1 / targetSE;
    byPrecision = to > from ? (now - from) / (to - from) : 0;
  }
  const raw = Math.max(byCount, byPrecision * 0.96);
  return Math.max(0.02, Math.min(0.985, raw));
}

function abstractMeter(ariaLabel) {
  const track = h('div', {
    class: 'meter',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '2',
    'aria-label': ariaLabel,
    style: 'flex:1 1 auto;height:12px;border-radius:999px;overflow:hidden;' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  const fill = h('div', {
    style: 'height:100%;width:2%;background:var(--accent,#5b8cff);' +
      'transition:width .35s ease;border-radius:999px'
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

/* ------------------------------------------------------------------- leaving */

function onLeaveRequest() {
  const state = live;
  if (!state || state.finished) return;
  if (state.leaving) return;
  state.leaving = true;
  const panel = h('div', {
    'data-leave-confirm': 'true',
    role: 'group',
    'aria-label': tx('test.leaveConfirm', 'Leave without finishing?'),
    style: 'display:flex;gap:var(--sp-3,12px);align-items:center;justify-content:center;' +
      'padding:var(--sp-3,12px);border:1px solid var(--warn,#d9a441);' +
      'border-radius:var(--r-md,12px);background:var(--bg-elev,#16171c)'
  });
  panel.appendChild(h('span', {
    style: 'color:var(--fg-dim,#a9abb6);font-size:14px',
    text: tx('test.leaveNote', 'Leaving now discards this session; nothing is recorded.')
  }));
  panel.appendChild(actionButton({
    iconKey: 'leave', glyph: GLYPH.leave, labelKey: 'test.leaveConfirmYes',
    fallbackLabel: 'Leave', onClick: () => navigate(state.ctx, '#/')
  }));
  panel.appendChild(actionButton({
    iconKey: 'play', glyph: GLYPH.play, labelKey: 'test.leaveCancel',
    fallbackLabel: 'Stay', variant: 'primary',
    onClick: () => {
      panel.remove();
      state.leaving = false;
    }
  }));
  state.root.insertBefore(panel, state.root.firstChild);
  const focusable = firstFocusable(panel);
  if (focusable) focusable.focus();
}

function showFailure(err) {
  const state = live;
  if (!state) return;
  state.finished = true;
  clearNode(state.optionsHost);
  clearNode(state.stageInner);
  state.overlay.style.display = 'none';
  const box = h('div', {
    role: 'alert',
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);align-items:center;' +
      'padding:var(--sp-5,20px);border:1px solid var(--bad,#e0605e);border-radius:var(--r-md,12px)'
  });
  const mark = h('div', { style: 'width:44px;height:44px' });
  mountSvg(mark,
    '<svg viewBox="0 0 44 44" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="22" cy="22" r="18" fill="none" stroke="var(--bad,#e0605e)" stroke-width="4" ' +
    'stroke-dasharray="6 6"/></svg>');
  box.appendChild(mark);
  box.appendChild(h('p', {
    style: 'margin:0;color:var(--fg-dim,#a9abb6);text-align:center;font-size:14px',
    text: tx('test.error', 'The session could not continue. Nothing was recorded.') +
      (err && err.message ? ' (' + err.message + ')' : '')
  }));
  box.appendChild(actionButton({
    iconKey: 'leave', glyph: GLYPH.leave, labelKey: ['test.errorHome', 'home'],
    fallbackLabel: 'Back', variant: 'primary',
    onClick: () => navigate(state.ctx, '#/')
  }));
  state.optionsHost.appendChild(box);
}

/* ------------------------------------------------------------------- helpers */

function readState() {
  const state = live;
  if (!state || !state.session) return {};
  try {
    const s = state.session.state;
    return (typeof s === 'function' ? s.call(state.session) : s) || {};
  } catch (err) {
    return {};
  }
}

function cacheResult(result) {
  try {
    window.sessionStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
  } catch (err) {
    /* Private mode or a full quota: the result screen falls back to the profile. */
  }
}

function touchStreak(profile, at) {
  const day = Math.floor(startOfDay(at) / 86400000);
  const streak = profile.streak && typeof profile.streak === 'object'
    ? profile.streak
    : { days: 0, lastDay: null };
  if (streak.lastDay === day) {
    streak.days = Math.max(1, Math.floor(Number(streak.days) || 0));
  } else if (streak.lastDay === day - 1) {
    streak.days = Math.max(1, Math.floor(Number(streak.days) || 0)) + 1;
  } else {
    streak.days = 1;
  }
  streak.lastDay = day;
  profile.streak = streak;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function freshRng(ctx) {
  const tag = 'assessment:' + Date.now();
  if (ctx && ctx.rng && typeof ctx.rng.fork === 'function') {
    const forked = safeCall(() => ctx.rng.fork(tag), null);
    if (forked && typeof forked.next === 'function') return forked;
  }
  return makeRng(tag);
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
    const cell = h('button', {
      type: 'button',
      class: 'option',
      'data-option-id': opt && opt.id ? opt.id : 'o' + i,
      'aria-label': tx('test.option', 'Option') + ' ' + (i + 1),
      style: 'padding:8px;cursor:pointer;background:var(--bg-elev,#16171c);' +
        'border:2px solid var(--line,#2a2c34);border-radius:var(--r-md,12px);' +
        'aspect-ratio:1/1;display:flex;align-items:center;justify-content:center'
    });
    const inner = h('div', { style: 'width:100%;height:100%' });
    mountSvg(inner, opt && typeof opt.svg === 'string' ? opt.svg : '');
    cell.appendChild(inner);
    cell.addEventListener('click', () => onPickId(opt && opt.id ? opt.id : 'o' + i));
    grid.appendChild(cell);
  });
  return grid;
}

/* Arrow-key movement between options. If the shared component already handles the
 * key it will have called preventDefault, and this handler stands down. */
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

function firstFocusable(root) {
  const list = focusables(root);
  return list.length ? list[0] : null;
}

function mountDemo(host, kindId, reduced) {
  let demo = null;
  try { demo = demoFor(kindId); } catch (err) { demo = null; }
  const frames = demo && Array.isArray(demo.frames) ? demo.frames.filter((f) => f && f.svg) : [];
  if (!frames.length) {
    host.appendChild(h('p', {
      style: 'color:var(--fg-dim,#a9abb6);font-size:14px;text-align:center;margin:0',
      text: tx('test.noDemo', 'Find the piece that completes the pattern.')
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
  const step = () => {
    if (stopped) return;
    const frame = frames[i % frames.length];
    mountSvg(view, frame.svg);
    const ms = Math.max(150, Math.min(4000, Number(frame.ms) || 700));
    i += 1;
    if (demo.loop === false && i >= frames.length) return;
    timer = setTimeout(step, ms);
  };
  step();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
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
  } catch (err) { /* component drift must not blank the screen */ }
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

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
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

function numberOr(a, b) {
  return typeof a === 'number' && Number.isFinite(a) ? a : b;
}
