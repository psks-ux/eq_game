/**
 * Screen: settings. Language, optional text labels, theme, contrast, motion and sound,
 * plus profile export, import and a destructive reset behind an explicit confirmation.
 */

import { mountSvg, button } from '../components.js';
import { icon } from '../icons.js';
import { t, labelsEnabled, LANGS, setLang, getLang } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { syncCard } from '../syncCard.js';
import { resetSigninPrompt } from '../signinPrompt.js';
import {
  authAvailable, loadSession, session, authConfigured, signOut, onAuthChange
} from '../../core/auth.js';
import { isLinked } from '../../core/sync.js';
import {
  saveProfile, exportProfile, importProfile, resetProfile, loadProfile, defaultProfile
} from '../../core/store.js';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-4,16px);' +
  'padding:var(--sp-5,20px);max-width:760px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-4,16px);' +
  'display:flex;flex-direction:column;gap:var(--sp-3,12px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const NOTE_STYLE = 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);line-height:1.55';

const GLYPH = {
  /* A door with the panel open, and the same door with it shut. Geometry only:
     no padlock, no arrow, no glyph that reads differently across cultures. */
  signin: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="3" width="10" height="18" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><circle cx="11" cy="12" r="1.4" fill="currentColor"/>' +
    '<rect x="16" y="10.6" width="6" height="2.8" rx="1.4" fill="currentColor"/></svg>',
  signout: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="3" width="10" height="18" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><circle cx="11" cy="12" r="1.4" fill="currentColor"/>' +
    '<rect x="16" y="10.6" width="6" height="2.8" rx="1.4" fill="currentColor" opacity="0.35"/>' +
    '<rect x="17.6" y="6" width="2.8" height="12" rx="1.4" fill="currentColor"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>',
  export: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="3" width="14" height="12" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="8" y="18" width="8" height="3" rx="1.5" fill="currentColor"/></svg>',
  import: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="9" width="14" height="12" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="8" y="3" width="8" height="3" rx="1.5" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M12 3 A9 9 0 1 1 4.2 16.5" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"/><circle cx="12" cy="3" r="2.4" fill="currentColor"/></svg>',
  keep: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/></svg>',
  labels: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="9" width="24" height="3" rx="1.5" fill="currentColor"/>' +
    '<rect x="4" y="15" width="18" height="3" rx="1.5" fill="currentColor"/>' +
    '<rect x="4" y="21" width="21" height="3" rx="1.5" fill="currentColor"/></svg>',
  contrast: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
    '<path d="M16 4 a12 12 0 0 1 0 24 z" fill="currentColor"/></svg>',
  motion: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="7" cy="16" r="4" fill="currentColor"/>' +
    '<circle cx="16" cy="16" r="4" fill="currentColor" opacity=".6"/>' +
    '<circle cx="25" cy="16" r="4" fill="currentColor" opacity=".3"/></svg>',
  sound: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="5" y="12" width="6" height="8" rx="2" fill="currentColor"/>' +
    '<path d="M15 8 a10 10 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
    '<path d="M20 11 a6 6 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>'
};

const THEMES = ['system', 'dark', 'light'];

let cleanup = [];
let host = null;

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  if (!profile.settings || typeof profile.settings !== 'object') profile.settings = {};
  const root = h('main', { class: 'screen screen-settings', style: SCREEN_STYLE });
  host = { ctx, profile, root };

  applySettings(profile.settings);

  const status = h('p', {
    role: 'status',
    'aria-live': 'polite',
    style: 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);min-height:18px'
  });

  root.appendChild(languageCard(ctx, profile));
  root.appendChild(displayCard(ctx, profile));
  root.appendChild(accountCard(ctx));
  root.appendChild(syncCard(ctx, profile, status));
  root.appendChild(dataCard(ctx, profile, status));
  root.appendChild(status);
  root.appendChild(footerRow(ctx));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
  host = null;
}

/* -------------------------------------------------------------------- cards */

/**
 * Account state, and the only way back to the sign-in screen once someone is
 * already signed in. Hidden entirely where there is no backend to sign in to,
 * because an inert control is worse than no control.
 */
function accountCard(ctx) {
  const box = h('div');
  let stopped = false;

  const paint = () => {
    if (stopped) return;
    box.textContent = '';
    const state = session();
    const show = authAvailable() && (!state.loaded || state.signedIn || authConfigured());
    box.hidden = !show;
    if (!show) return;

    const card = h('section', { class: 'card', style: CARD_STYLE });
    card.appendChild(sectionTitle('settings.account', 'Account'));

    if (!state.loaded) {
      card.appendChild(h('p', { style: NOTE_STYLE, text: 'Checking your session…' }));
      box.appendChild(card);
      return;
    }

    if (state.signedIn) {
      const who = (state.user && state.user.email) || 'your account';
      card.appendChild(h('p', {
        style: NOTE_STYLE,
        text: `Signed in as ${who}. Your profile syncs to this account automatically.`
      }));
      const row = h('div', { style: ROW_STYLE });
      const out = actionButton({
        iconKey: 'signout', glyph: GLYPH.signout, labelKey: ['settings.signOut', 'sign out'],
        fallbackLabel: 'Sign out',
        onClick: async () => {
          out.disabled = true;
          await signOut();
          /* Offer the prompt again: this device is now anonymous, and that is
             exactly the state the prompt exists for. */
          resetSigninPrompt();
          out.disabled = false;
        }
      });
      row.appendChild(out);
      card.appendChild(row);
    } else {
      card.appendChild(h('p', {
        style: NOTE_STYLE,
        text: 'Not signed in. An account keeps your measurement and training levels '
          + 'across devices. Everything works without one.'
      }));
      const row = h('div', { style: ROW_STYLE });
      row.appendChild(actionButton({
        iconKey: 'signin', glyph: GLYPH.signin, labelKey: ['settings.signIn', 'sign in'],
        fallbackLabel: 'Sign in',
        onClick: () => navigate(ctx, '#/signin?next=%23/settings')
      }));
      card.appendChild(row);
    }
    box.appendChild(card);
  };

  paint();
  loadSession().catch(() => {});
  const off = onAuthChange(paint);
  cleanup.push(() => { stopped = true; off(); });
  return box;
}

function languageCard(ctx, profile) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(sectionTitle('settings.language', 'Language'));

  const langs = Array.isArray(LANGS) ? LANGS.filter((l) => l && l.code) : [];
  const current = safeCall(() => getLang(), null) ||
    profile.settings.language || (langs[0] && langs[0].code) || 'en';

  const select = h('select', {
    'aria-label': tx(['settings.language', 'language'], 'Language'),
    style: 'font:inherit;font-size:16px;padding:10px 12px;border-radius:var(--r-md,12px);' +
      'background:var(--bg-elev-2,#1d1f26);color:var(--fg,#e9e9ee);' +
      'border:1px solid var(--line-strong,#3a3d47);max-width:100%'
  });
  if (!langs.length) {
    select.appendChild(h('option', { value: 'en', text: 'English', selected: true }));
    select.setAttribute('disabled', '');
  }
  for (const lang of langs) {
    /* Language names are shown in their own script — the one place where text is the
     * meaning rather than a supplementary label. */
    const opt = h('option', { value: lang.code, text: lang.native || lang.code });
    if (lang.code === current) opt.setAttribute('selected', '');
    select.appendChild(opt);
  }
  const onChange = () => {
    const code = select.value;
    safeCall(() => setLang(code), null);
    profile.settings.language = code;
    persist(profile);
    rerender();
  };
  select.addEventListener('change', onChange);
  cleanup.push(() => select.removeEventListener('change', onChange));
  card.appendChild(select);

  card.appendChild(toggleRow({
    glyph: GLYPH.labels,
    labelKey: 'settings.showLabels',
    fallbackLabel: 'Show text labels',
    checked: profile.settings.showLabels !== false,
    onChange: (on) => {
      profile.settings.showLabels = on;
      persist(profile);
      rerender();
    }
  }));
  card.appendChild(h('p', {
    style: 'margin:0;font-size:13px;line-height:1.55;color:var(--fg-mute,#7b7d88)',
    text: tx('settings.labelsNote',
      'Text labels are optional everywhere. With them off, the app is driven entirely by ' +
      'shapes and demonstrations.')
  }));
  return card;
}

function displayCard(ctx, profile) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(sectionTitle('settings.display', 'Display'));
  card.appendChild(themeRow(profile));
  card.appendChild(toggleRow({
    glyph: GLYPH.contrast,
    labelKey: 'settings.highContrast',
    fallbackLabel: 'High contrast',
    checked: profile.settings.highContrast === true,
    onChange: (on) => {
      profile.settings.highContrast = on;
      applySettings(profile.settings);
      persist(profile);
    }
  }));
  card.appendChild(toggleRow({
    glyph: GLYPH.motion,
    labelKey: 'settings.reducedMotion',
    fallbackLabel: 'Reduce motion',
    checked: profile.settings.reducedMotion === true,
    onChange: (on) => {
      profile.settings.reducedMotion = on;
      applySettings(profile.settings);
      persist(profile);
    }
  }));
  card.appendChild(toggleRow({
    glyph: GLYPH.sound,
    labelKey: 'settings.sound',
    fallbackLabel: 'Sound',
    checked: profile.settings.soundOn === true,
    onChange: (on) => {
      profile.settings.soundOn = on;
      persist(profile);
    }
  }));
  card.appendChild(h('p', {
    style: 'margin:0;font-size:13px;line-height:1.55;color:var(--fg-mute,#7b7d88)',
    text: tx('settings.motionNote',
      'With motion reduced, every demonstration is shown as a still sequence instead of ' +
      'an animation, so nothing is lost.')
  }));
  return card;
}

function themeRow(profile) {
  const current = THEMES.indexOf(profile.settings.theme) === -1 ? 'system' : profile.settings.theme;
  const row = h('div', {
    role: 'radiogroup',
    'aria-label': tx('settings.theme', 'Theme'),
    style: ROW_STYLE
  });
  for (const theme of THEMES) {
    const on = theme === current;
    const label = tx(['settings.theme.' + theme, 'theme.' + theme],
      theme === 'system' ? 'Auto' : (theme === 'dark' ? 'Dark' : 'Light'));
    const btn = h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      title: label,
      style: 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 14px;' +
        'border-radius:var(--r-md,12px);font:inherit;font-size:14px;' +
        'background:var(--bg-elev-2,#1d1f26);color:var(--fg,#e9e9ee);' +
        'border:2px solid ' + (on ? 'var(--accent,#5b8cff)' : 'var(--line,#2a2c34)')
    });
    const swatch = h('span', { 'aria-hidden': 'true', style: 'width:22px;height:22px;display:block' });
    mountSvg(swatch, themeSwatch(theme));
    btn.appendChild(swatch);
    if (labelsOn()) btn.appendChild(h('span', { text: label }));
    btn.addEventListener('click', () => {
      profile.settings.theme = theme;
      applySettings(profile.settings);
      persist(profile);
      rerender();
    });
    row.appendChild(btn);
  }
  return row;
}

function themeSwatch(theme) {
  if (theme === 'dark') {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%">' +
      '<circle cx="12" cy="12" r="10" fill="#15161b" stroke="#3a3d47" stroke-width="2"/></svg>';
  }
  if (theme === 'light') {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%">' +
      '<circle cx="12" cy="12" r="10" fill="#f2f2f5" stroke="#c8c8d0" stroke-width="2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="100%" height="100%">' +
    '<circle cx="12" cy="12" r="10" fill="#f2f2f5" stroke="#8a8a95" stroke-width="2"/>' +
    '<path d="M12 2 a10 10 0 0 1 0 20 z" fill="#15161b"/></svg>';
}

function dataCard(ctx, profile, status) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(sectionTitle('settings.data', 'Your data'));

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'
  });
  const onFile = () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const outcome = safeCall(() => importProfile(text), null);
      if (outcome && outcome.ok) {
        const loaded = safeCall(() => loadProfile(), null);
        if (loaded && ctx && ctx.profile && loaded !== ctx.profile) {
          for (const key of Object.keys(ctx.profile)) delete ctx.profile[key];
          Object.assign(ctx.profile, loaded);
        }
        status.textContent = tx('settings.importOk', 'Profile imported.');
        emit(ctx, 'profile:changed', loaded || null);
        navigate(ctx, '#/');
        try { window.location.reload(); } catch (err) { /* already navigated */ }
      } else {
        status.textContent = tx('settings.importFail', 'That file could not be read as a profile.') +
          (outcome && outcome.error ? ' (' + outcome.error + ')' : '');
      }
      fileInput.value = '';
    };
    reader.onerror = () => {
      status.textContent = tx('settings.importFail', 'That file could not be read as a profile.');
      fileInput.value = '';
    };
    try {
      reader.readAsText(file);
    } catch (err) {
      status.textContent = tx('settings.importFail', 'That file could not be read as a profile.');
    }
  };
  fileInput.addEventListener('change', onFile);
  cleanup.push(() => fileInput.removeEventListener('change', onFile));

  const row = h('div', { style: ROW_STYLE });
  row.appendChild(actionButton({
    iconKey: 'export', glyph: GLYPH.export, labelKey: ['settings.export', 'export'],
    fallbackLabel: 'Export', onClick: () => doExport(status)
  }));
  row.appendChild(actionButton({
    iconKey: 'import', glyph: GLYPH.import, labelKey: ['settings.import', 'import'],
    fallbackLabel: 'Import', onClick: () => fileInput.click()
  }));
  card.appendChild(row);
  card.appendChild(fileInput);
  card.appendChild(h('p', {
    style: 'margin:0;font-size:13px;line-height:1.55;color:var(--fg-mute,#7b7d88)',
    /* Kept truthful against the sync card above: "device only" stops being
       accurate the moment a sync code is linked. */
    text: tx('settings.dataNote',
      isLinked()
        ? 'Your profile is stored on this device and on the sync server for your ' +
          'code. Export writes a single JSON file; importing one replaces what is here.'
        : 'Everything is stored on this device only. Export writes a single JSON file; ' +
          'importing one replaces what is here.')
  }));

  const dangerRow = h('div', { style: ROW_STYLE });
  dangerRow.appendChild(actionButton({
    iconKey: 'reset', glyph: GLYPH.reset, labelKey: ['settings.reset', 'reset'],
    fallbackLabel: 'Erase everything',
    onClick: () => openResetDialog(ctx, status)
  }));
  card.appendChild(dangerRow);
  return card;
}

function doExport(status) {
  const json = safeCall(() => exportProfile(), null);
  if (typeof json !== 'string' || !json.length) {
    status.textContent = tx('settings.exportFail', 'The export could not be produced.');
    return;
  }
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'fluid-profile.json', style: 'display:none' });
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
    status.textContent = tx('settings.exportOk', 'A copy has been saved to your device.');
  } catch (err) {
    status.textContent = tx('settings.exportFail', 'The export could not be produced.');
  }
}

/* A modal confirmation with a focus trap; the destructive path is never one click. */
function openResetDialog(ctx, status) {
  if (document.querySelector('[data-reset-dialog]')) return;
  const previouslyFocused = document.activeElement;

  const backdrop = h('div', {
    'data-reset-dialog': 'true',
    style: 'position:fixed;inset:0;z-index:80;display:flex;align-items:center;' +
      'justify-content:center;padding:20px;background:rgba(0,0,0,.62)'
  });
  const panel = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': tx('settings.resetTitle', 'Erase everything?'),
    style: 'max-width:420px;width:100%;display:flex;flex-direction:column;' +
      'gap:var(--sp-4,16px);padding:var(--sp-5,20px);border-radius:var(--r-lg,16px);' +
      'background:var(--bg-elev,#16171c);border:1px solid var(--bad,#e0605e)'
  });
  panel.appendChild(h('p', {
    style: 'margin:0;font-size:15px;line-height:1.6',
    text: tx('settings.resetBody',
      'This erases your measurement, your training history and every setting on this ' +
      'device. It cannot be undone.')
  }));
  const row = h('div', { style: ROW_STYLE + ';justify-content:flex-end' });
  const cancel = actionButton({
    iconKey: 'keep', glyph: GLYPH.keep, labelKey: 'settings.resetCancel',
    fallbackLabel: 'Keep it', variant: 'primary', onClick: () => close()
  });
  const confirm = actionButton({
    iconKey: 'reset', glyph: GLYPH.reset, labelKey: 'settings.resetConfirm',
    fallbackLabel: 'Erase',
    onClick: () => {
      close();
      doReset(ctx, status);
    }
  });
  row.appendChild(confirm);
  row.appendChild(cancel);
  panel.appendChild(row);
  backdrop.appendChild(panel);

  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = Array.prototype.slice.call(panel.querySelectorAll('button'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };
  const onBackdrop = (ev) => {
    if (ev.target === backdrop) close();
  };

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.removeEventListener('mousedown', onBackdrop);
    if (backdrop.parentNode) backdrop.remove();
    if (previouslyFocused && previouslyFocused.focus && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  }

  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', onBackdrop);
  document.body.appendChild(backdrop);
  cleanup.push(close);
  cancel.focus();
}

function doReset(ctx, status) {
  let fresh = safeCall(() => resetProfile(), null);
  if (!fresh || typeof fresh !== 'object') fresh = safeCall(() => defaultProfile(), null);
  const profile = ctx && ctx.profile;
  if (fresh && profile && typeof profile === 'object' && profile !== fresh) {
    for (const key of Object.keys(profile)) delete profile[key];
    Object.assign(profile, fresh);
  }
  status.textContent = tx('settings.resetDone', 'Everything has been erased.');
  emit(ctx, 'profile:changed', fresh || null);
  navigate(ctx, '#/');
  try { window.location.reload(); } catch (err) { /* already navigated */ }
}

function footerRow(ctx) {
  const row = h('nav', { style: ROW_STYLE + ';justify-content:center' });
  row.appendChild(actionButton({
    iconKey: 'home', glyph: GLYPH.home, labelKey: ['nav.home', 'home'],
    fallbackLabel: 'Home', onClick: () => navigate(ctx, '#/')
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

function toggleRow(spec) {
  const label = tx(spec.labelKey, spec.fallbackLabel);
  const row = h('div', {
    style: 'display:flex;align-items:center;gap:var(--sp-3,12px);justify-content:space-between'
  });
  const left = h('div', { style: 'display:flex;align-items:center;gap:10px;min-width:0' });
  const mark = h('span', { 'aria-hidden': 'true', style: 'width:24px;height:24px;flex:0 0 auto' });
  mountSvg(mark, spec.glyph);
  left.appendChild(mark);
  if (labelsOn()) {
    left.appendChild(h('span', { style: 'font-size:15px', text: label }));
  }
  row.appendChild(left);

  let on = spec.checked === true;
  const sw = h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': label,
    title: label,
    style: 'width:56px;height:32px;border-radius:999px;cursor:pointer;position:relative;' +
      'padding:0;flex:0 0 auto;border:2px solid var(--line-strong,#3a3d47);' +
      'background:' + (on ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)')
  });
  const knob = h('span', {
    'aria-hidden': 'true',
    style: 'position:absolute;top:3px;left:' + (on ? '27px' : '3px') + ';width:22px;height:22px;' +
      'border-radius:50%;background:var(--fg,#e9e9ee);transition:left .16s ease'
  });
  sw.appendChild(knob);
  sw.addEventListener('click', () => {
    on = !on;
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.style.background = on ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)';
    knob.style.left = on ? '27px' : '3px';
    if (typeof spec.onChange === 'function') spec.onChange(on);
  });
  row.appendChild(sw);
  return row;
}

/**
 * Settings are mirrored onto the document root so the stylesheet can react to them.
 * `theme` is not in the contracted settings shape; it is stored as an extra key and
 * applied here, which is harmless if the stylesheet only honours the media query.
 */
function applySettings(settings) {
  const el = document.documentElement;
  if (!el) return;
  const theme = THEMES.indexOf(settings.theme) === -1 ? 'system' : settings.theme;
  if (theme === 'system') {
    el.removeAttribute('data-theme');
    el.style.colorScheme = 'dark light';
  } else {
    el.setAttribute('data-theme', theme);
    el.style.colorScheme = theme;
  }
  if (settings.highContrast === true) el.setAttribute('data-contrast', 'high');
  else el.removeAttribute('data-contrast');
  if (settings.reducedMotion === true) el.setAttribute('data-motion', 'reduced');
  else el.removeAttribute('data-motion');
  el.setAttribute('data-labels', settings.showLabels === false ? 'off' : 'on');
}

function persist(profile) {
  profile.updatedAt = Date.now();
  try { saveProfile(profile); } catch (err) { /* store handles its own fallback */ }
  if (host) emit(host.ctx, 'settings:changed', profile.settings);
}

function rerender() {
  if (!host) return;
  const ctx = host.ctx;
  const root = host.root;
  const fresh = render(ctx);
  if (root.parentNode) root.replaceWith(fresh);
}

function sectionTitle(key, fallback) {
  return h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx(key, fallback)
  });
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
  btn.appendChild(iconEl(spec.iconKey, 20, spec.glyph));
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
