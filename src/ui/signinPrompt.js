/**
 * The soft sign-in prompt shown on the home screen. Recommended, never required:
 * it can be dismissed, dismissal is remembered on that device, and every path
 * through it leaves the app fully usable without an account.
 *
 * Returns `{ el, stop }` — `el` is a live host that repaints itself when the
 * session changes, `stop` unsubscribes it. Callers push `stop` into their own
 * teardown list.
 */

import { button } from './components.js';
import { go as routerGo } from './router.js';
import {
  authAvailable, loadSession, session, authConfigured, onAuthChange
} from '../core/auth.js';
import { isLinked } from '../core/sync.js';

const DISMISS_KEY = 'eqgame.signin.prompt.v1';

/* Dashed, unlike every other card: this one is an aside the reader may ignore,
   and the border says so before the words do. */
const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px dashed var(--line-strong,#3a3d47);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-4,16px);' +
  'display:flex;flex-direction:column;gap:var(--sp-3,12px)';

const TITLE_STYLE = 'margin:0;font-size:15px;font-weight:600';
const NOTE_STYLE = 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);line-height:1.55';
const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

function dismissed() {
  try {
    return globalThis.localStorage.getItem(DISMISS_KEY) === '1';
  } catch (err) {
    /* Blocked storage: show the prompt rather than hide it, since a device that
       cannot remember a dismissal also cannot remember a profile reliably. */
    return false;
  }
}

function dismiss() {
  try {
    globalThis.localStorage.setItem(DISMISS_KEY, '1');
  } catch (err) {
    /* The prompt still hides for this render; it just returns next time. */
  }
}

/** Clears the dismissal, so signing out offers the prompt again. */
export function resetSigninPrompt() {
  try {
    globalThis.localStorage.removeItem(DISMISS_KEY);
  } catch (err) {
    /* Nothing to do; the prompt simply stays hidden on this device. */
  }
}

export function shouldPrompt() {
  if (!authAvailable()) return false;
  const state = session();
  if (!state.loaded) return false;
  if (state.signedIn) return false;
  if (!authConfigured()) return false;
  return !dismissed();
}

export function signinPrompt(ctx, options) {
  const opts = options || {};
  const host = document.createElement('div');
  let stopped = false;

  const paint = () => {
    if (stopped) return;
    host.textContent = '';
    if (!shouldPrompt()) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.appendChild(card(ctx, opts, paint));
  };

  paint();
  /* Ask once; the listener below repaints when the answer arrives. */
  loadSession().catch(() => {});
  const off = onAuthChange(paint);

  return {
    el: host,
    stop() {
      stopped = true;
      off();
    }
  };
}

function card(ctx, opts, repaint) {
  const first = opts.tone === 'first';
  const box = document.createElement('section');
  box.setAttribute('style', CARD_STYLE);
  box.className = 'card signin-prompt';

  box.appendChild(el('h2', TITLE_STYLE, first
    ? 'Sign in before you begin'
    : 'Your progress lives only on this device'));

  box.appendChild(el('p', NOTE_STYLE, first
    ? 'Recommended, not required. Signing in keeps your measurement and your '
      + 'training levels if you clear this browser or switch to another device. '
      + 'You can start the assessment without it.'
    : 'Signing in keeps your measurement and your training levels across devices. '
      + 'Clearing this browser would otherwise erase them.'));

  const row = el('div', ROW_STYLE);
  row.appendChild(button({
    label: 'Sign in',
    variant: 'primary',
    onClick: () => navigate(ctx, `#/signin?next=${encodeURIComponent(hereOr(opts.next))}`)
  }));
  row.appendChild(button({
    label: 'Not now',
    onClick: () => {
      dismiss();
      repaint();
    }
  }));
  box.appendChild(row);

  if (isLinked()) {
    box.appendChild(el('p', NOTE_STYLE,
      'This device already has a sync code, which does the same job without an email.'));
  }

  return box;
}

function hereOr(next) {
  if (typeof next === 'string' && next.startsWith('#/')) return next;
  const hash = globalThis.location && globalThis.location.hash;
  return hash && hash.startsWith('#/') && !hash.startsWith('#/signin') ? hash : '#/';
}

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.setAttribute('style', style);
  if (text) node.textContent = text;
  return node;
}

function navigate(ctx, path) {
  const bus = ctx && ctx.bus;
  if (bus && typeof bus.emit === 'function') {
    try {
      bus.emit('navigate', { path });
      return;
    } catch (err) {
      /* Fall through to the router below. */
    }
  }
  try {
    routerGo(path);
  } catch (err) {
    if (globalThis.location) globalThis.location.hash = path;
  }
}
