/**
 * Screen: about. Explains the index, the adaptive test, the wordless design and the
 * confidence band in plain language plus wordless diagrams, and states honestly what
 * the evidence on cognitive training does and does not support. Reachable when
 * eliminated.
 */

import { mountSvg, button } from '../components.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { FLOOR_INDEX, CEILING_INDEX, IQ_MEAN, IQ_SD, BANDS } from '../../core/scale.js';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:780px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px);' +
  'display:flex;flex-direction:column;gap:var(--sp-4,16px)';

const TEXT_STYLE = 'margin:0;font-size:15px;line-height:1.65;color:var(--fg-dim,#a9abb6)';

const GLYPH = {
  home: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>'
};

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-about', style: SCREEN_STYLE });

  root.appendChild(section(
    'about.indexTitle', 'What the number means',
    diagram(bellDiagram(), 'about.indexDiagram',
      'A population curve: the middle of the curve is 100, and the reported range runs ' +
      'from there up to 200.', scaleLabels()),
    [
      ['about.index1',
        'The index is a deviation score, not a count of correct answers and not a ' +
        'percentage. It places your performance against a reference distribution whose ' +
        'middle is ' + IQ_MEAN + ' and whose spread is ' + IQ_SD + ' points. Scoring ' +
        IQ_MEAN + ' means you performed like the middle of that distribution.'],
      ['about.index2',
        'The reporting range here is ' + FLOOR_INDEX + ' to ' + CEILING_INDEX + '. ' +
        'Everything below ' + FLOOR_INDEX + ' is reported as a single outcome rather ' +
        'than a finer number, because this test is built to separate people above the ' +
        'line, not to rank people below it. Below ' + FLOOR_INDEX + ' the profile does ' +
        'not open training. That is a product rule, stated up front, not a claim about ' +
        'anyone’s potential.'],
      ['about.index3',
        'The range is divided into six tiers, which is all the tier markers elsewhere in ' +
        'the app mean: a coarse position inside that range.']
    ]
  ));

  root.appendChild(section(
    'about.adaptiveTitle', 'How the test chooses puzzles',
    diagram(adaptiveDiagram(), 'about.adaptiveDiagram',
      'Each answer moves the next puzzle up or down in difficulty, and the estimate ' +
      'settles into a narrow band.'),
    [
      ['about.adaptive1',
        'The test is adaptive. It starts near the middle, and after every answer it ' +
        're-estimates where you are and picks the next puzzle to be maximally ' +
        'informative at that point. A correct answer generally leads to a harder ' +
        'puzzle, an incorrect one to an easier puzzle.'],
      ['about.adaptive2',
        'That is why the test is short and why two people almost never see the same ' +
        'puzzles. It also means the puzzles should feel hard: an adaptive test aims at ' +
        'the difficulty where you are genuinely uncertain, so most people answer a ' +
        'substantial share of them wrong. That is the design working, not a bad sitting.'],
      ['about.adaptive3',
        'It stops when the estimate is precise enough, or when it runs out of puzzles. ' +
        'Near the qualification line it deliberately keeps going while the answer is ' +
        'still genuinely in doubt, so the decision is made on precision rather than speed.'],
      ['about.adaptive4',
        'You are never told whether an answer was right during the test. Feedback would ' +
        'change how you approach the next puzzle and would bias the measurement. During ' +
        'training the opposite is true: every trial gives immediate feedback, because ' +
        'that is how the learning happens.']
    ]
  ));

  root.appendChild(section(
    'about.wordlessTitle', 'Why there are no words or numbers',
    diagram(fairnessDiagram(), 'about.wordlessDiagram',
      'Different people, the same abstract shapes: nothing in a puzzle depends on a ' +
      'language or a school system.'),
    [
      ['about.wordless1',
        'Every puzzle is built from plain geometry: circles, squares, triangles, bars, ' +
        'fills and rotations. No letters, no digits, no mathematical symbols, no arrows, ' +
        'no cultural emblems, in any script.'],
      ['about.wordless2',
        'The reason is simple. A test that needs reading measures reading. A test that ' +
        'needs arithmetic measures schooling. Neither is what this is trying to measure, ' +
        'and both would hand an advantage to whoever happened to be taught in the ' +
        'language of the test.'],
      ['about.wordless3',
        'The rules behind the puzzles are perceptual and relational — things repeat, ' +
        'rotate, grow, mirror, combine or complete. Nothing requires taught mathematics ' +
        'and nothing hides behind a trick of wording. Instructions arrive as silent ' +
        'animated demonstrations, and the text labels you can switch off in settings are ' +
        'never needed to succeed.']
    ]
  ));

  root.appendChild(section(
    'about.bandTitle', 'What the band around your score means',
    diagram(bandDiagram(), 'about.bandDiagram',
      'The same person measured repeatedly lands at different points inside one band.'),
    [
      ['about.band1',
        'No test measures without error. The band shown with your index is a confidence ' +
        'interval: given how you answered and how much information the puzzles carried, ' +
        'it is the range in which your true standing most plausibly sits.'],
      ['about.band2',
        'A narrow band means the test had a lot to go on. A wide band means it did not, ' +
        'and the single number should be trusted correspondingly less. More puzzles ' +
        'narrow the band; they never remove it.'],
      ['about.band3',
        'This is why the band is shown everywhere the number is. Two results whose bands ' +
        'overlap are not meaningfully different, however different the two numbers look.']
    ]
  ));

  root.appendChild(section(
    'about.evidenceTitle', 'Does training raise fluid intelligence?',
    null,
    [
      ['about.evidence1',
        'Honestly: partly, and less than most training products imply.'],
      ['about.evidence2',
        'Near transfer is well established. Practise a working-memory task, a rotation ' +
        'task or a matrix task and you get reliably better at that task and at close ' +
        'relatives of it. Nobody serious disputes this.'],
      ['about.evidence3',
        'Far transfer — a durable gain in general fluid reasoning that shows up on ' +
        'untrained tests — is contested. Some studies find it, many well-controlled ' +
        'studies find little or none, and meta-analyses disagree with each other. Much ' +
        'of the apparent gain in the weaker studies is explained by familiarity with the ' +
        'test format and by expectancy effects rather than by a change in ability.'],
      ['about.evidence4',
        'This program is built around the conditions that the more optimistic evidence ' +
        'points to: varied tasks rather than one drill, difficulty that adapts to keep ' +
        'you at the edge of your capacity, and an emphasis on relational complexity ' +
        'rather than speed alone. That maximises the chance of transfer. It does not ' +
        'promise it.'],
      ['about.evidence5',
        'The re-test is the only honest check available inside the app, and it is a weak ' +
        'one: it uses puzzles you have not drilled, but you will still have grown ' +
        'familiar with the format. Read a rise smaller than your confidence band as ' +
        'nothing at all.']
    ]
  ));

  root.appendChild(footerRow(ctx, profile));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
}

/* ------------------------------------------------------------------ sections */

function section(titleKey, titleFallback, figure, paragraphs) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:18px;font-weight:600;color:var(--fg,#e9e9ee)',
    text: tx(titleKey, titleFallback)
  }));
  if (figure) card.appendChild(figure);
  for (const [key, fallback] of paragraphs) {
    card.appendChild(h('p', { style: TEXT_STYLE, text: tx(key, fallback) }));
  }
  return card;
}

function diagram(svg, captionKey, captionFallback, extra) {
  const wrap = h('figure', {
    style: 'margin:0;display:flex;flex-direction:column;gap:8px;' +
      'background:var(--bg-elev-2,#1d1f26);border-radius:var(--r-md,12px);' +
      'padding:var(--sp-4,16px)'
  });
  const box = h('div', {
    role: 'img',
    'aria-label': tx(captionKey, captionFallback),
    style: 'width:100%'
  });
  mountSvg(box, svg);
  wrap.appendChild(box);
  if (extra) wrap.appendChild(extra);
  wrap.appendChild(h('figcaption', {
    style: 'margin:0;font-size:13px;line-height:1.5;color:var(--fg-mute,#7b7d88)',
    text: tx(captionKey, captionFallback)
  }));
  return wrap;
}

/* ----------------------------------------------------------------- diagrams */

const SCALE_MARKS = [100, 130, 160, 200];

/**
 * Tick labels live in HTML rather than inside the SVG, so no SVG string produced
 * anywhere in these screens contains a text element.
 */
function scaleLabels() {
  const w = 640;
  const mid = w / 2;
  const scale = 46;
  const row = h('div', { 'aria-hidden': 'true', style: 'position:relative;height:18px' });
  for (const mark of SCALE_MARKS) {
    const x = mid + ((mark - IQ_MEAN) / IQ_SD) * scale;
    if (x > w - 10) continue;
    row.appendChild(h('span', {
      style: 'position:absolute;transform:translateX(-50%);left:' +
        ((x / w) * 100).toFixed(2) + '%;font-size:13px;color:var(--fg-mute,#7b7d88);' +
        'font-family:var(--mono,ui-monospace,monospace)',
      text: String(mark)
    }));
  }
  return row;
}

/* The reference distribution, the qualification line and the reported range. */
function bellDiagram() {
  const w = 640;
  const hgt = 220;
  const base = hgt - 42;
  const mid = w / 2;
  const scale = 46;               /* pixels per standard deviation */
  const peak = base - 132;
  const curve = (x) => {
    const z = (x - mid) / scale;
    return base - (base - peak) * Math.exp(-0.5 * z * z);
  };
  let d = 'M' + (mid - 4.4 * scale).toFixed(1) + ' ' + base.toFixed(1);
  for (let x = mid - 4.4 * scale; x <= mid + 4.4 * scale; x += 4) {
    d += ' L' + x.toFixed(1) + ' ' + curve(x).toFixed(1);
  }
  const leftFill = d + ' L' + mid.toFixed(1) + ' ' + base + ' Z';

  let ticks = '';
  for (const mark of SCALE_MARKS) {
    const z = (mark - IQ_MEAN) / IQ_SD;
    const x = mid + z * scale;
    if (x > w - 10) continue;
    ticks += '<line x1="' + x.toFixed(1) + '" y1="' + base + '" x2="' + x.toFixed(1) +
      '" y2="' + (base + 12) + '" stroke="var(--fg-mute,#7b7d88)" stroke-width="2"/>';
  }

  let tierBar = '';
  const bands = Array.isArray(BANDS) ? BANDS : [];
  bands.forEach((band, i) => {
    const lo = Number(band && band.min);
    const hi = Number(band && band.max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    const x1 = mid + ((lo - IQ_MEAN) / IQ_SD) * scale;
    const x2 = Math.min(w - 6, mid + ((hi - IQ_MEAN) / IQ_SD) * scale);
    tierBar += '<rect x="' + x1.toFixed(1) + '" y="' + (base + 34) + '" width="' +
      Math.max(2, x2 - x1).toFixed(1) + '" height="6" rx="3" ' +
      'fill="var(--accent,#5b8cff)" opacity="' + (0.35 + i * 0.11).toFixed(2) + '"/>';
  });

  return '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="auto" ' +
    'preserveAspectRatio="xMidYMid meet">' +
    '<path d="' + leftFill + '" fill="var(--line,#2a2c34)" opacity="0.75"/>' +
    '<path d="' + d + '" fill="none" stroke="var(--stim,#e6e6ea)" stroke-width="3"/>' +
    '<line x1="' + (mid - 4.6 * scale) + '" y1="' + base + '" x2="' + (w - 6) + '" y2="' + base +
    '" stroke="var(--line-strong,#3a3d47)" stroke-width="2"/>' +
    '<line x1="' + mid + '" y1="' + (peak - 12) + '" x2="' + mid + '" y2="' + (base + 12) +
    '" stroke="var(--warn,#d9a441)" stroke-width="3"/>' +
    ticks + tierBar + '</svg>';
}

/* Difficulty over successive puzzles: filled disc for a correct answer, open ring for
 * an incorrect one, with the estimate settling into a narrowing band. */
function adaptiveDiagram() {
  const w = 640;
  const hgt = 200;
  const steps = [
    { y: 110, correct: true },
    { y: 88, correct: true },
    { y: 66, correct: false },
    { y: 84, correct: true },
    { y: 70, correct: false },
    { y: 82, correct: true },
    { y: 74, correct: true },
    { y: 68, correct: false },
    { y: 76, correct: true },
    { y: 73, correct: true }
  ];
  const x0 = 54;
  const dx = (w - x0 - 90) / (steps.length - 1);
  let path = '';
  let dots = '';
  steps.forEach((s, i) => {
    const x = x0 + i * dx;
    path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + s.y + ' ';
    dots += s.correct
      ? '<circle cx="' + x.toFixed(1) + '" cy="' + s.y + '" r="8" fill="var(--accent,#5b8cff)"/>'
      : '<circle cx="' + x.toFixed(1) + '" cy="' + s.y + '" r="8" fill="none" ' +
        'stroke="var(--fg-mute,#7b7d88)" stroke-width="3"/>';
  });
  const bandY = 74;
  return '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="auto" ' +
    'preserveAspectRatio="xMidYMid meet">' +
    '<line x1="30" y1="20" x2="30" y2="160" stroke="var(--line-strong,#3a3d47)" stroke-width="2"/>' +
    '<line x1="30" y1="160" x2="' + (w - 20) + '" y2="160" ' +
    'stroke="var(--line-strong,#3a3d47)" stroke-width="2"/>' +
    '<rect x="' + (w - 78) + '" y="' + (bandY - 26) + '" width="30" height="52" rx="14" ' +
    'fill="var(--accent-dim,#33487f)" opacity="0.75"/>' +
    '<line x1="' + (w - 82) + '" y1="' + bandY + '" x2="' + (w - 42) + '" y2="' + bandY +
    '" stroke="var(--fg,#e9e9ee)" stroke-width="3"/>' +
    '<path d="' + path.trim() + '" fill="none" stroke="var(--line-strong,#3a3d47)" ' +
    'stroke-width="2.5"/>' + dots +
    '<rect x="16" y="24" width="8" height="26" rx="4" fill="var(--fg-mute,#7b7d88)"/>' +
    '<rect x="16" y="130" width="8" height="26" rx="4" fill="var(--fg-mute,#7b7d88)" ' +
    'opacity="0.45"/></svg>';
}

/* Three different people, one identical set of abstract shapes. */
function fairnessDiagram() {
  const w = 640;
  const hgt = 190;
  const people = [
    { cx: 70, cy: 45, color: '#0072B2' },
    { cx: 70, cy: 95, color: '#E69F00' },
    { cx: 70, cy: 145, color: '#009E73' }
  ];
  let lines = '';
  let discs = '';
  for (const p of people) {
    lines += '<line x1="' + (p.cx + 22) + '" y1="' + p.cy + '" x2="238" y2="95" ' +
      'stroke="' + p.color + '" stroke-width="3" opacity="0.7"/>';
    discs += '<circle cx="' + p.cx + '" cy="' + p.cy + '" r="18" fill="none" stroke="' +
      p.color + '" stroke-width="4"/>';
  }
  const shapes =
    '<g fill="none" stroke="var(--stim,#e6e6ea)" stroke-width="4">' +
    '<circle cx="330" cy="60" r="24"/>' +
    '<rect x="400" y="36" width="48" height="48"/>' +
    '<path d="M520 36 L546 84 L494 84 Z"/>' +
    '<path d="M306 110 h48 v48 h-48 Z" stroke-dasharray="7 7"/>' +
    '<path d="M424 110 L448 134 L424 158 L400 134 Z"/>' +
    '<path d="M520 110 a24 24 0 0 1 0 48 z"/>' +
    '</g>';
  return '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="auto" ' +
    'preserveAspectRatio="xMidYMid meet">' + lines + discs +
    '<rect x="264" y="18" width="330" height="158" rx="14" fill="none" ' +
    'stroke="var(--line,#2a2c34)" stroke-width="2"/>' + shapes + '</svg>';
}

/* One band; repeated sittings of the same person scatter inside it. */
function bandDiagram() {
  const w = 640;
  const hgt = 170;
  const cx = 300;
  const wide = 190;
  const narrow = 86;
  const scatter = [-64, -30, -8, 12, 44, 68, -46, 26];
  let dots = '';
  scatter.forEach((dxv, i) => {
    dots += '<circle cx="' + (cx + dxv) + '" cy="' + (46 + (i % 3) * 9) + '" r="5" ' +
      'fill="var(--fg-mute,#7b7d88)"/>';
  });
  return '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="auto" ' +
    'preserveAspectRatio="xMidYMid meet">' +
    '<rect x="' + (cx - wide / 2) + '" y="30" width="' + wide + '" height="46" rx="23" ' +
    'fill="var(--accent-dim,#33487f)" opacity="0.55"/>' + dots +
    '<line x1="' + cx + '" y1="22" x2="' + cx + '" y2="84" stroke="var(--fg,#e9e9ee)" ' +
    'stroke-width="4"/>' +
    '<rect x="' + (cx - narrow / 2) + '" y="106" width="' + narrow + '" height="34" rx="17" ' +
    'fill="var(--accent,#5b8cff)" opacity="0.65"/>' +
    '<line x1="' + cx + '" y1="100" x2="' + cx + '" y2="146" stroke="var(--fg,#e9e9ee)" ' +
    'stroke-width="4"/>' +
    '<circle cx="' + (cx + 190) + '" cy="53" r="9" fill="none" ' +
    'stroke="var(--fg-mute,#7b7d88)" stroke-width="3"/>' +
    '<circle cx="' + (cx + 190) + '" cy="123" r="9" fill="var(--accent,#5b8cff)"/>' +
    '</svg>';
}

/* -------------------------------------------------------------------- footer */

function footerRow(ctx, profile) {
  const row = h('nav', {
    style: 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center;justify-content:center'
  });
  const back = profile.status === 'eliminated' ? '#/eliminated' : '#/';
  row.appendChild(actionButton({
    iconKey: 'home', glyph: GLYPH.home, labelKey: ['nav.back', 'back'],
    fallbackLabel: 'Back', variant: 'primary',
    onClick: () => navigate(ctx, back)
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

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
  } catch (err) { /* component drift must not blank the page */ }
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

function iconEl(key, size, fallbackSvg) {
  const el = h('span', {
    'aria-hidden': 'true',
    style: 'display:inline-flex;align-items:center;justify-content:center;width:' +
      size + 'px;height:' + size + 'px;flex:0 0 auto'
  });
  let out = null;
  try { out = icon(key, size); } catch (err) { out = null; }
  if (out && out.nodeType === 1) el.appendChild(out);
  else if (typeof out === 'string' && out.trim().length) mountSvg(el, out);
  else if (fallbackSvg) mountSvg(el, fallbackSvg);
  return el;
}

function actionButton(spec) {
  const label = tx(spec.labelKey, spec.fallbackLabel);
  const node = compose(
    () => button({
      icon: spec.iconKey,
      label,
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
  btn.appendChild(iconEl(spec.iconKey, 20, spec.glyph));
  btn.appendChild(h('span', { text: label }));
  if (typeof spec.onClick === 'function') btn.addEventListener('click', spec.onClick);
  return btn;
}

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
}
