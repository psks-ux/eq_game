/**
 * Settings card for cross-device sync. Self-contained so the settings screen only
 * has to append it. Degrades to an explanatory note wherever sync cannot run
 * (the standalone file, file://, no network), because linking is always optional:
 * the app is fully usable having never seen a sync code.
 */

import { button } from './components.js';
import { t, labelsEnabled } from './i18n.js';
import {
  syncAvailable, isLinked, getCode, lastSyncAt, createLink, linkTo, unlink,
  syncNow, formatCode, normaliseCode
} from '../core/sync.js';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-4,16px);' +
  'display:flex;flex-direction:column;gap:var(--sp-3,12px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const CODE_STYLE =
  'font-family:var(--mono,ui-monospace,monospace);font-size:16px;letter-spacing:0.08em;' +
  'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-md,10px);padding:10px 12px;user-select:all;word-break:break-all';

const NOTE_STYLE = 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);line-height:1.5';

function tx(key, fallback) {
  if (!labelsEnabled()) return '';
  try {
    const s = t(key);
    return s || fallback;
  } catch (err) {
    return fallback;
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
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const kid of [].concat(kids === undefined || kids === null ? [] : kids)) {
    if (!kid) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

/**
 * Replace the contents of the live profile object rather than swapping the
 * reference. main.js holds this same object and flushes it on pagehide, so
 * handing it a new object would let the stale one overwrite the merged profile.
 */
function adoptInto(target, merged) {
  if (!target || !merged) return;
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) delete target[key];
  }
  for (const key of Object.keys(merged)) target[key] = merged[key];
}

function relativeTime(ms) {
  if (!ms) return tx('sync.never', 'never');
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return tx('sync.justNow', 'just now');
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const REASONS = {
  offline: 'No connection. Your progress is saved on this device and will sync later.',
  timeout: 'The server did not answer in time. Nothing was lost; try again.',
  unconfigured: 'Sync is not configured on this deployment.',
  unavailable: 'Sync needs the hosted app; this copy runs offline only.',
  not_linked: 'This device is not linked yet.',
  bad_code: 'That code is not valid.',
  too_large: 'This profile is too large to sync.',
  server_error: 'The server refused the request. Your local progress is untouched.',
  bad_response: 'The server sent something unexpected. Your local progress is untouched.'
};

export function syncCard(ctx, profile, status) {
  const card = h('section', { style: CARD_STYLE });
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px)' });

  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('sync.title', 'Sync across devices')
  }));
  card.appendChild(body);

  const say = (msg) => { if (status) status.textContent = msg || ''; };

  async function runSync(label) {
    say(label);
    const res = await syncNow({ profile });
    if (res.ok) {
      adoptInto(profile, res.profile);
      if (ctx && ctx.bus && typeof ctx.bus.emit === 'function') {
        try { ctx.bus.emit('profile:changed', { source: 'sync' }); } catch (err) { /* non-fatal */ }
      }
      say(tx('sync.done', 'Synced.'));
    } else {
      say(REASONS[res.reason] || 'Sync did not complete. Your local progress is untouched.');
    }
    refresh();
    return res;
  }

  function unavailableView() {
    body.appendChild(h('p', {
      style: NOTE_STYLE,
      text: 'This copy runs without a server, so it keeps your profile on this device only. ' +
        'Open the hosted version to link a second device.'
    }));
  }

  function unlinkedView() {
    body.appendChild(h('p', {
      style: NOTE_STYLE,
      text: 'Your profile lives on this device. Create a code to carry it to another ' +
        'device, or enter a code you already have. No email, no password, no personal data.'
    }));

    const actions = h('div', { style: ROW_STYLE });

    actions.appendChild(button({
      icon: 'export',
      label: tx('sync.create', 'Create a code'),
      variant: 'primary',
      onClick: async () => {
        const code = createLink();
        say(`Code created: ${formatCode(code)}`);
        await runSync(tx('sync.uploading', 'Uploading this profile...'));
      }
    }));

    const input = h('input', {
      type: 'text',
      inputmode: 'latin',
      autocapitalize: 'characters',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Sync code from your other device',
      placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX',
      style: CODE_STYLE + ';flex:1 1 260px;min-width:0'
    });

    actions.appendChild(input);
    actions.appendChild(button({
      icon: 'import',
      label: tx('sync.link', 'Link'),
      onClick: async () => {
        const code = normaliseCode(input.value);
        if (!code) { say('That code is not valid. Check for a missing character.'); return; }
        const res = linkTo(code);
        if (!res.ok) { say('That code is not valid.'); return; }
        await runSync(tx('sync.merging', 'Merging with your other device...'));
      }
    }));

    body.appendChild(actions);
  }

  function linkedView() {
    const code = getCode();

    body.appendChild(h('p', {
      style: NOTE_STYLE,
      text: 'Enter this code on another device to share one profile. Anyone with the ' +
        'code can open your profile, so treat it like a key.'
    }));

    const codeBox = h('div', { style: CODE_STYLE, text: formatCode(code) });
    codeBox.setAttribute('role', 'textbox');
    codeBox.setAttribute('aria-readonly', 'true');
    codeBox.setAttribute('aria-label', 'Your sync code');
    body.appendChild(codeBox);

    const actions = h('div', { style: ROW_STYLE });

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      actions.appendChild(button({
        icon: 'export',
        label: tx('sync.copy', 'Copy code'),
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(formatCode(code));
            say('Code copied.');
          } catch (err) {
            say('Could not copy. Select the code and copy it manually.');
          }
        }
      }));
    }

    actions.appendChild(button({
      icon: 'replay',
      label: tx('sync.now', 'Sync now'),
      variant: 'primary',
      onClick: () => runSync(tx('sync.syncing', 'Syncing...'))
    }));

    actions.appendChild(button({
      icon: 'reset',
      label: tx('sync.unlink', 'Unlink this device'),
      onClick: () => {
        unlink();
        say('This device is no longer linked. Your profile stays here, unchanged.');
        refresh();
      }
    }));

    body.appendChild(actions);
    body.appendChild(h('p', {
      style: NOTE_STYLE,
      text: `Last synced: ${relativeTime(lastSyncAt())}`
    }));
  }

  function refresh() {
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!syncAvailable()) unavailableView();
    else if (isLinked()) linkedView();
    else unlinkedView();
  }

  refresh();
  return card;
}
