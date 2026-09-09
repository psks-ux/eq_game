/* router.js — hash router for the nine screens (contract 20).
   Supports route params (#/train/:levelId), beforeEach guards (main.js installs the
   elimination gate there), a not-found fallback to #/, and strict teardown: the
   previous screen's destroy() always runs before the next one mounts. */

const MAX_REDIRECTS = 8;

let activeRouter = null;
let activeRoute = Object.freeze({ path: '/', pattern: null, params: {}, query: {} });

/* ------------------------------------------------------------- utilities */

function normalisePath(path) {
  let p = typeof path === 'string' ? path.trim() : '/';
  if (p.startsWith('#')) p = p.slice(1);
  if (p === '' || p === '/') return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  // collapse duplicate slashes, drop a trailing slash
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function splitQuery(raw) {
  const hashIndex = raw.indexOf('?');
  if (hashIndex < 0) return { path: raw, query: {} };
  const path = raw.slice(0, hashIndex);
  const query = {};
  const search = raw.slice(hashIndex + 1);
  for (const part of search.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    try {
      query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch (err) {
      query[key] = value;
    }
  }
  return { path, query };
}

function readLocation() {
  const raw = typeof location !== 'undefined' && location.hash ? location.hash.slice(1) : '';
  const split = splitQuery(raw);
  return { path: normalisePath(split.path), query: split.query };
}

function segmentsOf(path) {
  return path === '/' ? [] : path.slice(1).split('/');
}

function compile(pattern) {
  const path = normalisePath(pattern);
  const segments = segmentsOf(path).map((seg) =>
    seg.startsWith(':') ? { param: seg.slice(1) } : { literal: seg }
  );
  return {
    path,
    segments,
    dynamic: segments.some((seg) => 'param' in seg),
  };
}

function matchRoute(entry, segs) {
  if (entry.segments.length !== segs.length) return null;
  const params = {};
  for (let i = 0; i < segs.length; i += 1) {
    const spec = entry.segments[i];
    const value = segs[i];
    if ('literal' in spec) {
      if (spec.literal !== value) return null;
    } else {
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch (err) {
        decoded = value;
      }
      if (decoded === '') return null;
      params[spec.param] = decoded;
    }
  }
  return params;
}

function toEntries(routes) {
  const out = [];
  const push = (path, screen) => {
    if (!path || !screen) return;
    const compiled = compile(path);
    out.push({ ...compiled, screen });
  };
  if (Array.isArray(routes)) {
    for (const item of routes) {
      if (!item) continue;
      push(item.path, item.screen || item.view || item.module || item.component || item);
    }
  } else if (routes && typeof routes === 'object') {
    for (const key of Object.keys(routes)) push(key, routes[key]);
  }
  // static patterns win over dynamic ones regardless of declaration order
  return out.sort((a, b) => Number(a.dynamic) - Number(b.dynamic));
}

function renderFn(screen) {
  if (!screen) return null;
  if (typeof screen === 'function') return screen;
  if (typeof screen.render === 'function') return screen.render.bind(screen);
  return null;
}

function destroyFn(screen) {
  if (!screen || typeof screen === 'function') return null;
  if (typeof screen.destroy === 'function') return screen.destroy.bind(screen);
  return null;
}

/* --------------------------------------------------------------- public */

/**
 * createRouter(routes, outletEl)
 * `routes` is a map of pattern -> screen module (or a [{ path, screen }] array).
 * A screen is either a function (ctx -> HTMLElement) or a module exporting
 * `render(ctx)` and optionally `destroy()`.
 */
export function createRouter(routes, outletEl) {
  const entries = toEntries(routes);
  const outlet = outletEl || null;
  const guards = [];
  const afters = [];

  let contextFn = null;
  let notFound = '/';
  let started = false;
  let navigating = false;
  let redirects = 0;
  let mounted = null; // { screen, el, route }

  function resolve(path, query) {
    const segs = segmentsOf(path);
    for (const entry of entries) {
      const params = matchRoute(entry, segs);
      if (params) {
        return { path, pattern: entry.path, params, query: query || {}, entry };
      }
    }
    return null;
  }

  function teardown() {
    if (!mounted) return;
    const { screen, el } = mounted;
    mounted = null;
    const destroy = destroyFn(screen);
    if (destroy) {
      try {
        destroy();
      } catch (err) {
        report('screen destroy failed', err);
      }
    }
    if (el) {
      if (typeof el.destroy === 'function') {
        try {
          el.destroy();
        } catch (err) {
          report('element destroy failed', err);
        }
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    if (outlet) {
      while (outlet.firstChild) outlet.removeChild(outlet.firstChild);
    }
  }

  function report(message, err) {
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error(`[router] ${message}`, err);
    }
  }

  function buildContext(route) {
    const base = { params: route.params, query: route.query, route, go };
    let extra = null;
    if (typeof contextFn === 'function') {
      try {
        extra = contextFn(route);
      } catch (err) {
        report('context builder failed', err);
      }
    } else if (contextFn && typeof contextFn === 'object') {
      extra = contextFn;
    }
    return Object.assign({}, extra || {}, base);
  }

  function replaceHash(path) {
    const target = `#${normalisePath(path)}`;
    if (typeof history !== 'undefined' && history && typeof history.replaceState === 'function') {
      history.replaceState(null, '', target);
    } else if (typeof location !== 'undefined') {
      location.hash = target;
    }
  }

  function runGuards(to, from) {
    for (const guard of guards.slice()) {
      let verdict;
      try {
        verdict = guard(to, from);
      } catch (err) {
        report('guard threw', err);
        verdict = undefined;
      }
      if (verdict === false) return { blocked: true };
      if (typeof verdict === 'string') return { redirect: verdict };
      if (verdict && typeof verdict === 'object' && typeof verdict.path === 'string') {
        return { redirect: verdict.path };
      }
    }
    return {};
  }

  function handle() {
    if (!started || navigating) return;
    navigating = true;
    try {
      const loc = readLocation();
      let route = resolve(loc.path, loc.query);

      if (!route) {
        const fallback = normalisePath(notFound);
        if (fallback !== loc.path && resolve(fallback, {})) {
          navigating = false;
          replaceHash(fallback);
          handle();
          return;
        }
        teardown();
        activeRoute = Object.freeze({ path: loc.path, pattern: null, params: {}, query: loc.query });
        return;
      }

      const from = activeRoute;
      const verdict = runGuards(
        { path: route.path, pattern: route.pattern, params: route.params, query: route.query },
        from
      );

      if (verdict.blocked) {
        if (from && from.path && from.path !== route.path) replaceHash(from.path);
        return;
      }
      if (verdict.redirect !== undefined) {
        const target = normalisePath(verdict.redirect);
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          report('redirect loop detected', target);
          redirects = 0;
          return;
        }
        if (target !== route.path) {
          navigating = false;
          replaceHash(target);
          handle();
          return;
        }
      }
      redirects = 0;

      teardown();

      const ctx = buildContext(route);
      const render = renderFn(route.entry.screen);
      let el = null;
      if (!render) {
        report('route has no render()', route.pattern);
      } else {
        try {
          el = render(ctx);
        } catch (err) {
          report(`screen ${route.pattern} failed to render`, err);
          el = errorPanel();
        }
      }

      if (el && outlet) outlet.appendChild(el);
      mounted = { screen: route.entry.screen, el, route };
      activeRoute = Object.freeze({
        path: route.path,
        pattern: route.pattern,
        params: route.params,
        query: route.query,
      });

      focusOutlet(el);

      for (const after of afters.slice()) {
        try {
          after(activeRoute, from);
        } catch (err) {
          report('afterEach threw', err);
        }
      }
    } finally {
      navigating = false;
    }
  }

  function focusOutlet(el) {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, 0);
      } catch (err) {
        /* non-browser host */
      }
    }
    const target = el || outlet;
    if (!target || typeof target.focus !== 'function') return;
    if (!target.hasAttribute || !target.hasAttribute('tabindex')) {
      if (target.setAttribute) target.setAttribute('tabindex', '-1');
    }
    try {
      target.focus({ preventScroll: true });
    } catch (err) {
      /* focus is best-effort */
    }
  }

  function errorPanel() {
    if (typeof document === 'undefined') return null;
    const panel = document.createElement('div');
    panel.className = 'boot-error';
    panel.setAttribute('role', 'alert');
    const holder = document.createElement('div');
    holder.className = 'icon';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');
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
    return panel;
  }

  const router = {
    /** Register a guard: (to, from) -> true | false | '/path' | { path }. */
    beforeEach(fn) {
      if (typeof fn !== 'function') return () => {};
      guards.push(fn);
      return () => {
        const i = guards.indexOf(fn);
        if (i >= 0) guards.splice(i, 1);
      };
    },
    /** Register a post-navigation hook. */
    afterEach(fn) {
      if (typeof fn !== 'function') return () => {};
      afters.push(fn);
      return () => {
        const i = afters.indexOf(fn);
        if (i >= 0) afters.splice(i, 1);
      };
    },
    /** Supply the per-render context (profile, bus, rng, ...). */
    setContext(fn) {
      contextFn = fn;
      return router;
    },
    /** Where unmatched routes land. Defaults to '/'. */
    setNotFound(path) {
      notFound = normalisePath(path);
      return router;
    },
    start() {
      if (started) return router;
      started = true;
      activeRouter = router;
      if (typeof window !== 'undefined') window.addEventListener('hashchange', handle);
      const loc = readLocation();
      if (typeof location !== 'undefined' && (!location.hash || location.hash === '#')) {
        replaceHash('/');
      } else if (loc.path !== normalisePath(loc.path)) {
        replaceHash(loc.path);
      }
      handle();
      return router;
    },
    stop() {
      if (!started) return router;
      started = false;
      if (typeof window !== 'undefined') window.removeEventListener('hashchange', handle);
      if (activeRouter === router) activeRouter = null;
      return router;
    },
    /** Re-run the current route (after a profile or settings change). */
    refresh() {
      if (!started) return router;
      teardown();
      handle();
      return router;
    },
    navigate(path, opts) {
      const target = normalisePath(path);
      if (opts && opts.replace) {
        replaceHash(target);
        handle();
      } else {
        go(target);
      }
      return router;
    },
    current() {
      return activeRoute;
    },
    destroy() {
      router.stop();
      teardown();
      guards.length = 0;
      afters.length = 0;
      contextFn = null;
      return router;
    },
  };

  return router;
}

/** Navigate to a path ('/train/L07' or '#/train/L07'). */
export function go(path) {
  const target = `#${normalisePath(path)}`;
  if (typeof location === 'undefined') return;
  if (location.hash === target) {
    if (activeRouter && typeof activeRouter.refresh === 'function') activeRouter.refresh();
    return;
  }
  location.hash = target;
}

/** The route currently mounted: { path, pattern, params, query }. */
export function currentRoute() {
  return activeRoute;
}
