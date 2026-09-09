/**
 * Tiny typed publish/subscribe bus used to decouple screens, the CAT session
 * and the training engine. Listeners are isolated: one that throws never
 * breaks an emit, and the listener set may be mutated while emitting.
 */

const WILDCARD = '*';

/**
 * Report a listener failure without letting it escape `emit`.
 * @param {string} type
 * @param {unknown} err
 */
function reportListenerError(type, err) {
  try {
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error(`[bus] listener for "${type}" threw:`, err);
    }
  } catch (_ignored) {
    // Nothing else we can do; swallowing keeps emit total.
  }
}

/**
 * Create an independent event bus.
 *
 * `on(type, fn)` returns an unsubscribe function. Listeners registered for the
 * wildcard type `'*'` receive every event. Every listener is called as
 * `fn(payload, type)`.
 *
 * @returns {{ on: Function, once: Function, emit: Function, clear: Function }}
 */
export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  /**
   * @param {string} type
   * @param {Function} fn
   * @returns {() => void} unsubscribe
   */
  function on(type, fn) {
    if (typeof type !== 'string' || type.length === 0) {
      throw new TypeError('bus.on: type must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('bus.on: listener must be a function');
    }
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(fn);
    let active = true;
    return function off() {
      if (!active) return;
      active = false;
      const current = listeners.get(type);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) listeners.delete(type);
    };
  }

  /**
   * Subscribe for exactly one delivery. The listener is removed *before* it is
   * invoked, so a throwing listener cannot fire twice.
   * @param {string} type
   * @param {Function} fn
   * @returns {() => void} unsubscribe
   */
  function once(type, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('bus.once: listener must be a function');
    }
    const off = on(type, function oneShot(payload, evtType) {
      off();
      fn(payload, evtType);
    });
    return off;
  }

  /**
   * Deliver an event to typed listeners and then to wildcard listeners.
   * Never throws.
   * @param {string} type
   * @param {*} [payload]
   * @returns {number} how many listeners were invoked
   */
  function emit(type, payload) {
    if (typeof type !== 'string' || type.length === 0) return 0;
    let delivered = 0;

    const direct = listeners.get(type);
    if (direct && direct.size > 0) {
      // Iterate a snapshot: listeners may subscribe/unsubscribe during emit.
      const snapshot = Array.from(direct);
      for (let i = 0; i < snapshot.length; i += 1) {
        const fn = snapshot[i];
        const live = listeners.get(type);
        if (!live || !live.has(fn)) continue; // unsubscribed mid-emit
        delivered += 1;
        try {
          fn(payload, type);
        } catch (err) {
          reportListenerError(type, err);
        }
      }
    }

    if (type !== WILDCARD) {
      const wild = listeners.get(WILDCARD);
      if (wild && wild.size > 0) {
        const snapshot = Array.from(wild);
        for (let i = 0; i < snapshot.length; i += 1) {
          const fn = snapshot[i];
          const live = listeners.get(WILDCARD);
          if (!live || !live.has(fn)) continue;
          delivered += 1;
          try {
            fn(payload, type);
          } catch (err) {
            reportListenerError(type, err);
          }
        }
      }
    }

    return delivered;
  }

  /**
   * Remove every listener, or every listener of one type.
   * @param {string} [type]
   * @returns {void}
   */
  function clear(type) {
    if (typeof type === 'string' && type.length > 0) {
      listeners.delete(type);
      return;
    }
    listeners.clear();
  }

  return { on, once, emit, clear };
}

/** Shared application bus. */
export const bus = createBus();
