/* icons.js — geometric-only UI chrome icons (contract 20).
   No letters, digits, arrows-as-glyphs, check marks, crosses or cultural glyphs.
   Left/right triangles are used for BACK/FORWARD navigation chrome only — never
   inside an item, option or demo. */

const NS = 'http://www.w3.org/2000/svg';

/* Every body is drawn in a 24x24 box. Elements with class="solid" are filled with
   currentColor; everything else is stroked with currentColor at --ui-stroke. */
const BODIES = {
  /* transport ------------------------------------------------------------ */
  play: '<path class="solid" d="M8.5 4.8 20 12 8.5 19.2Z"/>',
  pause: '<path class="solid" d="M7.5 5h3.4v14H7.5zM13.1 5h3.4v14h-3.4z"/>',
  stop: '<rect class="solid" x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',

  /* navigation ----------------------------------------------------------- */
  back: '<path d="M15.2 4.8 6.4 12l8.8 7.2Z"/>',
  forward: '<path d="M8.8 4.8 17.6 12l-8.8 7.2Z"/>',
  close: '<path d="M4.8 8.4 12 17.2l7.2-8.8Z"/>',
  home:
    '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/>' +
    '<rect class="solid" x="9.4" y="9.4" width="5.2" height="5.2" rx="1.2"/>',

  /* sections ------------------------------------------------------------- */
  train:
    '<path d="M12 2.9 19.8 7.4v9.2L12 21.1 4.2 16.6V7.4Z"/>' +
    '<path d="M12 7.6 15.9 9.9v4.2L12 16.4 8.1 14.1V9.9Z"/>',
  chart: '<path d="M4.5 19.4h15"/><path d="M8 19.4v-6.2M12 19.4V9.2M16 19.4V5.6"/>',
  gear:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M18 12h3M16.24 16.24l2.12 2.12M12 18v3M7.76 16.24 5.64 18.36' +
    'M6 12H3M7.76 7.76 5.64 5.64M12 6V3M16.24 7.76l2.12-2.12"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><circle class="solid" cx="12" cy="12" r="2.7"/>',
  help:
    '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.6"/>' +
    '<rect x="8.4" y="8.4" width="7.2" height="7.2" rx="1.4" stroke-dasharray="3 2.6"/>',

  /* task controls -------------------------------------------------------- */
  /* commit the chosen response: a sealed octagon */
  submit: '<path class="solid" d="M8.4 3.4h7.2l5 5v7.2l-5 5H8.4l-5-5V8.4Z"/>',
  /* leave this item unanswered: an empty slot, drawn as a broken ring */
  skip: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 4"/>',
  /* step one response back: the reset arc turned the other way */
  undo:
    '<path d="M8.4 5.77a7.2 7.2 0 1 0 7.2 0"/>' +
    '<path class="solid" d="M8.4 2.2 5 6.6l5.5.9Z"/>',
  /* retake the assessment: the play form inside a provisional ring */
  retest:
    '<circle cx="12" cy="12" r="9.2" stroke-dasharray="3.4 3"/>' +
    '<path class="solid" d="M9.6 7.4 17 12l-7.4 4.6Z"/>',
  /* the level map: linked nodes, never a chart of bars */
  map:
    '<path d="M5.8 17.6 12 9.4l6.2 4.4"/>' +
    '<circle class="solid" cx="5.8" cy="17.6" r="2.6"/>' +
    '<circle class="solid" cx="12" cy="9.4" r="2.6"/>' +
    '<circle class="solid" cx="18.2" cy="14" r="2.6"/>',
  /* keep what is already there: a held form, contained rather than released */
  keep:
    '<circle cx="12" cy="12" r="9"/>' +
    '<rect class="solid" x="8.2" y="8.2" width="7.6" height="7.6" rx="1.6"/>',

  /* state ---------------------------------------------------------------- */
  lock:
    '<rect x="4.8" y="10.6" width="14.4" height="9.4" rx="2.2"/>' +
    '<path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6"/>',
  unlock:
    '<rect x="4.8" y="10.6" width="14.4" height="9.4" rx="2.2"/>' +
    '<path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0"/>',
  star: '<circle cx="12" cy="12" r="9"/><path class="solid" d="M12 6.6 17.4 12 12 17.4 6.6 12Z"/>',
  starOutline: '<circle cx="12" cy="12" r="9"/><path d="M12 6.6 17.4 12 12 17.4 6.6 12Z"/>',
  success: '<circle class="solid" cx="12" cy="12" r="8"/>',
  fail: '<circle cx="12" cy="12" r="8"/>',

  /* data ----------------------------------------------------------------- */
  export:
    '<path d="M4.8 13.8v5.4h14.4v-5.4"/>' +
    '<path class="solid" d="M12 3.6 16.4 9.4H7.6Z"/>' +
    '<path d="M12 9.4v6.2"/>',
  import:
    '<path d="M4.8 13.8v5.4h14.4v-5.4"/>' +
    '<path class="solid" d="M12 15.6 7.6 9.8h8.8Z"/>' +
    '<path d="M12 9.8V3.6"/>',
  reset:
    '<path d="M15.6 5.77a7.2 7.2 0 1 1-7.2 0"/>' +
    '<path class="solid" d="M15.6 2.2 19 6.6l-5.5.9Z"/>',
  replay:
    '<path d="M15.6 5.77a7.2 7.2 0 1 1-7.2 0"/>' +
    '<path class="solid" d="M15.6 2.2 19 6.6l-5.5.9Z"/>' +
    '<path class="solid" d="M10.1 8.8 15.7 12l-5.6 3.2Z"/>',

  /* settings ------------------------------------------------------------- */
  soundOn:
    '<path class="solid" d="M3.6 9.4h3.6L11.6 5.4v13.2L7.2 14.6H3.6Z"/>' +
    '<path d="M14.8 9.2a4.2 4.2 0 0 1 0 5.6"/>' +
    '<path d="M17.6 6.6a8 8 0 0 1 0 10.8"/>',
  soundOff:
    '<path class="solid" d="M3.6 9.4h3.6L11.6 5.4v13.2L7.2 14.6H3.6Z"/>' +
    '<path d="M14.9 8.6 20.4 15.4"/>',
  contrast:
    '<circle cx="12" cy="12" r="8.2"/>' +
    '<path class="solid" d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z"/>',
  motion:
    '<circle class="solid" cx="5.2" cy="12" r="1.5"/>' +
    '<circle class="solid" cx="11.6" cy="12" r="2.5"/>' +
    '<circle class="solid" cx="19" cy="12" r="3.6"/>',
  language:
    '<circle cx="5.4" cy="12" r="3.1"/>' +
    '<rect x="9.6" y="8.9" width="6.2" height="6.2" rx="1.1"/>' +
    '<path d="M20 8.6 23.1 15.1h-6.2Z"/>',
};

/* Hyphenated and alternate spellings resolve to the same body. */
const ALIASES = {
  'sound-on': 'soundOn',
  'sound-off': 'soundOff',
  'star-outline': 'starOutline',
  soundon: 'soundOn',
  soundoff: 'soundOff',
  mute: 'soundOff',
  unmute: 'soundOn',
  audio: 'soundOn',
  next: 'forward',
  prev: 'back',
  previous: 'back',
  settings: 'gear',
  progress: 'chart',
  about: 'info',
  restart: 'reset',
  again: 'replay',
  retry: 'replay',
  /* "leave" always means "back out to the containing screen" */
  leave: 'home',
  exit: 'home',
  levels: 'map',
  demo: 'help',
  correct: 'success',
  right: 'success',
  incorrect: 'fail',
  wrong: 'fail',
  locked: 'lock',
  unlocked: 'unlock',
  theme: 'contrast',
  'reduced-motion': 'motion',
  reducedMotion: 'motion',
  'high-contrast': 'contrast',
  highContrast: 'contrast',
  lang: 'language',
  labels: 'language',
  download: 'export',
  upload: 'import',
  start: 'play',
  test: 'play',
};

function bodyFor(key) {
  if (typeof key !== 'string') return '';
  if (Object.prototype.hasOwnProperty.call(BODIES, key)) return BODIES[key];
  const alias = Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : null;
  if (alias && Object.prototype.hasOwnProperty.call(BODIES, alias)) return BODIES[alias];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALIASES, lower)) return BODIES[ALIASES[lower]] || '';
  return '';
}

/**
 * A standalone SVG string for one icon. Never throws.
 * An unknown key yields the EMPTY STRING, not an empty `<svg>`: callers keep their
 * own geometric fallback glyph and test it with `if (markup) ... else fallback`.
 * Returning a valid-but-blank `<svg>` here would satisfy that test and silently
 * render an invisible control, which breaks the zero-reading rule (contract 1.4).
 */
export function icon(key, size = 24) {
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 24;
  const body = bodyFor(key);
  if (!body) return '';
  return (
    `<svg xmlns="${NS}" viewBox="0 0 24 24" width="${px}" height="${px}" ` +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    body +
    '</svg>'
  );
}

/** Every icon as a ready-to-mount SVG string, keyed by name (plus aliases). */
export const ICONS = Object.freeze(
  (() => {
    const out = {};
    for (const key of Object.keys(BODIES)) out[key] = icon(key, 24);
    for (const key of Object.keys(ALIASES)) out[key] = icon(key, 24);
    return out;
  })()
);
