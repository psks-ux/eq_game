/**
 * Mental-rotation item family: an abstract, provably chiral lattice figure is
 * shown and the solver must find the same figure rotated (never reflected).
 * Rotation, reflection and the chirality proof are computed, not tabulated.
 */

import { svgRoot, el } from './svg.js';
import { SHAPE_KEYS } from './shapes.js';
import { priorIrtParams } from './calibration.js';

export const family = 'mentalRotation';
export const bRange = [-1.4, 4.8];
export const contentGroup = 'spatial';

const GENERATOR_VERSION = 1;

/* ---------------------------------------------------------------- constants */

const MAX_ATTEMPTS = 50;
const POS_TOL = 1e-6;

/** The eight orientations the whole family lives on (multiples of 45 degrees). */
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Component shapes. Every one is symmetric about BOTH axes, which is what makes
 * a reflected figure renderable from the same lexicon: mirroring across the
 * horizontal axis maps such a shape at rotation `r` to the same shape at `-r`,
 * so no chiral primitive is ever needed. `aspect` is height / width.
 */
const SHAPE_DEFS = {
  square: { aspect: 1 },
  rectangle: { aspect: 0.56 },
  circle: { aspect: 1 },
  ellipse: { aspect: 0.58 },
  hexagon: { aspect: 1 },
  octagon: { aspect: 1 }
};

const LOCAL_SHAPE_KEYS = Object.keys(SHAPE_DEFS);

/** Keep only shapes the sanctioned lexicon actually publishes. */
const PALETTE = (() => {
  const allowed = Array.isArray(SHAPE_KEYS) ? new Set(SHAPE_KEYS) : null;
  if (!allowed) return LOCAL_SHAPE_KEYS.slice();
  const kept = LOCAL_SHAPE_KEYS.filter((k) => allowed.has(k));
  return kept.length >= 2 ? kept : LOCAL_SHAPE_KEYS.slice();
})();

const MARKER_SHAPES = PALETTE.filter((k) => k !== 'square');
const CELL_SIZE = 1.0; // body cells fill their lattice cell exactly
const MARKER_SIZE = 0.7;

/** Abstractness weights (same 1..4 scale as rules.js `ruleCost`). */
const ABSTRACTNESS = { rotation: 2, constancy: 1, reflection: 2, ruleChaining: 4 };

const DISPARITY_SETS = {
  quarter: [90, 180, 270],
  eighth: [45, 135, 225, 315],
  mixed: [45, 90, 135, 180, 225, 270, 315]
};

/** Foil recipes; `salience` is how far a surface-feature match alone gets you. */
const FOIL_MIXES = {
  gross: { salience: 0.62, mirrors: 0, subtle: false },
  perturb: { salience: 0.42, mirrors: 0, subtle: true },
  mixed: { salience: 0.22, mirrors: 0.5, subtle: true },
  mirror: { salience: 0.09, mirrors: 1, subtle: true }
};

/* ---------------------------------------------------------------- utilities */

function clampNum(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function n2(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function meanOf(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : 0;
}

function normaliseOptionCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 8;
  return clampNum(v, 3, 10);
}

function normAngle(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/* ----------------------------------------------------------- figure algebra */

/**
 * A figure is a list of components on the integer lattice:
 * `{ shape, size, fill, x, y, rot }`. Positions are lattice units; `rot` is a
 * multiple of 45 degrees.
 */
function cloneFigure(fig) {
  return fig.map((c) => ({ ...c }));
}

function rotateFigure(fig, deg) {
  const r = (normAngle(deg) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return fig.map((c) => ({
    ...c,
    x: c.x * cos - c.y * sin,
    y: c.x * sin + c.y * cos,
    rot: normAngle(c.rot + deg)
  }));
}

/** Reflection across the horizontal axis through the origin. */
function mirrorFigure(fig) {
  return fig.map((c) => ({ ...c, y: -c.y, rot: normAngle(-c.rot) }));
}

function centroidOf(fig) {
  return { x: meanOf(fig.map((c) => c.x)), y: meanOf(fig.map((c) => c.y)) };
}

/**
 * A component's identity ignores its own turn: two figures count as the same
 * only when the *arrangement* matches. That makes the chirality test below the
 * strong one — a mirror foil can never be told apart by the orientation of a
 * single piece, only by the handedness of the whole figure.
 */
function componentToken(comp) {
  return `${comp.shape}|${Math.round(comp.size * 1000)}|${comp.fill}`;
}

/** Centroid-normalised, label-tagged points — the identity of a figure. */
function normalisedPoints(fig) {
  const c = centroidOf(fig);
  return fig.map((comp) => ({
    token: componentToken(comp),
    x: comp.x - c.x,
    y: comp.y - c.y
  }));
}

function sameFigure(a, b) {
  if (a.length !== b.length) return false;
  const pa = normalisedPoints(a);
  const pb = normalisedPoints(b);
  const used = new Array(pb.length).fill(false);
  for (const p of pa) {
    let hit = -1;
    for (let j = 0; j < pb.length; j++) {
      if (used[j]) continue;
      const q = pb[j];
      if (q.token !== p.token) continue;
      if (Math.abs(q.x - p.x) > POS_TOL || Math.abs(q.y - p.y) > POS_TOL) continue;
      hit = j;
      break;
    }
    if (hit < 0) return false;
    used[hit] = true;
  }
  return true;
}

/** True when `b` is `a` turned by one of the eight orientations. */
function isRotationOf(a, b) {
  for (const deg of ANGLES) {
    if (sameFigure(rotateFigure(a, deg), b)) return true;
  }
  return false;
}

/**
 * Chirality proof: canonicalise over all eight rotations and compare with the
 * mirrored form. If any rotation of the mirror reproduces the figure, the
 * figure is achiral and must be rejected — a mirror foil would be a second
 * correct answer.
 */
function isChiral(fig) {
  return !isRotationOf(mirrorFigure(fig), fig);
}

function figureRadius(fig) {
  const c = centroidOf(fig);
  let r = 0;
  for (const comp of fig) {
    const d = Math.hypot(comp.x - c.x, comp.y - c.y) + (comp.size * Math.SQRT2) / 2;
    if (d > r) r = d;
  }
  return r;
}

/* --------------------------------------------------------- figure generation */

function cellKeyOf(p) {
  return `${p.x},${p.y}`;
}

/** Grow a connected lattice animal; chain style keeps it a self-avoiding walk. */
function growAnimal(rng, cells, chainStyle) {
  const occupied = new Set(['0,0']);
  const order = [{ x: 0, y: 0 }];
  let guard = 0;
  while (order.length < cells && guard < 600) {
    guard++;
    const from = chainStyle ? order[order.length - 1] : rng.pick(order);
    const dirs = rng.shuffle([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]);
    let placed = false;
    for (const d of dirs) {
      const q = { x: from.x + d[0], y: from.y + d[1] };
      if (occupied.has(cellKeyOf(q))) continue;
      occupied.add(cellKeyOf(q));
      order.push(q);
      placed = true;
      break;
    }
    if (placed) continue;
    // The walk boxed itself in: continue from any cell that still has room.
    const free = order.filter((p) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ].some((d) => !occupied.has(cellKeyOf({ x: p.x + d[0], y: p.y + d[1] })))
    );
    if (!free.length) return null;
    const seed = rng.pick(free);
    const dirs2 = rng.shuffle([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]);
    for (const d of dirs2) {
      const q = { x: seed.x + d[0], y: seed.y + d[1] };
      if (occupied.has(cellKeyOf(q))) continue;
      occupied.add(cellKeyOf(q));
      order.push(q);
      break;
    }
  }
  return order.length === cells ? order : null;
}

function buildFigure(rng, plan) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const cellsList = growAnimal(rng, plan.cells, plan.chainStyle);
    if (!cellsList) continue;
    const fig = cellsList.map((p) => ({
      shape: 'square',
      size: CELL_SIZE,
      fill: 'empty',
      x: p.x,
      y: p.y,
      rot: 0
    }));
    const markerSlots = rng.shuffle(fig.map((_, i) => i)).slice(0, plan.variety);
    for (let k = 0; k < markerSlots.length; k++) {
      const comp = fig[markerSlots[k]];
      comp.shape = MARKER_SHAPES.length
        ? MARKER_SHAPES[k % MARKER_SHAPES.length]
        : 'square';
      comp.size = MARKER_SIZE;
      comp.fill = k % 2 === 0 ? 'solid' : 'empty';
      comp.rot = 0;
    }
    if (isChiral(fig)) return fig;
  }
  return null;
}

/* -------------------------------------------------------------- perturbation */

function freeNeighbours(fig, skipIndex) {
  const occupied = new Set(
    fig.map((c, i) => (i === skipIndex ? null : cellKeyOf(c))).filter(Boolean)
  );
  const out = [];
  for (let i = 0; i < fig.length; i++) {
    if (i === skipIndex) continue;
    for (const d of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const q = { x: fig[i].x + d[0], y: fig[i].y + d[1] };
      const key = cellKeyOf(q);
      if (occupied.has(key)) continue;
      if (out.some((o) => cellKeyOf(o) === key)) continue;
      out.push(q);
    }
  }
  return out;
}

/** Subtle: one body cell slides to another free lattice site on the figure. */
function perturbSubtle(rng, fig) {
  const idxs = rng.shuffle(fig.map((_, i) => i));
  for (const i of idxs) {
    const spots = freeNeighbours(fig, i);
    if (!spots.length) continue;
    const spot = rng.pick(spots);
    const next = cloneFigure(fig);
    next[i] = { ...next[i], x: spot.x, y: spot.y };
    if (!isRotationOf(fig, next)) return next;
  }
  // Fall back to swapping two differently-labelled components.
  const pairs = [];
  for (let i = 0; i < fig.length; i++) {
    for (let j = i + 1; j < fig.length; j++) {
      if (componentToken(fig[i]) !== componentToken(fig[j])) pairs.push([i, j]);
    }
  }
  for (const [i, j] of rng.shuffle(pairs)) {
    const next = cloneFigure(fig);
    const a = next[i];
    const b = next[j];
    next[i] = { ...b, x: a.x, y: a.y };
    next[j] = { ...a, x: b.x, y: b.y };
    if (!isRotationOf(fig, next)) return next;
  }
  return null;
}

/** Gross: a cell moves and changes identity — visible without any rotation. */
function perturbGross(rng, fig) {
  const idxs = rng.shuffle(fig.map((_, i) => i));
  for (const i of idxs) {
    const spots = freeNeighbours(fig, i);
    if (!spots.length) continue;
    const next = cloneFigure(fig);
    const spot = rng.pick(spots);
    const shape = MARKER_SHAPES.length ? rng.pick(MARKER_SHAPES) : 'square';
    next[i] = {
      shape,
      size: MARKER_SIZE,
      fill: next[i].fill === 'solid' ? 'empty' : 'solid',
      x: spot.x,
      y: spot.y,
      rot: 0
    };
    if (!isRotationOf(fig, next)) return next;
  }
  return perturbSubtle(rng, fig);
}

/* ------------------------------------------------------------------ drawing */

const OPT_BOX = 126;
const PROMPT_BOX = 176;
const BOX_PAD = 9;

function shapeBody(comp, px) {
  const s = comp.size * px;
  const solid = comp.fill === 'solid';
  const paint = solid
    ? { fill: 'currentColor', 'fill-opacity': 0.82, stroke: 'currentColor', 'stroke-width': 1.4 }
    : { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2 };
  const common = { ...paint, 'stroke-linejoin': 'round' };
  switch (comp.shape) {
    case 'circle':
      return el('circle', { cx: 0, cy: 0, r: n2(s / 2), ...common });
    case 'ellipse':
      return el('ellipse', {
        cx: 0,
        cy: 0,
        rx: n2(s / 2),
        ry: n2((s * SHAPE_DEFS.ellipse.aspect) / 2),
        ...common
      });
    case 'rectangle':
      return el('rect', {
        x: n2(-s / 2),
        y: n2((-s * SHAPE_DEFS.rectangle.aspect) / 2),
        width: n2(s),
        height: n2(s * SHAPE_DEFS.rectangle.aspect),
        ...common
      });
    case 'hexagon':
      return el('polygon', { points: regularPoints(6, s / 2, 90), ...common });
    case 'octagon':
      return el('polygon', { points: regularPoints(8, s / 2, 22.5), ...common });
    case 'square':
    default:
      return el('rect', {
        x: n2(-s / 2),
        y: n2(-s / 2),
        width: n2(s),
        height: n2(s),
        ...common
      });
  }
}

function regularPoints(sides, radius, startDeg) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push(`${n2(radius * Math.cos(a))},${n2(radius * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function drawFigure(fig, box, unit) {
  const c = centroidOf(fig);
  const mid = box / 2;
  let body = '';
  for (const comp of fig) {
    const cx = mid + (comp.x - c.x) * unit;
    const cy = mid + (comp.y - c.y) * unit;
    const inner = shapeBody(comp, unit);
    body += el(
      'g',
      { transform: `translate(${n2(cx)} ${n2(cy)}) rotate(${n2(normAngle(comp.rot))})` },
      inner
    );
  }
  return body;
}

function figureSvg(fig, box, unit, className) {
  const body = drawFigure(fig, box, unit);
  return {
    svg: svgRoot({
      width: box,
      height: box,
      viewBox: `0 0 ${box} ${box}`,
      className,
      body
    }),
    width: box,
    height: box
  };
}

/* ------------------------------------------------------------ difficulty plan */

function ruleTypesFor(mix, bothRotated) {
  const types = ['rotation'];
  if (mix !== 'gross') types.push('constancy');
  if (FOIL_MIXES[mix].mirrors > 0) types.push('reflection');
  if (bothRotated) types.push('ruleChaining');
  return types;
}

function salienceFor(mix, disparity, bothRotated) {
  let s = FOIL_MIXES[mix].salience;
  if (disparity === 'eighth') s -= 0.05;
  else if (disparity === 'mixed') s -= 0.03;
  if (bothRotated) s -= 0.03;
  return clampNum(s, 0.03, 0.95);
}

function planMeta(cfg) {
  const types = ruleTypesFor(cfg.mix, cfg.bothRotated);
  const mirrors = FOIL_MIXES[cfg.mix].mirrors > 0 ? 1 : 0;
  return {
    ruleCount: types.length,
    ruleTypes: types,
    abstractness: clampNum(meanOf(types.map((t) => ABSTRACTNESS[t])), 1, 4),
    wmLoad: clampNum(
      Math.max(1, cfg.cells - 3) + mirrors + (cfg.bothRotated ? 1 : 0) + (cfg.variety > 1 ? 1 : 0),
      1,
      6
    ),
    elementCount: cfg.cells,
    perceptualSalience: salienceFor(cfg.mix, cfg.disparity, cfg.bothRotated)
  };
}

/**
 * Difficulty of a candidate plan, from the one difficulty model the rest of the
 * app uses — including this family's offset — so `targetB` means the same thing
 * here as it does downstream.
 */
function predictB(meta) {
  return priorIrtParams(
    { ...meta, distractorSystematicity: 1, optionCount: 8 },
    family
  ).b;
}

function enumeratePlans() {
  const plans = [];
  for (let cells = 3; cells <= 9; cells++) {
    for (let variety = 0; variety <= 2; variety++) {
      for (const disparity of ['quarter', 'eighth', 'mixed']) {
        for (const mix of ['gross', 'perturb', 'mixed', 'mirror']) {
          for (const bothRotated of [false, true]) {
            if (variety >= cells) continue;
            // Trominoes are all achiral, so an unmarked 3-cell figure can never
            // satisfy the chirality requirement.
            if (cells <= 3 && variety === 0) continue;
            const cfg = {
              cells,
              variety,
              disparity,
              mix,
              bothRotated,
              chainStyle: cells <= 6
            };
            cfg.predictedB = predictB(planMeta(cfg));
            plans.push(cfg);
          }
        }
      }
    }
  }
  return plans;
}

const PLANS = enumeratePlans();

/** The closest plans to the requested difficulty, in a randomised order. */
function planPool(rng, targetB) {
  const ranked = PLANS.slice().sort(
    (a, b) => Math.abs(a.predictedB - targetB) - Math.abs(b.predictedB - targetB)
  );
  return rng.shuffle(ranked.slice(0, Math.min(6, ranked.length)));
}

/* ------------------------------------------------------------------ assembly */

function buildFoils(rng, plan, figure, promptRot, answerFigure, needed) {
  const disparities = DISPARITY_SETS[plan.disparity];
  const mirrorTarget = Math.round(needed * FOIL_MIXES[plan.mix].mirrors);
  const accepted = [];
  let mirrorsMade = 0;
  let guard = 0;

  while (accepted.length < needed && guard < 400) {
    guard++;
    const wantMirror = mirrorsMade < mirrorTarget;
    let base = null;
    let kind = 'perturbation';

    if (wantMirror) {
      const source =
        mirrorsMade === 0 ? figure : perturbSubtle(rng, figure) || figure;
      base = mirrorFigure(source);
      kind = 'mirror';
    } else if (FOIL_MIXES[plan.mix].subtle) {
      base = perturbSubtle(rng, figure);
    } else {
      base = perturbGross(rng, figure);
    }
    if (!base) continue;

    const cand = rotateFigure(base, normAngle(promptRot + rng.pick(disparities)));

    // Never a second correct answer, never a duplicate orientation class.
    if (isRotationOf(figure, cand)) continue;
    if (sameFigure(cand, answerFigure)) continue;
    if (accepted.some((f) => isRotationOf(f.figure, cand))) continue;

    accepted.push({ figure: cand, kind });
    if (kind === 'mirror') mirrorsMade++;
  }
  return accepted.length >= needed ? accepted.slice(0, needed) : null;
}

function tryBuild(rng, plan, optionCount) {
  const figure = buildFigure(rng, plan);
  if (!figure) return null;

  const disparities = DISPARITY_SETS[plan.disparity];
  const promptRot = plan.bothRotated ? rng.pick(ANGLES.filter((a) => a !== 0)) : 0;
  const answerRot = normAngle(promptRot + rng.pick(disparities));
  const promptFigure = rotateFigure(figure, promptRot);
  const answerFigure = rotateFigure(figure, answerRot);

  const foils = buildFoils(rng, plan, figure, promptRot, answerFigure, optionCount - 1);
  if (!foils) return null;

  const entries = [{ figure: answerFigure, correct: true, kind: 'target' }].concat(
    foils.map((f) => ({ figure: f.figure, correct: false, kind: f.kind }))
  );

  // Verification: exactly one option is the prompt figure rotated.
  const matches = entries.filter((e) => isRotationOf(promptFigure, e.figure));
  if (matches.length !== 1 || !matches[0].correct) return null;

  return { figure, promptFigure, entries };
}

/* -------------------------------------------------------------------- public */

export function generate(rng, opts) {
  const spec = opts || {};
  const optionCount = normaliseOptionCount(spec.optionCount);
  const targetB = Number.isFinite(spec.targetB) ? spec.targetB : 0.6;
  const wantB = clampNum(targetB, bRange[0] - 0.6, bRange[1] + 0.6);

  const seed = rng.int(1, 2147483647);
  const pool = planPool(rng, wantB);

  let built = null;
  let attempt = 0;
  let plan = pool[0];
  for (; attempt < MAX_ATTEMPTS; attempt++) {
    // Stay on one plan for a run of attempts, then fall back to the next
    // nearest plan rather than failing outright.
    plan = pool[Math.floor(attempt / 10) % pool.length];
    built = tryBuild(rng.fork(`rot:${seed}:${attempt}`), plan, optionCount);
    if (built) break;
  }
  if (!built) {
    throw new Error('mentalRotation: no valid item after ' + MAX_ATTEMPTS + ' attempts');
  }

  // One scale for every panel so size can never be a cue.
  let radius = figureRadius(built.promptFigure);
  for (const e of built.entries) radius = Math.max(radius, figureRadius(e.figure));
  const unit = (OPT_BOX / 2 - BOX_PAD) / Math.max(radius, 0.5);

  const shuffled = rng.shuffle(built.entries);
  const options = [];
  let answerId = 'o0';
  for (let i = 0; i < shuffled.length; i++) {
    const id = `o${i}`;
    const drawn = figureSvg(shuffled[i].figure, OPT_BOX, unit, 'item-rotation-option');
    options.push({ id, svg: drawn.svg, width: drawn.width, height: drawn.height });
    if (shuffled[i].correct) answerId = id;
  }

  const prompt = figureSvg(built.promptFigure, PROMPT_BOX, unit, 'item-rotation-prompt');

  const foilEntries = built.entries.filter((e) => !e.correct);
  const mirrorCount = foilEntries.filter((e) => e.kind === 'mirror').length;
  const ruleTypes = ruleTypesFor(plan.mix, plan.bothRotated);
  const meta = planMeta(plan);

  const variant =
    plan.cells * 1000 +
    plan.variety * 100 +
    (plan.bothRotated ? 50 : 0) +
    ['gross', 'perturb', 'mixed', 'mirror'].indexOf(plan.mix) * 10 +
    (attempt % 10);

  return {
    id: `${family}:${seed}:${variant}`,
    family,
    seed,
    prompt,
    options,
    answerId,
    meta: {
      ruleCount: ruleTypes.length,
      ruleTypes,
      abstractness: meta.abstractness,
      elementCount: built.figure.length,
      // Mirrors and structured perturbations are both systematic constructions:
      // a partial grasp of the rotation lands on one of them, never on the key.
      distractorSystematicity: 1,
      wmLoad: meta.wmLoad,
      perceptualSalience: clampNum(
        meta.perceptualSalience -
          0.04 * (foilEntries.length ? mirrorCount / foilEntries.length : 0),
        0.03,
        0.95
      ),
      optionCount,
      generatorVersion: GENERATOR_VERSION
    },
    irt: null
  };
}
