/**
 * ruleMiner — pure rule-induction drill. A composed, unlabelled transformation is shown
 * as worked before/after pairs; the learner applies it to a fresh figure. The staircase
 * level raises the number of composed operators and withdraws worked examples.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * Layout / protocol
 * -----------------
 * The stimulus is a two-column grid. Every row is one worked pair: left cell = "before",
 * right cell = "after". The LAST row shows a fresh "before" with its right cell rendered
 * as the blank-to-fill. Nothing marks direction except the position of the blank, so the
 * display carries no reading-order dependence and needs no arrow.
 *
 * kind 'choice'. grade(trial, response) accepts an option id string, an option object
 * ({id}) or an index into trial.options; null/undefined grades as incorrect.
 * summary(records) expects { trial, correct, rtMs, level }-shaped records.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { gridSvg, optionSvg, cellKey } from '../../items/svg.js';
import { RULES, RULE_KEYS, applyRule, pickRuleSet } from '../../items/rules.js';

export const id = 'ruleMiner';
export const factor = 'induction';
export const staircasePreset = 'precision';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 18;
const CELL = 78;
const GAP = 12;
const BUILD_ATTEMPTS = 60;
const LOCAL_FROM_ATTEMPT = 30;

/* --- shape / attribute pools ------------------------------------------------------- */

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['circle', 'square', 'triangleUp', 'hexagon']);
const FILL_POOL = asArray(FILLS, ['empty', 'solid', 'hStripe', 'vStripe', 'dots']);
const N_COLOR = asArray(COLORS, [0, 1, 2, 3, 4, 5, 6]).length;
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;

// Only rotation-revealing (non-symmetric) shapes are used, so that a transformation
// touching `rotation` is always visible rather than a silent data-only change.
const ASYMMETRIC = [
  'triangleUp', 'triangleDown', 'triangleRight', 'triangleLeft', 'rightTriangle',
  'trapezoid', 'parallelogram', 'lShape', 'tShape', 'zShape', 'uShape',
  'semicircle', 'quarterDisc', 'notchedSquare', 'notchedCircle', 'pentagon'
];
const SHAPE_RING = (() => {
  const filtered = ASYMMETRIC.filter((k) => ALL_SHAPES.indexOf(k) !== -1);
  return filtered.length >= 3 ? filtered : ALL_SHAPES.slice(0, Math.max(3, ALL_SHAPES.length));
})();

/* --- generic utilities ------------------------------------------------------------- */

function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

function cyc(i, n) {
  return ((i % n) + n) % n;
}

function normRot(r) {
  return ((Math.round(r / 45) * 45) % 360 + 360) % 360;
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
 * A composed transformation cannot always yield an arbitrary number of *distinct*
 * systematic distractors, so the requested count is a preference, not a guarantee:
 * `build` retries at the level's own count when the request cannot be satisfied.
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

function svgSize(svg, fw, fh) {
  let w = fw;
  let h = fh;
  if (typeof svg === 'string') {
    const open = /<svg\b([^>]*)>/.exec(svg);
    if (open) {
      const mw = /\bwidth="([\d.]+)"/.exec(open[1]);
      const mh = /\bheight="([\d.]+)"/.exec(open[1]);
      if (mw && Number.isFinite(Number(mw[1])) && Number(mw[1]) > 0) w = Number(mw[1]);
      if (mh && Number.isFinite(Number(mh[1])) && Number(mh[1]) > 0) h = Number(mh[1]);
    }
  }
  return { width: w, height: h };
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
  if (levels.length) level = Math.round(levels.reduce((a, r) => a + r.level, 0) / levels.length);
  if (!Number.isFinite(level)) level = 1;
  const factorDelta = n === 0
    ? 0
    : clamp(round3((accuracy - 0.72) * 1.4 + (level - 3) * 0.05), -1, 1);
  return { accuracy: round3(accuracy), meanMs: Math.round(meanMs), level, factorDelta };
}

/* --- glyph helpers ----------------------------------------------------------------- */

function copyCell(glyphs) {
  return glyphs.map((g) => ({ ...g }));
}

function nextShape(shape, k) {
  const i = SHAPE_RING.indexOf(shape);
  return SHAPE_RING[cyc((i === -1 ? 0 : i) + k, SHAPE_RING.length)];
}

function nextFill(fill, k) {
  const i = FILL_POOL.indexOf(fill);
  return FILL_POOL[cyc((i === -1 ? 0 : i) + k, FILL_POOL.length)];
}

function randomCell(r, glyphCount) {
  const cell = [];
  for (let i = 0; i < glyphCount; i += 1) {
    cell.push({
      shape: r.pick(SHAPE_RING),
      size: glyphCount > 1 ? r.int(0, Math.min(2, N_SIZE)) : r.int(0, N_SIZE),
      fill: r.pick(FILL_POOL),
      color: r.int(0, N_COLOR),
      rotation: 45 * r.int(0, 8),
      lineWeight: r.int(0, N_WEIGHT),
      dx: glyphCount > 1 ? (i === 0 ? -0.42 : 0.42) : 0,
      dy: 0,
      count: 1
    });
  }
  return cell;
}

/* --- operators --------------------------------------------------------------------- */

// Local operators are always perceptually visible and always applicable; they are the
// guaranteed fallback when the shared rule library cannot produce a usable composition.
function localCatalog(glyphCount) {
  const list = [
    { dim: 'size', key: 'size+1', fn: (gs) => gs.map((g) => ({ ...g, size: cyc(g.size + 1, N_SIZE) })) },
    { dim: 'size', key: 'size-1', fn: (gs) => gs.map((g) => ({ ...g, size: cyc(g.size - 1, N_SIZE) })) },
    { dim: 'color', key: 'color+1', fn: (gs) => gs.map((g) => ({ ...g, color: cyc(g.color + 1, N_COLOR) })) },
    { dim: 'color', key: 'color+3', fn: (gs) => gs.map((g) => ({ ...g, color: cyc(g.color + 3, N_COLOR) })) },
    { dim: 'fill', key: 'fill+1', fn: (gs) => gs.map((g) => ({ ...g, fill: nextFill(g.fill, 1) })) },
    { dim: 'fill', key: 'fill+2', fn: (gs) => gs.map((g) => ({ ...g, fill: nextFill(g.fill, 2) })) },
    { dim: 'shape', key: 'shape+1', fn: (gs) => gs.map((g) => ({ ...g, shape: nextShape(g.shape, 1) })) },
    { dim: 'shape', key: 'shape+2', fn: (gs) => gs.map((g) => ({ ...g, shape: nextShape(g.shape, 2) })) },
    { dim: 'rotation', key: 'rot+90', fn: (gs) => gs.map((g) => ({ ...g, rotation: normRot(g.rotation + 90) })) },
    { dim: 'rotation', key: 'rot+45', fn: (gs) => gs.map((g) => ({ ...g, rotation: normRot(g.rotation + 45) })) },
    { dim: 'weight', key: 'weight+1', fn: (gs) => gs.map((g) => ({ ...g, lineWeight: cyc(g.lineWeight + 1, N_WEIGHT) })) }
  ];
  if (glyphCount === 1) {
    list.push({
      dim: 'count',
      key: 'count+1',
      fn: (gs) => gs.map((g) => ({ ...g, count: 1 + cyc(g.count, 5) }))
    });
  }
  return list.filter((o) => (o.dim !== 'size' || N_SIZE > 1)
    && (o.dim !== 'color' || N_COLOR > 1)
    && (o.dim !== 'fill' || FILL_POOL.length > 1)
    && (o.dim !== 'weight' || N_WEIGHT > 1));
}

function pickLocalOps(r, n, glyphCount) {
  const catalog = r.shuffle(localCatalog(glyphCount));
  const used = new Set();
  const out = [];
  for (const op of catalog) {
    if (used.has(op.dim)) continue;
    used.add(op.dim);
    out.push({ kind: 'local', key: op.key, fn: op.fn });
    if (out.length >= n) break;
  }
  return out;
}

function libraryPool() {
  const keys = asArray(RULE_KEYS, []);
  const allow = new Set([
    'rotation', 'reflection', 'translation', 'progression',
    'sizeOrdering', 'quantityProgression', 'attributeSwap'
  ]);
  const out = [];
  for (const k of keys) {
    if (!allow.has(k)) continue;
    const def = RULES && RULES[k];
    if (!def) continue;
    const arity = typeof def.arity === 'number' ? def.arity : 1;
    if (arity > 1) continue;
    out.push(k);
  }
  return out;
}

function pickLibraryOps(r, n) {
  const pool = libraryPool();
  if (pool.length === 0) return null;
  const want = Math.min(n, pool.length);
  let keys = [];
  try {
    const picked = pickRuleSet(r, { count: want, allow: pool, deny: [] });
    if (Array.isArray(picked)) keys = picked.filter((k) => pool.indexOf(k) !== -1);
  } catch (err) {
    keys = [];
  }
  if (keys.length < want) {
    // pickRuleSet stops as soon as two rules would occupy one dimension — the right
    // rule for a matrix, but a *chained* transformation may legitimately touch the same
    // dimension twice, so top the chain up from the rest of the pool.
    for (const k of r.shuffle(pool.filter((x) => keys.indexOf(x) === -1))) {
      if (keys.length >= want) break;
      keys.push(k);
    }
  }
  keys = keys.slice(0, want);
  if (keys.length === 0) return null;
  return keys.map((k, i) => ({ kind: 'rule', key: k, tag: `op:${i}:${k}` }));
}

/* --- run --------------------------------------------------------------------------- */

function levelSpec(level) {
  return {
    opCount: clamp(1 + Math.floor(level / 2), 1, 4),
    exampleCount: clamp(5 - Math.floor((level - 1) / 2), 2, 4),
    optionCount: level <= 2 ? 4 : (level <= 5 ? 5 : 6),
    glyphCount: level >= 5 ? 2 : 1
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('ruleMiner.makeRun: an rng with fork() is required');
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

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  const issuedTrials = new Map();

  // A transformation must be identical across every worked example, so a rule that
  // consumes ctx.rng is handed a FRESH fork of the same tag on every application.
  function makeTransform(ops, opRngRoot) {
    return (glyphs) => {
      let cur = copyCell(glyphs);
      for (const op of ops) {
        if (op.kind === 'local') {
          cur = op.fn(cur).map((g) => ({ ...g }));
          if (!Array.isArray(cur) || cur.length === 0) return null;
          continue;
        }
        const def = RULES && RULES[op.key];
        if (def && typeof def.canApply === 'function') {
          let ok = false;
          try { ok = def.canApply(cur) !== false; } catch (err) { ok = false; }
          if (!ok) return null;
        }
        let next = null;
        try {
          next = applyRule(op.key, copyCell(cur), {
            step: 1, row: 0, col: 0, rng: opRngRoot.fork(op.tag), params: {}
          });
        } catch (err) {
          return null;
        }
        if (!Array.isArray(next) || next.length === 0) return null;
        if (next.some((g) => !g || typeof g !== 'object' || typeof g.shape !== 'string')) return null;
        cur = copyCell(next);
      }
      return cur;
    };
  }

  function perturbations(glyphCount) {
    // Applied to the correct answer to make near-miss distractors. Every entry changes
    // something perceptually visible; rotation is deliberately excluded here because a
    // transformed shape may have rotational symmetry.
    const one = [
      (g) => ({ ...g, size: cyc(g.size + 1, N_SIZE) }),
      (g) => ({ ...g, size: cyc(g.size - 1, N_SIZE) }),
      (g) => ({ ...g, color: cyc(g.color + 1, N_COLOR) }),
      (g) => ({ ...g, color: cyc(g.color + 3, N_COLOR) }),
      (g) => ({ ...g, fill: nextFill(g.fill, 1) }),
      (g) => ({ ...g, fill: nextFill(g.fill, 3) }),
      (g) => ({ ...g, shape: nextShape(g.shape, 1) }),
      (g) => ({ ...g, shape: nextShape(g.shape, 2) }),
      (g) => ({ ...g, lineWeight: cyc(g.lineWeight + 1, N_WEIGHT) })
    ];
    if (glyphCount === 1) one.push((g) => ({ ...g, count: 1 + cyc(g.count, 5) }));
    return one.map((f) => (gs) => gs.map((g, i) => (i === 0 ? f(g) : { ...g })));
  }

  function attempt(r, spec, useLocal) {
    const ops = useLocal
      ? pickLocalOps(r, spec.opCount, spec.glyphCount)
      : (pickLibraryOps(r, spec.opCount) || pickLocalOps(r, spec.opCount, spec.glyphCount));
    if (!ops || ops.length === 0) return null;
    const transform = makeTransform(ops, r);

    const befores = [];
    const afters = [];
    const seen = new Set();
    for (let i = 0; i < spec.exampleCount + 1; i += 1) {
      let cell = null;
      for (let t = 0; t < 12 && cell === null; t += 1) {
        const candidate = randomCell(r, spec.glyphCount);
        const k = cellKey(candidate);
        if (!seen.has(k)) { seen.add(k); cell = candidate; }
      }
      if (cell === null) return null;
      const after = transform(cell);
      if (after === null) return null;
      if (cellKey(after) === cellKey(cell)) return null;
      befores.push(cell);
      afters.push(after);
    }

    const probeBefore = befores[befores.length - 1];
    const correct = afters[afters.length - 1];
    const correctKey = cellKey(correct);

    // Systematic distractors first: partial application, wrong composition order, then
    // a single mis-applied attribute on an otherwise correct answer.
    const candidates = [];
    for (let k = 0; k < ops.length; k += 1) {
      const partial = makeTransform(ops.slice(0, k), r)(probeBefore);
      if (partial) candidates.push({ glyphs: partial, kind: k === 0 ? 'identity' : 'partial' });
    }
    if (ops.length > 1) {
      const reversed = makeTransform(ops.slice().reverse(), r)(probeBefore);
      if (reversed) candidates.push({ glyphs: reversed, kind: 'wrongOrder' });
    }
    for (const pert of r.shuffle(perturbations(spec.glyphCount))) {
      candidates.push({ glyphs: pert(correct), kind: 'nearMiss' });
    }

    const distractors = [];
    const used = new Set([correctKey]);
    let systematic = 0;
    for (const c of candidates) {
      if (distractors.length >= spec.optionCount - 1) break;
      const k = cellKey(c.glyphs);
      if (used.has(k)) continue;
      used.add(k);
      distractors.push(c);
      if (c.kind !== 'random') systematic += 1;
    }
    if (distractors.length < spec.optionCount - 1) return null;

    const pool = r.shuffle(
      [{ glyphs: correct, kind: 'answer' }].concat(distractors)
    );
    const options = pool.map((entry, i) => {
      const svg = optionSvg(entry.glyphs, { cell: CELL });
      const size = svgSize(svg, CELL + GAP * 2, CELL + GAP * 2);
      return { id: `o${i}`, svg, width: size.width, height: size.height, kind: entry.kind };
    });
    const answerIndex = pool.findIndex((e) => e.kind === 'answer');
    if (answerIndex < 0) return null;

    const cells = [];
    for (let i = 0; i < befores.length - 1; i += 1) {
      cells.push(befores[i]);
      cells.push(afters[i]);
    }
    cells.push(probeBefore);
    cells.push([]);
    const rows = befores.length;
    const stimSvg = gridSvg({
      rows,
      cols: 2,
      cells,
      cell: CELL,
      gap: GAP,
      missingIndex: cells.length - 1,
      frame: true
    });
    if (typeof stimSvg !== 'string' || stimSvg.length === 0) return null;
    const stimSize = svgSize(
      stimSvg, 2 * CELL + GAP + 2 * GAP, rows * CELL + (rows - 1) * GAP + 2 * GAP
    );

    return {
      stimulus: { svg: stimSvg, width: stimSize.width, height: stimSize.height },
      options: options.map((o) => ({ id: o.id, svg: o.svg, width: o.width, height: o.height })),
      answerId: options[answerIndex].id,
      optionKinds: options.map((o) => ({ id: o.id, kind: o.kind })),
      opKeys: ops.map((o) => o.key),
      distractorSystematicity: distractors.length
        ? round3(systematic / distractors.length)
        : 0
    };
  }

  function build(level, index) {
    const base = levelSpec(level);
    // Try the curriculum's requested option count first; if a composition cannot supply
    // that many distinct systematic distractors, drop back to the level's own count
    // rather than failing the trial.
    const counts = [];
    if (wantOptions !== null && wantOptions !== base.optionCount) counts.push(wantOptions);
    counts.push(base.optionCount);
    let last = null;
    for (const optionCount of counts) {
      const spec = { ...base, optionCount };
      for (let a = 0; a < BUILD_ATTEMPTS; a += 1) {
        const r = rng.fork(`${id}:${index}:${level}:${optionCount}:${a}`);
        const built = attempt(r, spec, a >= LOCAL_FROM_ATTEMPT);
        if (built) return built;
        last = a;
      }
    }
    throw new Error(
      `ruleMiner: could not build a valid induction trial at level ${level} ` +
      `after ${last + 1} attempts`
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
      const built = build(lv, index);
      const trialId = `${id}:${index}`;
      issuedTrials.set(trialId, built);
      return {
        id: trialId,
        level: lv,
        stimulus: built.stimulus,
        options: built.options,
        answerId: built.answerId,
        answer: built.answerId,
        timeLimitMs: explicitLimit !== null ? explicitLimit : null,
        isiMs: 0
      };
    },

    grade(trial, response) {
      const answerId = trial && typeof trial.answerId === 'string' ? trial.answerId : null;
      const chosen = chosenOptionId(trial, response);
      const correct = chosen !== null && answerId !== null && chosen === answerId;
      const rec = trial && issuedTrials.get(trial.id);
      let chosenKind = null;
      if (rec && chosen) {
        const hit = rec.optionKinds.find((o) => o.id === chosen);
        chosenKind = hit ? hit.kind : null;
      }
      return {
        correct,
        detail: {
          chosen,
          answerId,
          chosenKind,
          timedOut: chosen === null,
          operators: rec ? rec.opKeys : null,
          distractorSystematicity: rec ? rec.distractorSystematicity : null,
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
