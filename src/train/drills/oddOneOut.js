/**
 * oddOneOut — relational training drill. Wraps the `oddoneout` item family; the staircase
 * level raises the order of the property shared by the non-odd figures (first-order
 * feature -> relation -> relation between relations) and the number of irrelevant
 * co-varying attributes. Kind 'choice'.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * Protocol
 * --------
 * nextTrial(level) -> Trial { stimulus:{svg,width,height}, options:[...] }
 * The options ARE the figures; the response names the figure that breaks the shared
 * property. grade(trial, response) accepts an option id string, an option object ({id})
 * or an index into trial.options. A null/undefined response grades as incorrect.
 * summary(records) expects { trial, correct, rtMs, level }-shaped records.
 */

import * as oddFamily from '../../items/oddoneout.js';

export const id = 'oddOneOut';
export const factor = 'relational';
export const staircasePreset = 'precision';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 20;
const FALLBACK_B_RANGE = [-2.5, 3.5];
const GEN_ATTEMPTS = 8;

function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function intParam(value, fallback, lo, hi) {
  const raw = typeof value === 'string' ? Number(value) : value;
  const n = num(raw);
  return clamp(Math.round(n === null ? fallback : n), lo, hi);
}

/**
 * `optionCount` is supplied explicitly by curriculum.js for the option-grid drills.
 * Honour it when it is a usable count, otherwise fall back to the level-derived value.
 */
function optionParam(value) {
  const raw = typeof value === 'string' ? Number(value) : value;
  const n = num(raw);
  if (n === null) return null;
  const r = Math.round(n);
  return r >= 3 && r <= 8 ? r : null;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function bRangeOf(mod, fallback) {
  const r = mod && mod.bRange;
  if (Array.isArray(r) && r.length === 2 && num(r[0]) !== null && num(r[1]) !== null) {
    return [Math.min(r[0], r[1]), Math.max(r[0], r[1])];
  }
  return fallback;
}

function validItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!Array.isArray(item.options) || item.options.length < 3) return false;
  const seen = new Set();
  for (const o of item.options) {
    if (!o || typeof o.id !== 'string' || typeof o.svg !== 'string') return false;
    if (seen.has(o.id)) return false;
    seen.add(o.id);
  }
  return typeof item.answerId === 'string' && seen.has(item.answerId);
}

function chosenOptionId(trial, response) {
  if (response === null || response === undefined) return null;
  if (typeof response === 'string') return response;
  if (typeof response === 'number' && Number.isFinite(response)) {
    const opts = trial && Array.isArray(trial.options) ? trial.options : null;
    if (opts && response >= 0 && response < opts.length) return opts[response].id;
    return null;
  }
  if (typeof response === 'object') {
    for (const k of ['id', 'optionId', 'responseId', 'value']) {
      if (typeof response[k] === 'string') return response[k];
    }
  }
  return null;
}

function readRecords(records) {
  const rows = Array.isArray(records) ? records : [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    let correct = false;
    if (r.correct === true) correct = true;
    else if (r.correct === false) correct = false;
    else if (r.detail && r.detail.correct === true) correct = true;
    const ms = num(r.rtMs) !== null ? num(r.rtMs)
      : num(r.ms) !== null ? num(r.ms)
        : num(r.timeMs) !== null ? num(r.timeMs) : num(r.durationMs);
    const lvl = num(r.level) !== null ? num(r.level) : num(r.trial && r.trial.level);
    const tid = (r.trial && typeof r.trial.id === 'string') ? r.trial.id
      : (typeof r.trialId === 'string' ? r.trialId : (typeof r.id === 'string' ? r.id : null));
    out.push({ correct, ms, level: lvl, id: tid });
  }
  return out;
}

function summarise(records, fallbackLevel) {
  const rows = readRecords(records);
  const n = rows.length;
  let hits = 0;
  let msSum = 0;
  let msN = 0;
  for (const r of rows) {
    if (r.correct) hits += 1;
    if (r.ms !== null && r.ms >= 0) { msSum += r.ms; msN += 1; }
  }
  const accuracy = n ? hits / n : 0;
  const meanMs = msN ? msSum / msN : 0;
  const levels = rows.filter((r) => r.level !== null).slice(-8);
  let level = fallbackLevel;
  if (levels.length) {
    level = Math.round(levels.reduce((a, r) => a + r.level, 0) / levels.length);
  }
  if (!Number.isFinite(level)) level = 1;
  const factorDelta = n === 0
    ? 0
    : clamp(round3((accuracy - 0.72) * 1.4 + (level - 3) * 0.05), -1, 1);
  return { accuracy: round3(accuracy), meanMs: Math.round(meanMs), level, factorDelta };
}

function levelSpec(level, range, explicitLimit, wantOptions) {
  const targetB = clamp(-1.25 + (level - 1) * 0.55, range[0], range[1]);
  return {
    targetB,
    optionCount: wantOptions !== null && wantOptions !== undefined
      ? wantOptions
      : (level <= 4 ? 6 : 8),
    hints: {
      order: clamp(1 + Math.floor((level - 1) / 2), 1, 3),
      irrelevantAttributes: clamp(level - 1, 0, 4),
      coVarying: clamp(level - 1, 0, 4)
    },
    timeLimitMs: explicitLimit !== null ? explicitLimit : null
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('oddOneOut.makeRun: an rng with fork() is required');
  }
  const p = (params && typeof params === 'object') ? params : {};
  // `levelMax` is the vocabulary curriculum.js/session.js use for the staircase
  // ceiling; `maxLevel` is accepted as a synonym.
  const maxLevel = intParam(
    p.maxLevel !== undefined ? p.maxLevel : p.levelMax, MAX_LEVEL, 1, 20
  );
  const totalTrials = intParam(
    p.trials !== undefined ? p.trials : p.totalTrials, DEFAULT_TRIALS, 1, 300
  );
  const explicitLimit = num(p.timeLimitMs);
  const wantOptions = optionParam(p.optionCount);
  const range = bRangeOf(oddFamily, FALLBACK_B_RANGE);

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  const issuedTrials = new Map();

  function build(level, index, spec) {
    if (typeof oddFamily.generate !== 'function') {
      throw new Error('oddOneOut: items/oddoneout.js does not export generate()');
    }
    let lastErr = null;
    for (let attempt = 0; attempt < GEN_ATTEMPTS; attempt += 1) {
      const relax = attempt < 3 ? 1 : (attempt < 5 ? 0.7 : 0.35);
      const targetB = clamp(spec.targetB * relax, range[0], range[1]);
      const optionCount = attempt < 4 ? spec.optionCount : (spec.optionCount === 6 ? 8 : 6);
      try {
        const item = oddFamily.generate(rng.fork(`${id}:${index}:${level}:${attempt}`), {
          targetB, optionCount, level, ...spec.hints
        });
        if (validItem(item)) return item;
        lastErr = new Error('generator returned an incomplete item');
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(
      `oddOneOut: could not generate a valid odd-one-out item at level ${level} ` +
      `(${lastErr ? lastErr.message : 'unknown reason'})`
    );
  }

  return {
    kind: 'choice',
    totalTrials,

    nextTrial(level) {
      if (issued >= totalTrials) return null;
      const lv = intParam(level, lastLevel, 1, maxLevel);
      lastLevel = lv;
      const index = issued;
      issued += 1;
      const spec = levelSpec(lv, range, explicitLimit, wantOptions);
      const item = build(lv, index, spec);
      const trialId = `${id}:${index}`;
      issuedTrials.set(trialId, {
        itemId: typeof item.id === 'string' ? item.id : null,
        meta: item.meta && typeof item.meta === 'object' ? item.meta : null,
        order: spec.hints.order
      });
      // An odd-one-out set carries all of its information in the figures themselves;
      // a prompt panel is optional for this family, so tolerate its absence.
      const prompt = item.prompt && typeof item.prompt.svg === 'string' ? item.prompt : null;
      return {
        id: trialId,
        level: lv,
        stimulus: prompt
          ? {
            svg: prompt.svg,
            width: num(prompt.width) !== null ? prompt.width : null,
            height: num(prompt.height) !== null ? prompt.height : null
          }
          : { svg: '', width: null, height: null },
        options: item.options.map((o) => ({
          id: o.id,
          svg: o.svg,
          width: num(o.width) !== null ? o.width : null,
          height: num(o.height) !== null ? o.height : null
        })),
        answerId: item.answerId,
        answer: item.answerId,
        timeLimitMs: spec.timeLimitMs,
        isiMs: 0
      };
    },

    grade(trial, response) {
      const answerId = trial && typeof trial.answerId === 'string' ? trial.answerId : null;
      const chosen = chosenOptionId(trial, response);
      const correct = chosen !== null && answerId !== null && chosen === answerId;
      const rec = trial && issuedTrials.get(trial.id);
      return {
        correct,
        detail: {
          chosen,
          answerId,
          timedOut: chosen === null,
          itemId: rec ? rec.itemId : null,
          order: rec ? rec.order : null,
          meta: rec ? rec.meta : null,
          feedback: correct ? 'good' : 'bad',
          feedbackClass: correct ? 'fb-good' : 'fb-bad'
        }
      };
    },

    summary(records) {
      return summarise(records, lastLevel);
    }
  };
}
