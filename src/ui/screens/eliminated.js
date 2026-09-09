/**
 * Screen: eliminated. States the outcome plainly and respectfully, shows the estimate
 * with its confidence band so the person can see exactly how the decision was made,
 * and offers the two honest paths: export the result, or start over from scratch.
 */

import { mountSvg, button, bell } from '../components.js';
import { icon } from '../icons.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { confidenceInterval, FLOOR_INDEX, CEILING_INDEX } from '../../core/scale.js';
import { exportProfile, resetProfile, defaultProfile } from '../../core/store.js';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:760px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px);' +
  'display:flex;flex-direction:column;gap:var(--sp-4,16px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const GLYPH = {
  export: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="3" width="14" height="12" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="8" y="18" width="8" height="3" rx="1.5" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M12 3 A9 9 0 1 1 4.2 16.5" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"/><circle cx="12" cy="3" r="2.4" fill="currentColor"/></svg>',
  about: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<rect x="10.6" y="10" width="2.8" height="7" rx="1.2" fill="currentColor"/>' +
    '<circle cx="12" cy="7" r="1.5" fill="currentColor"/></svg>',
  keep: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/></svg>'
};

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-eliminated', style: SCREEN_STYLE });

  const last = lastAssessment(profile);
  const index = firstNumber(profile.currentIndex, last && last.index);
  const ci = resolveCi(last);

  root.appendChild(outcomeCard(index, ci));
  root.appendChild(explainCard(index, ci));
  root.appendChild(pathsCard(ctx, profile));
  root.appendChild(footerRow(ctx));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
}

/* -------------------------------------------------------------------- cards */

function outcomeCard(index, ci) {
  const card = h('section', { style: CARD_STYLE });

  /* A neutral mark: an open ring with the qualification arc unclosed. No cross,
   * no cultural glyph, nothing that reads as a judgement of the person. */
  const mark = h('div', {
    'aria-hidden': 'true',
    style: 'width:64px;height:64px;margin:0 auto'
  });
  mountSvg(mark,
    '<svg viewBox="0 0 64 64" width="100%" height="100%">' +
    '<circle cx="32" cy="32" r="26" fill="none" stroke="var(--line-strong,#3a3d47)" ' +
    'stroke-width="5"/>' +
    '<path d="M32 6 A26 26 0 0 1 58 32" fill="none" stroke="var(--fg-dim,#a9abb6)" ' +
    'stroke-width="5" stroke-linecap="round"/></svg>');
  card.appendChild(mark);

  const value = h('div', {
    style: 'text-align:center;font-family:var(--mono,ui-monospace,monospace);' +
      'font-size:clamp(40px,11vw,64px);line-height:1;font-weight:600',
    text: Number.isFinite(index) ? String(index) : '—'
  });
  card.appendChild(value);

  if (ci) {
    card.appendChild(h('div', {
      style: 'text-align:center;font-family:var(--mono,ui-monospace,monospace);' +
        'font-size:16px;color:var(--fg-dim,#a9abb6)',
      text: ci.lo + ' – ' + ci.hi
    }));
    card.appendChild(h('div', {
      style: 'text-align:center;font-size:13px;color:var(--fg-mute,#7b7d88)',
      text: tx('eliminated.ciLabel', '90% confidence band')
    }));
  }

  card.appendChild(h('p', {
    style: 'margin:0;text-align:center;font-size:16px;line-height:1.6',
    text: tx('eliminated.headline',
      'The measured index came out below 100, the qualification threshold, so training ' +
      'is not open on this profile.')
  }));
  return card;
}

function explainCard(index, ci) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('eliminated.howTitle', 'How the decision was made')
  }));
  card.appendChild(thresholdStrip(index, ci));
  if (Number.isFinite(index) && ci) {
    card.appendChild(compose(
      () => bell({ index, ci }),
      () => h('div', { style: 'height:1px;background:var(--line,#2a2c34)' })
    ));
  }
  const body = h('div', {
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);font-size:14px;' +
      'line-height:1.6;color:var(--fg-dim,#a9abb6)'
  });
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('eliminated.how1',
      'The test kept going while the band still straddled 100, so the cut was not made ' +
      'on a fast guess. It stopped once the estimate was precise enough to land on one ' +
      'side of the line, or once it ran out of puzzles.')
  }));
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('eliminated.how2',
      'The band above is the real result. A single sitting carries error, and a value ' +
      'close to the line could fall on the other side of it another day. This decision ' +
      'reflects one session, not a fixed fact about you.')
  }));
  card.appendChild(body);
  return card;
}

/* The reporting range with the qualification line marked, the band drawn, and the
 * estimate placed on it — the decision is visible without reading anything. */
function thresholdStrip(index, ci) {
  const lo = 40;
  const hi = CEILING_INDEX;
  const span = Math.max(1, hi - lo);
  const at = (v) => ((Math.max(lo, Math.min(hi, v)) - lo) / span) * 100;
  const wrap = h('div', {
    role: 'img',
    'aria-label': tx('eliminated.strip', 'Estimate against the qualification threshold') +
      ': ' + (Number.isFinite(index) ? index : '—') + ' / ' + FLOOR_INDEX,
    style: 'position:relative;height:40px;border-radius:var(--r-sm,8px);' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  wrap.appendChild(h('div', {
    style: 'position:absolute;top:0;bottom:0;left:0;width:' + at(FLOOR_INDEX).toFixed(2) + '%;' +
      'background:repeating-linear-gradient(45deg,transparent,transparent 6px,' +
      'var(--line,#2a2c34) 6px,var(--line,#2a2c34) 12px);border-radius:var(--r-sm,8px) 0 0 var(--r-sm,8px)'
  }));
  wrap.appendChild(h('div', {
    style: 'position:absolute;top:-4px;bottom:-4px;width:3px;background:var(--warn,#d9a441);' +
      'left:calc(' + at(FLOOR_INDEX).toFixed(2) + '% - 1.5px)'
  }));
  if (ci) {
    wrap.appendChild(h('div', {
      style: 'position:absolute;top:10px;bottom:10px;border-radius:999px;' +
        'background:var(--fg-mute,#7b7d88);opacity:.7;left:' + at(ci.lo).toFixed(2) + '%;' +
        'width:' + Math.max(1.5, at(ci.hi) - at(ci.lo)).toFixed(2) + '%'
    }));
  }
  if (Number.isFinite(index)) {
    wrap.appendChild(h('div', {
      style: 'position:absolute;top:-4px;bottom:-4px;width:4px;border-radius:2px;' +
        'background:var(--fg,#e9e9ee);left:calc(' + at(index).toFixed(2) + '% - 2px)'
    }));
  }
  return wrap;
}

function pathsCard(ctx, profile) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('eliminated.pathsTitle', 'What you can do from here')
  }));

  const status = h('p', {
    role: 'status',
    'aria-live': 'polite',
    style: 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);min-height:18px'
  });

  const exportBtn = actionButton({
    iconKey: 'export', glyph: GLYPH.export, labelKey: ['eliminated.export', 'export'],
    fallbackLabel: 'Export result', variant: 'primary',
    onClick: () => doExport(status)
  });

  const resetBtn = actionButton({
    iconKey: 'reset', glyph: GLYPH.reset, labelKey: ['eliminated.reset', 'reset'],
    fallbackLabel: 'Start over', onClick: () => confirmReset(ctx, card, status)
  });

  card.appendChild(h('div', { style: ROW_STYLE }, [exportBtn, resetBtn]));
  card.appendChild(h('p', {
    style: 'margin:0;font-size:14px;line-height:1.6;color:var(--fg-dim,#a9abb6)',
    text: tx('eliminated.paths',
      'Export keeps a copy of this measurement, including the band. Starting over erases ' +
      'this profile completely and lets you take the test again from nothing — choose it ' +
      'if you believe the session did not reflect you.')
  }));
  card.appendChild(status);
  return card;
}

function confirmReset(ctx, host, status) {
  if (host.querySelector('[data-reset-confirm]')) return;
  const panel = h('div', {
    'data-reset-confirm': 'true',
    role: 'group',
    'aria-label': tx('eliminated.resetConfirmTitle', 'Erase this profile?'),
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);' +
      'padding:var(--sp-4,16px);border:1px solid var(--bad,#e0605e);' +
      'border-radius:var(--r-md,12px);background:var(--bg-elev-2,#1d1f26)'
  });
  panel.appendChild(h('p', {
    style: 'margin:0;font-size:14px;line-height:1.6',
    text: tx('eliminated.resetConfirm',
      'This erases the result, the history and every setting on this device. It cannot ' +
      'be undone. Export first if you want to keep a copy.')
  }));
  const row = h('div', { style: ROW_STYLE });
  row.appendChild(actionButton({
    iconKey: 'reset', glyph: GLYPH.reset, labelKey: 'eliminated.resetYes',
    fallbackLabel: 'Erase and start over',
    onClick: () => doReset(ctx, status)
  }));
  row.appendChild(actionButton({
    iconKey: 'keep', glyph: GLYPH.keep, labelKey: 'eliminated.resetNo',
    fallbackLabel: 'Keep it', variant: 'primary',
    onClick: () => panel.remove()
  }));
  panel.appendChild(row);
  host.appendChild(panel);
  const focusable = panel.querySelector('button');
  if (focusable) focusable.focus();
}

function doExport(status) {
  let json = null;
  try {
    json = exportProfile();
  } catch (err) {
    json = null;
  }
  if (typeof json !== 'string' || !json.length) {
    status.textContent = tx('eliminated.exportFail', 'The export could not be produced.');
    return;
  }
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'fluid-index-result.json', style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    cleanup.push(() => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      if (a.parentNode) a.remove();
    });
    status.textContent = tx('eliminated.exportOk', 'A copy has been saved to your device.');
  } catch (err) {
    status.textContent = tx('eliminated.exportFail', 'The export could not be produced.');
  }
}

function doReset(ctx, status) {
  let fresh = safeCall(() => resetProfile(), null);
  if (!fresh || typeof fresh !== 'object') fresh = safeCall(() => defaultProfile(), null);
  const profile = ctx && ctx.profile;
  if (fresh && profile && typeof profile === 'object' && profile !== fresh) {
    for (const key of Object.keys(profile)) delete profile[key];
    Object.assign(profile, fresh);
  }
  emit(ctx, 'profile:changed', fresh || null);
  status.textContent = tx('eliminated.resetDone', 'The profile has been erased.');
  navigate(ctx, '#/');
  /* A reload guarantees every module re-reads the fresh profile rather than a stale
   * reference held from before the reset. */
  try { window.location.reload(); } catch (err) { /* navigation already happened */ }
}

function footerRow(ctx) {
  const row = h('nav', { style: ROW_STYLE + ';justify-content:center' });
  row.appendChild(actionButton({
    iconKey: 'about', glyph: GLYPH.about, labelKey: ['nav.about', 'about'],
    fallbackLabel: 'How this works', onClick: () => navigate(ctx, '#/about')
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

function resolveCi(assessment) {
  if (!assessment) return null;
  const ci = assessment.ci;
  if (ci && Number.isFinite(ci.lo) && Number.isFinite(ci.hi)) return { lo: ci.lo, hi: ci.hi };
  if (Number.isFinite(assessment.theta) && Number.isFinite(assessment.se)) {
    const built = safeCall(() => confidenceInterval(assessment.theta, assessment.se, 0.9), null);
    if (built && Number.isFinite(built.lo) && Number.isFinite(built.hi)) return built;
  }
  return null;
}

function lastAssessment(profile) {
  const list = profile && Array.isArray(profile.assessments) ? profile.assessments : [];
  return list.length ? list[list.length - 1] : null;
}

function firstNumber(a, b) {
  if (typeof a === 'number' && Number.isFinite(a)) return a;
  if (typeof b === 'number' && Number.isFinite(b)) return b;
  return null;
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
      'padding:10px 16px;border-radius:var(--r-md,12px);font:inherit;font-size:15px;' +
      'border:1px solid ' + (primary ? 'var(--accent,#5b8cff)' : 'var(--line-strong,#3a3d47)') + ';' +
      'background:' + (primary ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)') + ';' +
      'color:' + (primary ? 'var(--bg,#0e0f13)' : 'var(--fg,#e9e9ee)') + ';'
  });
  if (spec.glyph || spec.iconKey) btn.appendChild(iconEl(spec.iconKey, 20, spec.glyph));
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
