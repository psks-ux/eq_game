/**
 * Screen: sign in. The one screen in the app that cannot be wordless — an email
 * field and a password field have to say which is which — so it keeps its labels
 * even when chrome labels are switched off, and it stays entirely optional. Every
 * path out of here also leads back into the app without an account.
 *
 * Signing in does not replace the local profile: it merges with it, using the
 * same join-semilattice as sync-code linking, so work done as a guest survives.
 */

import { button } from '../components.js';
import { go as routerGo } from '../router.js';
import { adoptInto } from '../syncCard.js';
import {
  authAvailable, loadSession, session, isSignedIn, withPassword,
  startGoogle, signOut, onAuthChange
} from '../../core/auth.js';
import { syncNow, isLinked } from '../../core/sync.js';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:520px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px);' +
  'display:flex;flex-direction:column;gap:var(--sp-4,16px)';

const FIELD_STYLE =
  'width:100%;box-sizing:border-box;padding:11px 12px;font:inherit;font-size:15px;' +
  'color:var(--fg,#e9e9ee);background:var(--bg-elev-2,#1d1f26);' +
  'border:1px solid var(--line,#2a2c34);border-radius:var(--r-md,10px)';

const LABEL_STYLE =
  'display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--fg-mute,#7b7d88)';

const NOTE_STYLE = 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);line-height:1.55';
const TITLE_STYLE = 'margin:0;font-size:20px;font-weight:600;letter-spacing:-0.01em';
const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

/* Wordmark-free, geometry only: the app never uses cultural symbols in its own
   chrome, and a provider logo is not ours to redraw. */
const GOOGLE_GLYPH =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 12 H20" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 4 A8 8 0 0 1 12 20" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

let cleanup = [];
let mode = 'signin';

export function render(ctx) {
  destroy();
  /* Always open on sign-in. Carrying the register/sign-in toggle across mounts
     would land a returning visitor on a registration form they did not ask for. */
  mode = 'signin';
  const root = h('main', { class: 'screen screen-signin', style: SCREEN_STYLE });
  const host = h('div');
  root.appendChild(host);

  const paint = () => {
    host.textContent = '';
    host.appendChild(panel(ctx, paint));
  };
  paint();

  const off = onAuthChange(paint);
  cleanup.push(off);

  /* The session is authoritative and cheap to re-check; the first paint above
     uses whatever is already known so the screen never flashes empty. */
  loadSession(true).catch(() => {});
  return root;
}

export function destroy() {
  for (const fn of cleanup.splice(0)) {
    try {
      fn();
    } catch (err) {
      /* Nothing here should be able to block the next screen from mounting. */
    }
  }
}

/* ----------------------------------------------------------------- panels */

function panel(ctx, repaint) {
  if (!authAvailable()) return offlinePanel(ctx);
  const state = session();
  if (!state.loaded) return pendingPanel();
  if (state.signedIn) return signedInPanel(ctx, state);
  if (!state.providers.password && !state.providers.google) return unconfiguredPanel(ctx);
  return formPanel(ctx, state, repaint);
}

function pendingPanel() {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h1', { style: TITLE_STYLE, text: 'Sign in' }));
  card.appendChild(h('p', { style: NOTE_STYLE, text: 'Checking your session…' }));
  return card;
}

function offlinePanel(ctx) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h1', { style: TITLE_STYLE, text: 'Sign in' }));
  card.appendChild(h('p', {
    style: NOTE_STYLE,
    text: 'This copy runs entirely offline, so there is no account to sign in to. '
      + 'Your profile is stored on this device and everything works without one.'
  }));
  card.appendChild(backRow(ctx, 'Continue'));
  return card;
}

function unconfiguredPanel(ctx) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h1', { style: TITLE_STYLE, text: 'Sign in' }));
  card.appendChild(h('p', {
    style: NOTE_STYLE,
    text: 'Accounts are not configured on this deployment. You can still carry a '
      + 'profile between devices with a sync code in Settings.'
  }));
  const row = h('div', { style: ROW_STYLE });
  row.appendChild(button({
    label: 'Open settings',
    onClick: () => navigate(ctx, '#/settings')
  }));
  row.appendChild(skipButton(ctx, 'Continue'));
  card.appendChild(row);
  return card;
}

function signedInPanel(ctx, state) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h1', { style: TITLE_STYLE, text: 'Signed in' }));

  const who = (state.user && state.user.email) || 'your account';
  card.appendChild(h('p', {
    style: NOTE_STYLE,
    text: `Your progress syncs to ${who}${state.user && state.user.viaGoogle ? ' (via Google)' : ''}.`
  }));

  const status = h('p', { style: NOTE_STYLE });
  card.appendChild(status);

  const row = h('div', { style: ROW_STYLE });
  const syncBtn = button({
    label: 'Sync now',
    variant: 'primary',
    onClick: async () => {
      syncBtn.update({ disabled: true, label: 'Syncing…' });
      status.textContent = '';
      const res = await syncNow({ profile: ctx && ctx.profile });
      syncBtn.update({ disabled: false, label: 'Sync now' });
      status.textContent = res && res.ok
        ? 'Profile synced.'
        : `Could not sync (${(res && res.reason) || 'unknown'}). Your local progress is untouched.`;
      if (res && res.ok && res.profile) adoptInto(ctx && ctx.profile, res.profile);
    }
  });
  row.appendChild(syncBtn);

  const outBtn = button({
    label: 'Sign out',
    onClick: async () => {
      outBtn.update({ disabled: true });
      await signOut();
      /* Local storage is deliberately left alone: signing out ends the session,
         it does not delete the work done on this device. */
      outBtn.update({ disabled: false });
    }
  });
  row.appendChild(outBtn);
  row.appendChild(skipButton(ctx, 'Back'));
  card.appendChild(row);
  return card;
}

function formPanel(ctx, state, repaint) {
  const registering = mode === 'register';
  const card = h('section', { style: CARD_STYLE });

  card.appendChild(h('h1', {
    style: TITLE_STYLE,
    text: registering ? 'Create an account' : 'Sign in'
  }));
  card.appendChild(h('p', {
    style: NOTE_STYLE,
    text: 'Recommended, not required. An account keeps your measurement and your '
      + 'training progress across devices. You can play without one.'
  }));

  if (state.providers.google) {
    const g = button({
      label: 'Continue with Google',
      variant: 'primary',
      block: true,
      onClick: () => startGoogle(nextRoute(ctx))
    });
    g.insertBefore(glyphSpan(GOOGLE_GLYPH), g.firstChild);
    card.appendChild(g);
    card.appendChild(divider());
  }

  if (!state.providers.password) {
    card.appendChild(backRow(ctx, 'Continue without an account'));
    return card;
  }

  const form = h('form', { style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px)' });

  const email = h('input', {
    style: FIELD_STYLE, type: 'email', name: 'email', autocomplete: 'email',
    required: true, placeholder: 'you@example.com'
  });
  const password = h('input', {
    style: FIELD_STYLE, type: 'password', name: 'password',
    autocomplete: registering ? 'new-password' : 'current-password',
    required: true, minlength: registering ? 10 : 1,
    placeholder: registering ? 'At least 10 characters' : ''
  });

  form.appendChild(labelled('Email', email));
  form.appendChild(labelled('Password', password));

  const message = h('p', { style: `${NOTE_STYLE};min-height:1.2em`, role: 'status' });
  const submit = button({
    label: registering ? 'Create account' : 'Sign in',
    variant: 'primary',
    block: true,
    type: 'submit'
  });
  form.appendChild(submit);
  form.appendChild(message);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.style.color = 'var(--fg-mute,#7b7d88)';
    message.textContent = registering ? 'Creating your account…' : 'Signing in…';
    submit.update({ disabled: true });

    const res = await withPassword(mode, email.value, password.value);
    submit.update({ disabled: false });

    if (!res.ok) {
      message.style.color = 'var(--bad,#e2686b)';
      message.textContent = res.message || 'That did not work. Try again.';
      return;
    }
    password.value = '';
    message.style.color = 'var(--fg-mute,#7b7d88)';
    message.textContent = 'Merging your profile…';
    await mergeAndLeave(ctx, message);
  });
  card.appendChild(form);

  const toggle = h('div', { style: ROW_STYLE });
  toggle.appendChild(button({
    label: registering ? 'I already have an account' : 'Create an account instead',
    onClick: () => {
      mode = registering ? 'signin' : 'register';
      repaint();
    }
  }));
  toggle.appendChild(skipButton(ctx, 'Skip for now'));
  card.appendChild(toggle);

  card.appendChild(h('p', {
    style: NOTE_STYLE,
    text: isLinked()
      ? 'This device also has a sync code. Once you are signed in, your account is used instead.'
      : 'Prefer no account at all? Settings has a sync code that carries your profile with no email.'
  }));

  return card;
}

/* ------------------------------------------------------------------ parts */

/**
 * Push the local profile up and adopt whatever comes back, so signing in on a
 * device that has already trained keeps that work instead of overwriting it.
 * A failed sync is not a failed sign-in: local storage is still the truth.
 */
async function mergeAndLeave(ctx, message) {
  try {
    const res = await syncNow({ profile: ctx && ctx.profile });
    if (res && res.ok && res.profile) adoptInto(ctx && ctx.profile, res.profile);
  } catch (err) {
    /* Deliberately swallowed; the next sync will carry the same data. */
  }
  if (message) message.textContent = 'Signed in.';
  navigate(ctx, nextRoute(ctx));
}

/**
 * Where to go after signing in: `#/signin?next=%23/test` sends someone back to
 * what they were about to do. Only same-document hash routes are honoured, and
 * never back to this screen, which would loop.
 */
function nextRoute(ctx) {
  const raw = ctx && ctx.query && ctx.query.next;
  if (typeof raw !== 'string' || !raw.startsWith('#/')) return '#/';
  if (raw.startsWith('#/signin')) return '#/';
  return raw;
}

function labelled(text, field) {
  const wrap = h('label', { style: LABEL_STYLE });
  wrap.appendChild(h('span', { text }));
  wrap.appendChild(field);
  return wrap;
}

function divider() {
  const wrap = h('div', {
    style: 'display:flex;align-items:center;gap:var(--sp-3,12px);color:var(--fg-mute,#7b7d88);font-size:12px'
  });
  const line = () => h('span', { style: 'flex:1;height:1px;background:var(--line,#2a2c34)' });
  wrap.appendChild(line());
  wrap.appendChild(h('span', { text: 'or' }));
  wrap.appendChild(line());
  return wrap;
}

function glyphSpan(svg) {
  const span = h('span', {
    class: 'icon btn__icon',
    style: 'width:20px;height:20px;display:inline-flex',
    'aria-hidden': 'true'
  });
  span.innerHTML = svg;
  return span;
}

function skipButton(ctx, label) {
  return button({ label, onClick: () => navigate(ctx, nextRoute(ctx)) });
}

function backRow(ctx, label) {
  const row = h('div', { style: ROW_STYLE });
  row.appendChild(skipButton(ctx, label));
  return row;
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

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = String(value);
      else if (key === 'style') node.setAttribute('style', String(value));
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const kid of [].concat(kids === undefined || kids === null ? [] : kids)) {
    if (!kid) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

export default { render, destroy };
