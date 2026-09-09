/* main.js — application bootstrap (contract 25): load the profile, apply settings to
   the document, build the router over the nine screens, install the elimination gate
   as a navigation guard, and wire the shared event bus. */

import { loadProfile, saveProfile, defaultProfile } from './core/store.js';
import { bus } from './core/events.js';
import { makeRng, hashSeed } from './core/rng.js';
import { setLang } from './ui/i18n.js';
import { createRouter, go, currentRoute } from './ui/router.js';

import * as homeScreen from './ui/screens/home.js';
import * as testScreen from './ui/screens/test.js';
import * as resultScreen from './ui/screens/result.js';
import * as eliminatedScreen from './ui/screens/eliminated.js';
import * as trainScreen from './ui/screens/train.js';
import * as drillScreen from './ui/screens/drill.js';
import * as progressScreen from './ui/screens/progress.js';
import * as settingsScreen from './ui/screens/settings.js';
import * as aboutScreen from './ui/screens/about.js';

const ROUTES = {
  '/': homeScreen,
  '/test': testScreen,
  '/result': resultScreen,
  '/eliminated': eliminatedScreen,
  '/train': trainScreen,
  '/train/:levelId': drillScreen,
  '/progress': progressScreen,
  '/settings': settingsScreen,
  '/about': aboutScreen,
};

/* Routes an eliminated candidate may still reach. The elimination is a hard
   product rule: everything else redirects to the elimination screen. */
const ELIMINATED_ALLOW = new Set(['/eliminated', '/about']);

/* Routes a candidate who has not been measured yet may not reach. */
const TRAINING_ROUTES = new Set(['/train', '/train/:levelId']);

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

const NAV_EVENTS = ['navigate', 'nav:go', 'route:go'];
const PROFILE_EVENTS = [
  'profile:changed',
  'profile:updated',
  'profile:save',
  'profile:saved',
  'assessment:complete',
  'drill:complete',
  'level:complete',
];
const SETTINGS_EVENTS = ['settings:changed', 'settings:updated'];
const RELOAD_EVENTS = ['profile:reset', 'profile:imported', 'profile:import'];

let profile = null;
let router = null;
let rng = null;
let motionQuery = null;

/* ---------------------------------------------------------------- state */

function warn(message, err) {
  if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
    console.warn(`[app] ${message}`, err);
  }
}

function readProfile() {
  try {
    const loaded = loadProfile();
    if (loaded && typeof loaded === 'object') return loaded;
  } catch (err) {
    warn('loadProfile failed, using a fresh profile', err);
  }
  try {
    return defaultProfile();
  } catch (err) {
    warn('defaultProfile failed', err);
    return { version: 1, status: 'new', assessments: [], settings: {} };
  }
}

/** Adopt a strictly newer copy from storage (another tab, or a screen that saved). */
function syncProfile() {
  try {
    const stored = loadProfile();
    if (stored && typeof stored === 'object') {
      const storedAt = Number(stored.updatedAt) || 0;
      const localAt = Number(profile && profile.updatedAt) || 0;
      if (!profile || storedAt > localAt) profile = stored;
    }
  } catch (err) {
    warn('profile sync failed', err);
  }
  return profile;
}

function persist() {
  if (!profile) return;
  try {
    /* Never write over a strictly newer copy: a screen may have reset, imported or
       saved the profile without telling the bus. Adopt that copy instead. */
    const stored = loadProfile();
    const storedAt = Number(stored && stored.updatedAt) || 0;
    const localAt = Number(profile.updatedAt) || 0;
    if (stored && storedAt > localAt) {
      profile = stored;
      return;
    }
    profile.updatedAt = Date.now();
    saveProfile(profile);
  } catch (err) {
    warn('saveProfile failed', err);
  }
}

function extractProfile(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.profile && typeof payload.profile === 'object') return payload.profile;
  if ('status' in payload && 'settings' in payload) return payload;
  if ('version' in payload && 'assessments' in payload) return payload;
  return null;
}

/* ------------------------------------------------------------- settings */

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (err) {
    return false;
  }
}

function applySettings(p) {
  const settings = (p && p.settings) || {};
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  /* theme: an explicit choice wins over the OS in both directions */
  const theme = settings.theme;
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');

  const reduced = settings.reducedMotion === true || prefersReducedMotion();
  body.classList.toggle('reduced-motion', reduced);
  root.dataset.reducedMotion = reduced ? '1' : '0';

  const contrast = settings.highContrast === true;
  body.classList.toggle('high-contrast', contrast);
  root.dataset.highContrast = contrast ? '1' : '0';

  /* labels are an optional affordance: the UI is fully operable without them */
  const labels = settings.showLabels !== false;
  body.classList.toggle('labels-on', labels);
  body.classList.toggle('labels-off', !labels);
  root.dataset.labels = labels ? '1' : '0';

  const soundOn = settings.soundOn !== false;
  body.classList.toggle('sound-off', !soundOn);
  root.dataset.sound = soundOn ? 'on' : 'off';

  const lang = typeof settings.language === 'string' && settings.language ? settings.language : 'en';
  try {
    setLang(lang);
  } catch (err) {
    warn('setLang failed', err);
  }
  root.setAttribute('lang', lang);
  root.setAttribute('dir', RTL_LANGS.has(String(lang).slice(0, 2)) ? 'rtl' : 'ltr');
}

function watchMotionPreference() {
  try {
    if (!window.matchMedia) return;
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applySettings(profile);
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', onChange);
    } else if (typeof motionQuery.addListener === 'function') {
      motionQuery.addListener(onChange);
    }
  } catch (err) {
    warn('cannot observe prefers-reduced-motion', err);
  }
}

/* ------------------------------------------------------------------ gate */

function hasMeasurement(p) {
  if (!p) return false;
  if (Array.isArray(p.assessments) && p.assessments.length > 0) return true;
  return p.currentIndex !== null && p.currentIndex !== undefined;
}

/**
 * The elimination gate, installed as the router's beforeEach guard.
 * - status 'eliminated' may only reach #/eliminated and #/about.
 * - status 'new' may not reach #/train or #/train/:levelId, and cannot open a
 *   result that does not exist yet.
 */
function gate(to) {
  syncProfile();
  const status = profile && profile.status;
  const pattern = (to && (to.pattern || to.path)) || '/';

  if (status === 'eliminated') {
    return ELIMINATED_ALLOW.has(pattern) ? true : '/eliminated';
  }

  /* Past this point the candidate was NOT eliminated, so the rejection screen is
     not theirs to see. A stale hash, a shared link or a back button must never
     show someone an elimination they never received. */
  if (pattern === '/eliminated') return '/';

  if (status === 'new') {
    if (TRAINING_ROUTES.has(pattern)) return '/';
    if (pattern === '/result' && !hasMeasurement(profile)) return '/';
  }

  if (pattern === '/result' && !hasMeasurement(profile)) return '/';

  return true;
}

function enforceGate() {
  const route = currentRoute();
  if (!route) return;
  const verdict = gate(route);
  if (typeof verdict === 'string' && verdict !== route.path) go(verdict);
}

/* -------------------------------------------------------------- bus wiring */

function onNavigate(payload) {
  const path =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object'
      ? payload.path || payload.to || payload.route
      : null;
  if (typeof path === 'string' && path) go(path);
}

function onProfileEvent(payload) {
  const next = extractProfile(payload);
  if (next) profile = next;
  else syncProfile();
  persist();
  applySettings(profile);
  enforceGate();
}

function onSettingsEvent(payload) {
  const next = extractProfile(payload);
  if (next) profile = next;
  else if (payload && typeof payload === 'object' && profile) {
    const patch = payload.settings && typeof payload.settings === 'object' ? payload.settings : payload;
    profile.settings = Object.assign({}, profile.settings || {}, patch);
  }
  persist();
  applySettings(profile);
}

function onReloadEvent(payload) {
  const next = extractProfile(payload);
  profile = next || readProfile();
  applySettings(profile);
  if (router) router.refresh();
  enforceGate();
}

function wireBus() {
  if (!bus || typeof bus.on !== 'function') return;
  for (const type of NAV_EVENTS) bus.on(type, onNavigate);
  for (const type of PROFILE_EVENTS) bus.on(type, onProfileEvent);
  for (const type of SETTINGS_EVENTS) bus.on(type, onSettingsEvent);
  for (const type of RELOAD_EVENTS) bus.on(type, onReloadEvent);
}

/* ------------------------------------------------------------------ boot */

function bootError(outlet) {
  if (!outlet) return;
  while (outlet.firstChild) outlet.removeChild(outlet.firstChild);
  const panel = document.createElement('div');
  panel.className = 'boot-error';
  panel.setAttribute('role', 'alert');
  const holder = document.createElement('div');
  holder.className = 'icon';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '56');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', '24');
  ring.setAttribute('cy', '24');
  ring.setAttribute('r', '18');
  ring.setAttribute('stroke-dasharray', '7 6');
  svg.appendChild(ring);
  holder.appendChild(svg);
  panel.appendChild(holder);
  outlet.appendChild(panel);
}

function boot() {
  const outlet = document.getElementById('app');
  if (!outlet) {
    warn('no #app outlet in the document');
    return;
  }

  profile = readProfile();
  applySettings(profile);
  watchMotionPreference();

  /* One stream per app load: deterministic downstream, fresh across sessions so a
     retake is never the identical form. Wall-clock is read here, at the call site,
     never inside generation, IRT or CAT code. */
  let seed = 1;
  try {
    seed = hashSeed(`${(profile && profile.createdAt) || 0}:${Date.now()}`);
  } catch (err) {
    warn('hashSeed failed', err);
  }
  try {
    rng = makeRng(seed);
  } catch (err) {
    warn('makeRng failed', err);
    rng = null;
  }

  router = createRouter(ROUTES, outlet);
  router.setNotFound('/');
  router.setContext(() => ({ profile, bus, rng }));
  router.beforeEach(gate);
  router.afterEach((to) => {
    if (bus && typeof bus.emit === 'function') {
      try {
        bus.emit('route:changed', { path: to.path, pattern: to.pattern, params: to.params });
      } catch (err) {
        warn('route:changed listener threw', err);
      }
    }
  });

  wireBus();
  router.start();

  window.addEventListener('pagehide', persist);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('storage', (ev) => {
    if (!ev || (ev.key && ev.key.indexOf('eqgame.profile') !== 0)) return;
    syncProfile();
    applySettings(profile);
    enforceGate();
  });
}

try {
  boot();
} catch (err) {
  warn('boot failed', err);
  bootError(document.getElementById('app'));
}
