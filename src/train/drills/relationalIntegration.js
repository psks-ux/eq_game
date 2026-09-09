/**
 * relationalIntegration — the most g-loaded drill in the set. Several reference figures
 * are shown, each of which departs from a common baseline figure on exactly ONE
 * attribute; the missing figure is the one that satisfies every departure at once, so
 * all relations must be held and combined simultaneously. Level = relations to integrate.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * Why this is inducible without words
 * -----------------------------------
 * Every reference is the SAME baseline figure with a single attribute changed. Which
 * attribute a reference carries is therefore self-evident (it is the only thing about it
 * that is not baseline), and the blank slot beneath the joining bracket must carry all
 * of the changes together. No instruction, notation or reading order is involved.
 *
 * Distractors are systematic: each one either drops exactly one relation (reverting that
 * attribute to baseline) or mis-reads exactly one relation (using a different non-baseline
 * value), so partial integration always lands on a wrong answer.
 *
 * kind 'choice'. grade(trial, response) accepts an option id string, an option object
 * ({id}) or an index into trial.options; null/undefined grades as incorrect.
 * summary(records) expects { trial, correct, rtMs, level }-shaped records.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell, el, cellKey } from '../../items/svg.js';

export const id = 'relationalIntegration';
export const factor = 'relational';
export const staircasePreset = 'precision';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 18;
const CELL = 92;
const GAP = 16;
const PAD = 18;
const BRACKET = 34;
const OPT_PAD = 10;
const BUILD_ATTEMPTS = 40;

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['square', 'circle', 'triangleUp', 'hexagon']);
const FILL_POOL = asArray(FILLS, ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half']);
const N_COLOR = asArray(COLORS, [0, 1, 2, 3, 4, 5, 6]).length;
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;

const BASE_SHAPE = ['square', 'roundedSquare', 'circle'].find((k) => ALL_SHAPES.indexOf(k) !== -1)
  || ALL_SHAPES[0];
const BASE_FILL = ['solid', 'empty'].find((k) => FILL_POOL.indexOf(k) !== -1) || FILL_POOL[0];
const BASE_SIZE = Math.min(1, N_SIZE - 1);

const SHAPE_POOL = ALL_SHAPES.filter((k) => k !== BASE_SHAPE);
// Shapes that read as close relatives of the baseline square: used at high levels so the
// shape relation has to be resolved carefully rather than at a glance.
const SUBTLE_SHAPES = ['roundedSquare', 'rectangle', 'diamond', 'trapezoid', 'parallelogram',
  'pentagon', 'hexagon', 'octagon'].filter(
  (k) => ALL_SHAPES.indexOf(k) !== -1 && k !== BASE_SHAPE
);

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
 * The systematic distractor families (dropped / misread / extra) are finite for a given
 * relation set, so the request is a preference: `build` retries at the level's own count
 * when the requested one cannot be filled with strictly systematic options.
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
    : clamp(round3((accuracy - 0.72) * 1.5 + (level - 3) * 0.06), -1, 1);
  return { accuracy: round3(accuracy), meanMs: Math.round(meanMs), level, factorDelta };
}

/* --- dimension model --------------------------------------------------------------- */

function baseline() {
  return {
    shape: BASE_SHAPE,
    size: BASE_SIZE,
    fill: BASE_FILL,
    color: -1,
    rotation: 0,
    lineWeight: clamp(1, 0, N_WEIGHT - 1),
    dx: 0,
    dy: 0,
    count: 1
  };
}

function valuePool(dim, subtle, countUsed) {
  if (dim === 'shape') {
    const pool = subtle && SUBTLE_SHAPES.length >= 2 ? SUBTLE_SHAPES : SHAPE_POOL;
    return pool.length ? pool.slice() : ALL_SHAPES.slice();
  }
  if (dim === 'fill') {
    return FILL_POOL.filter((f) => f !== BASE_FILL);
  }
  if (dim === 'color') {
    const out = [];
    for (let i = 0; i < N_COLOR; i += 1) out.push(i);
    return subtle ? out.slice(0, Math.max(2, Math.ceil(out.length / 2))) : out;
  }
  if (dim === 'size') {
    const out = [];
    // The largest step is withheld when the figure is also replicated, so that a
    // multi-glyph answer never has to be drawn oversized inside its cell.
    const top = countUsed ? Math.max(0, N_SIZE - 2) : N_SIZE - 1;
    for (let i = 0; i <= top; i += 1) if (i !== BASE_SIZE) out.push(i);
    if (out.length === 0) out.push(clamp(BASE_SIZE + 1, 0, N_SIZE - 1));
    return subtle
      ? out.filter((i) => Math.abs(i - BASE_SIZE) === 1).concat(out.length ? [] : out)
      : out;
  }
  if (dim === 'count') {
    const out = [2, 3, 4, 5];
    return subtle ? [2, 3] : out;
  }
  if (dim === 'weight') {
    const out = [];
    for (let i = 0; i < N_WEIGHT; i += 1) if (i !== clamp(1, 0, N_WEIGHT - 1)) out.push(i);
    return out.length ? out : [0];
  }
  return [];
}

function applyValue(glyph, dim, value) {
  const g = { ...glyph };
  if (dim === 'shape') g.shape = value;
  else if (dim === 'fill') g.fill = value;
  else if (dim === 'color') g.color = value;
  else if (dim === 'size') g.size = value;
  else if (dim === 'count') g.count = value;
  else if (dim === 'weight') g.lineWeight = value;
  return g;
}

function availableDims() {
  const dims = [];
  if (SHAPE_POOL.length >= 2) dims.push('shape');
  if (FILL_POOL.filter((f) => f !== BASE_FILL).length >= 2) dims.push('fill');
  if (N_COLOR >= 3) dims.push('color');
  if (N_SIZE >= 3) dims.push('size');
  dims.push('count');
  if (N_WEIGHT >= 2) dims.push('weight');
  return dims;
}

/* --- rendering --------------------------------------------------------------------- */

function boardSvg(references, subtle) {
  const r = references.length;
  const width = PAD * 2 + r * CELL + (r - 1) * GAP;
  const height = PAD * 2 + CELL + BRACKET + CELL;
  const barY = PAD + CELL + BRACKET / 2;
  const slotTop = PAD + CELL + BRACKET;
  const slotX = (width - CELL) / 2;
  let body = '';

  const centres = [];
  for (let i = 0; i < r; i += 1) {
    const cx = PAD + i * (CELL + GAP) + CELL / 2;
    centres.push(cx);
    body += el('rect', {
      x: PAD + i * (CELL + GAP),
      y: PAD,
      width: CELL,
      height: CELL,
      rx: 12,
      fill: 'none',
      stroke: 'var(--line)',
      'stroke-width': 2
    });
    body += drawCell([references[i]], cx, PAD + CELL / 2, CELL);
  }

  // Joining bracket: plain rules with round caps, no arrow head of any kind.
  for (const cx of centres) {
    body += el('line', {
      x1: cx, y1: PAD + CELL + 5, x2: cx, y2: barY,
      stroke: 'var(--line-strong)', 'stroke-width': 2, 'stroke-linecap': 'round'
    });
  }
  body += el('line', {
    x1: centres[0], y1: barY, x2: centres[centres.length - 1], y2: barY,
    stroke: 'var(--line-strong)', 'stroke-width': 2, 'stroke-linecap': 'round'
  });
  body += el('line', {
    x1: width / 2, y1: barY, x2: width / 2, y2: slotTop - 5,
    stroke: 'var(--line-strong)', 'stroke-width': 2, 'stroke-linecap': 'round'
  });

  body += el('rect', {
    x: slotX,
    y: slotTop,
    width: CELL,
    height: CELL,
    rx: 12,
    fill: 'none',
    stroke: 'var(--line-strong)',
    'stroke-width': 2,
    'stroke-dasharray': '7 7'
  });

  return {
    svg: svgRoot({
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      className: `stim stim-relational${subtle ? ' is-subtle' : ''}`,
      body
    }),
    width,
    height
  };
}

function optionTile(glyph) {
  const size = CELL + OPT_PAD * 2;
  return {
    svg: svgRoot({
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      className: 'stim stim-option',
      body: drawCell([glyph], size / 2, size / 2, CELL)
    }),
    width: size,
    height: size
  };
}

/* --- run --------------------------------------------------------------------------- */

function levelSpec(level) {
  const relations = clamp(Math.round(level), 2, 5);
  return {
    relations,
    subtle: level >= 6,
    optionCount: relations <= 2 ? 4 : (relations <= 3 ? 5 : 6)
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('relationalIntegration.makeRun: an rng with fork() is required');
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
  let lastLevel = intParam(p.startLevel, 2, 1, maxLevel);
  const issuedTrials = new Map();

  function attempt(r, spec) {
    const dims = availableDims();
    const want = Math.min(spec.relations, dims.length);
    if (want < 2) return null;
    const chosen = r.sample(dims, want);
    if (!Array.isArray(chosen) || chosen.length < 2) return null;
    const countUsed = chosen.indexOf('count') !== -1;

    const base = baseline();
    const values = {};
    const references = [];
    for (const dim of chosen) {
      const pool = valuePool(dim, spec.subtle, countUsed);
      if (!pool.length) return null;
      const value = r.pick(pool);
      values[dim] = value;
      references.push({ dim, glyph: applyValue(base, dim, value) });
    }

    let target = base;
    for (const dim of chosen) target = applyValue(target, dim, values[dim]);
    const targetKey = cellKey([target]);
    if (references.some((ref) => cellKey([ref.glyph]) === targetKey)) return null;

    // Systematic distractors, strongest first.
    const candidates = [];
    for (const dim of r.shuffle(chosen)) {
      candidates.push({ glyph: applyValue(target, dim, base[dim === 'weight' ? 'lineWeight' : dim]), kind: `dropped:${dim}` });
    }
    for (const dim of r.shuffle(chosen)) {
      const pool = valuePool(dim, spec.subtle, countUsed).filter((v) => v !== values[dim]);
      if (pool.length) {
        candidates.push({ glyph: applyValue(target, dim, r.pick(pool)), kind: `misread:${dim}` });
      }
    }
    const unused = dims.filter((d) => chosen.indexOf(d) === -1);
    for (const dim of r.shuffle(unused)) {
      const pool = valuePool(dim, spec.subtle, countUsed);
      if (pool.length) {
        candidates.push({ glyph: applyValue(target, dim, r.pick(pool)), kind: `extra:${dim}` });
      }
    }

    const used = new Set([targetKey]);
    const distractors = [];
    for (const c of candidates) {
      if (distractors.length >= spec.optionCount - 1) break;
      const k = cellKey([c.glyph]);
      if (used.has(k)) continue;
      used.add(k);
      distractors.push(c);
    }
    if (distractors.length < spec.optionCount - 1) return null;

    const pool = r.shuffle([{ glyph: target, kind: 'answer' }].concat(distractors));
    const options = pool.map((entry, i) => {
      const tile = optionTile(entry.glyph);
      return {
        id: `o${i}`, svg: tile.svg, width: tile.width, height: tile.height, kind: entry.kind
      };
    });
    const answerIndex = pool.findIndex((e) => e.kind === 'answer');
    if (answerIndex < 0) return null;

    const board = boardSvg(r.shuffle(references).map((ref) => ref.glyph), spec.subtle);
    return {
      stimulus: { svg: board.svg, width: board.width, height: board.height },
      options: options.map((o) => ({ id: o.id, svg: o.svg, width: o.width, height: o.height })),
      answerId: options[answerIndex].id,
      optionKinds: options.map((o) => ({ id: o.id, kind: o.kind })),
      relations: chosen.slice(),
      subtle: spec.subtle
    };
  }

  function build(level, index) {
    const base = levelSpec(level);
    const counts = [];
    if (wantOptions !== null && wantOptions !== base.optionCount) counts.push(wantOptions);
    counts.push(base.optionCount);
    for (const optionCount of counts) {
      const spec = { ...base, optionCount };
      for (let a = 0; a < BUILD_ATTEMPTS; a += 1) {
        const built = attempt(rng.fork(`${id}:${index}:${level}:${optionCount}:${a}`), spec);
        if (built) return built;
      }
    }
    throw new Error(
      `relationalIntegration: could not build a trial with ${base.relations} relations ` +
      `at level ${level}`
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
      const missedRelation = chosenKind && chosenKind.indexOf('dropped:') === 0
        ? chosenKind.slice('dropped:'.length)
        : null;
      return {
        correct,
        detail: {
          chosen,
          answerId,
          chosenKind,
          missedRelation,
          timedOut: chosen === null,
          relations: rec ? rec.relations : null,
          relationCount: rec ? rec.relations.length : null,
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
