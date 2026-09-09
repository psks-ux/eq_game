/**
 * The training curriculum: drill metadata, the 72-level ladder (6 tiers x 12 levels),
 * unlock rules, progress roll-ups and the per-tier factor targets used by the radar.
 * Pure data and pure functions - no DOM, no randomness, no clock.
 */

/** The six fluid-intelligence factors the curriculum trains. Order is display order. */
const FACTOR_KEYS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];

/** Content groups, matching the item-registry `contentGroup` vocabulary. */
const GROUP_KEYS = ['induction', 'spatial', 'relational', 'constraint'];

/**
 * Rule families a drill is allowed to draw on (mirrors CONTRACTS 1.3). Kept here so the
 * curriculum can hand each drill a widening, culture-safe rule budget as tiers rise.
 */
const ALLOWED_RULE_FAMILIES = [
  'constancy', 'progression', 'distributionOfThree', 'rotation', 'reflection', 'translation',
  'overlayUnion', 'overlayIntersection', 'overlayDifference', 'overlayExclusive',
  'containment', 'quantityProgression', 'sizeOrdering', 'symmetryCompletion',
  'sequenceAlternation', 'attributeSwap', 'ruleChaining'
];

const TIER_COUNT = 6;
const LEVELS_PER_TIER = 12;
const TOTAL_LEVELS = TIER_COUNT * LEVELS_PER_TIER; // 72
const STARS_PER_LEVEL = 3;

/** Stars that must be earned in tier N-1 before tier N's first level opens. */
const STARS_TO_ADVANCE = 8;

/** Pass bar per tier. Higher tiers are HARDER, not merely longer. */
const TIER_ACCURACY = [0.72, 0.75, 0.78, 0.81, 0.83, 0.85];
/** Trials per session per tier - rises modestly so sessions stay under ~15 minutes. */
const TIER_TRIALS = [16, 18, 21, 24, 27, 30];

/** Hard ceiling on a single session, whatever the arithmetic below produces. */
const MAX_SESSION_MS = 900000;

/**
 * Option counts for the multiple-choice drills, indexed by the level's rank within its
 * factor (0..11). Six options early, eight later: fewer options means more guessing
 * variance, which is fine while the learner is finding the rule and not fine later.
 * Values stay in {6, 8} to match the item contract (CONTRACTS section 9).
 */
const OPTIONS_BY_RANK = [6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 8];

/**
 * Monotonicity contract for `params`, asserted in test/curriculum.test.js:
 * within one drill, every numeric parameter moves in a single direction as `order`
 * rises. Keys named here get HARDER as they get SMALLER (time budgets, exposure and
 * inter-stimulus durations); every other numeric key gets harder as it gets LARGER.
 */
const DESCENDING_PARAMS = ['timeLimitMs', 'isiMs', 'presentMs', 'stimulusMs', 'exposureMs', 'cueMs'];

/**
 * Duration keys are DRILL-SCOPED, not factor-scoped: a corsi recall window and an n-back
 * response window are both `timeLimitMs` but they are not the same quantity, so their
 * raw milliseconds are not comparable across two drills that happen to train the same
 * factor. Escalation across a whole factor is therefore carried by the drill-independent
 * knobs (`startLevel`, `expectedLevel`, `levelMax`, `trials`, `optionCount`,
 * `responseCount`) which ARE comparable and ARE monotone; the durations are asserted
 * monotone within each drill and within each (tier, factor) pair instead. Forcing the raw
 * durations monotone across a factor would mean giving corsi a 2.6-second recall window,
 * which is not a harder task, only an impossible one.
 */
const FACTOR_SCOPED_PARAMS = [
  'trials', 'startLevel', 'expectedLevel', 'levelMin', 'levelMax', 'levelStep',
  'optionCount', 'responseCount'
];

/**
 * Drill registry metadata. `factor` is the fluid-intelligence factor the drill scores
 * into; `group` is the stimulus content group; `minTier` is the lowest tier the drill
 * may appear in (later drills need a rule vocabulary earned in earlier tiers).
 */
export const DRILLS = [
  { id: 'matrixForge', factor: 'induction', group: 'induction', minTier: 0 },
  { id: 'ruleMiner', factor: 'induction', group: 'induction', minTier: 1 },
  { id: 'nback', factor: 'workingMemory', group: 'relational', minTier: 0 },
  { id: 'corsi', factor: 'workingMemory', group: 'spatial', minTier: 0 },
  { id: 'mentalRotation', factor: 'spatial', group: 'spatial', minTier: 0 },
  { id: 'paperFolding', factor: 'spatial', group: 'spatial', minTier: 0 },
  { id: 'relationalIntegration', factor: 'relational', group: 'relational', minTier: 0 },
  { id: 'setShifting', factor: 'flexibility', group: 'constraint', minTier: 1 },
  { id: 'sequenceExtrapolation', factor: 'induction', group: 'induction', minTier: 0 },
  { id: 'oddOneOut', factor: 'relational', group: 'induction', minTier: 0 },
  { id: 'constraintGrid', factor: 'relational', group: 'constraint', minTier: 1 },
  { id: 'flankerControl', factor: 'flexibility', group: 'constraint', minTier: 0 },
  { id: 'speedDiscrimination', factor: 'speed', group: 'spatial', minTier: 0 }
];

const DRILL_BY_ID = new Map(DRILLS.map((d) => [d.id, d]));

/** Drills whose trials present an option grid, and therefore take `optionCount`. */
const OPTION_DRILLS = new Set([
  'matrixForge', 'ruleMiner', 'sequenceExtrapolation',
  'mentalRotation', 'paperFolding', 'relationalIntegration', 'constraintGrid'
]);

/**
 * Which factor each of the twelve slots in a tier trains. Every factor appears twice,
 * so every tier covers all six. Slots 0-5 are the tier's first pass, 6-11 the second.
 */
const SLOT_FACTORS = [
  'induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility',
  'induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'
];

/**
 * The explicit curriculum table: 6 tiers x 12 slots of drill ids, in slot order.
 * Column k and column k+6 are the same factor, so the pair inside a tier escalates.
 * Induction rotates over three drills; the gated drills (ruleMiner, constraintGrid,
 * setShifting) only appear from tier 1, so tier 0 doubles up on the simpler partner.
 * Slot 11 is always the tier capstone.
 */
const TIER_PLAN = [
  // tier 0 - entry (index 100-114)
  ['matrixForge', 'paperFolding', 'corsi', 'relationalIntegration', 'speedDiscrimination', 'flankerControl',
    'sequenceExtrapolation', 'mentalRotation', 'nback', 'oddOneOut', 'speedDiscrimination', 'flankerControl'],
  // tier 1 - strong (115-129)
  ['matrixForge', 'paperFolding', 'corsi', 'constraintGrid', 'speedDiscrimination', 'flankerControl',
    'ruleMiner', 'mentalRotation', 'nback', 'relationalIntegration', 'speedDiscrimination', 'setShifting'],
  // tier 2 - advanced (130-144)
  ['ruleMiner', 'paperFolding', 'corsi', 'constraintGrid', 'speedDiscrimination', 'flankerControl',
    'sequenceExtrapolation', 'mentalRotation', 'nback', 'oddOneOut', 'speedDiscrimination', 'setShifting'],
  // tier 3 - exceptional (145-159)
  ['matrixForge', 'paperFolding', 'corsi', 'constraintGrid', 'speedDiscrimination', 'flankerControl',
    'ruleMiner', 'mentalRotation', 'nback', 'relationalIntegration', 'speedDiscrimination', 'setShifting'],
  // tier 4 - elite (160-179)
  ['ruleMiner', 'paperFolding', 'corsi', 'constraintGrid', 'speedDiscrimination', 'flankerControl',
    'sequenceExtrapolation', 'mentalRotation', 'nback', 'oddOneOut', 'speedDiscrimination', 'setShifting'],
  // tier 5 - apex (180-200)
  ['matrixForge', 'paperFolding', 'corsi', 'constraintGrid', 'speedDiscrimination', 'flankerControl',
    'ruleMiner', 'mentalRotation', 'nback', 'relationalIntegration', 'speedDiscrimination', 'setShifting']
];

/**
 * Per-drill escalation tables, indexed by the drill's occurrence in the ladder (0-based,
 * in `order` sequence). Each row is the drill-specific half of `Level.params`; the
 * generic half (trials, startLevel, level bounds, optionCount) is computed in
 * `buildLevels`. Every numeric column is monotone in the direction given by
 * DESCENDING_PARAMS - that is the escalation guarantee the tests enforce.
 */
const DRILL_STEPS = {
  // 4 occurrences (tiers 0, 1, 3, 5). ruleCount 2 -> 5 is the core difficulty knob.
  matrixForge: [
    { gridSize: 3, ruleCount: 2, ruleDimensions: 2, distractorSystematicity: 0.70, timeLimitMs: 45000, ruleFamilies: ['constancy', 'progression', 'distributionOfThree'] },
    { gridSize: 3, ruleCount: 3, ruleDimensions: 2, distractorSystematicity: 0.78, timeLimitMs: 41000, ruleFamilies: ['constancy', 'progression', 'distributionOfThree', 'rotation', 'quantityProgression'] },
    { gridSize: 3, ruleCount: 4, ruleDimensions: 3, distractorSystematicity: 0.86, timeLimitMs: 37000, ruleFamilies: ['progression', 'distributionOfThree', 'rotation', 'reflection', 'sizeOrdering', 'sequenceAlternation'] },
    { gridSize: 4, ruleCount: 5, ruleDimensions: 4, distractorSystematicity: 0.92, timeLimitMs: 33000, ruleFamilies: ['progression', 'distributionOfThree', 'rotation', 'reflection', 'overlayUnion', 'overlayExclusive', 'attributeSwap', 'ruleChaining'] }
  ],
  // 5 occurrences (tiers 1-5). Infer the rule from worked examples, then transfer it.
  ruleMiner: [
    { hiddenRules: 2, exampleCount: 3, transferSteps: 1, foilSubtlety: 0.35, timeLimitMs: 40000, ruleFamilies: ['constancy', 'progression', 'translation'] },
    { hiddenRules: 2, exampleCount: 3, transferSteps: 2, foilSubtlety: 0.45, timeLimitMs: 38000, ruleFamilies: ['constancy', 'progression', 'translation', 'rotation'] },
    { hiddenRules: 3, exampleCount: 3, transferSteps: 2, foilSubtlety: 0.55, timeLimitMs: 35000, ruleFamilies: ['progression', 'translation', 'rotation', 'containment', 'attributeSwap'] },
    { hiddenRules: 3, exampleCount: 3, transferSteps: 3, foilSubtlety: 0.62, timeLimitMs: 33000, ruleFamilies: ['progression', 'rotation', 'containment', 'attributeSwap', 'overlayDifference', 'sizeOrdering'] },
    { hiddenRules: 4, exampleCount: 3, transferSteps: 3, foilSubtlety: 0.70, timeLimitMs: 30000, ruleFamilies: ['progression', 'rotation', 'containment', 'attributeSwap', 'overlayDifference', 'overlayIntersection', 'ruleChaining'] }
  ],
  // 3 occurrences (tiers 0, 2, 4). Elements sit on a geometric track - never an arrow.
  sequenceExtrapolation: [
    { sequenceLength: 4, activeRules: 1, extrapolationSteps: 1, trackCurvature: 0, timeLimitMs: 30000, ruleFamilies: ['progression', 'translation'] },
    { sequenceLength: 5, activeRules: 2, extrapolationSteps: 1, trackCurvature: 1, timeLimitMs: 27000, ruleFamilies: ['progression', 'translation', 'rotation', 'sequenceAlternation'] },
    { sequenceLength: 6, activeRules: 3, extrapolationSteps: 2, trackCurvature: 2, timeLimitMs: 24000, ruleFamilies: ['progression', 'translation', 'rotation', 'sequenceAlternation', 'quantityProgression', 'sizeOrdering'] }
  ],
  // 6 occurrences, one per tier. Folds and punches drive the imagined-transform load.
  paperFolding: [
    { folds: 1, punches: 1, mirrorFoils: 1, unfoldSteps: 1, timeLimitMs: 30000 },
    { folds: 2, punches: 1, mirrorFoils: 1, unfoldSteps: 2, timeLimitMs: 28000 },
    { folds: 2, punches: 2, mirrorFoils: 2, unfoldSteps: 2, timeLimitMs: 26000 },
    { folds: 3, punches: 2, mirrorFoils: 2, unfoldSteps: 3, timeLimitMs: 24000 },
    { folds: 3, punches: 3, mirrorFoils: 3, unfoldSteps: 3, timeLimitMs: 22000 },
    { folds: 4, punches: 3, mirrorFoils: 3, unfoldSteps: 4, timeLimitMs: 20000 }
  ],
  // 6 occurrences. Angular disparity 45 -> 180 degrees, and mirror foils get commoner,
  // which is what forces real rotation instead of feature matching.
  mentalRotation: [
    { maxDisparityDeg: 45, axes: 1, mirrorFoilP: 0.15, shapeComplexity: 1, timeLimitMs: 20000 },
    { maxDisparityDeg: 75, axes: 1, mirrorFoilP: 0.25, shapeComplexity: 2, timeLimitMs: 18500 },
    { maxDisparityDeg: 105, axes: 1, mirrorFoilP: 0.35, shapeComplexity: 2, timeLimitMs: 17000 },
    { maxDisparityDeg: 135, axes: 2, mirrorFoilP: 0.45, shapeComplexity: 3, timeLimitMs: 15500 },
    { maxDisparityDeg: 165, axes: 2, mirrorFoilP: 0.55, shapeComplexity: 3, timeLimitMs: 14000 },
    { maxDisparityDeg: 180, axes: 2, mirrorFoilP: 0.60, shapeComplexity: 4, timeLimitMs: 12500 }
  ],
  // 6 occurrences. Span 4 -> 9, with reverse-order recall folded in from tier 2.
  corsi: [
    { span: 4, presentMs: 900, gridCells: 9, reverseP: 0.00, timeLimitMs: 30000 },
    { span: 5, presentMs: 850, gridCells: 9, reverseP: 0.00, timeLimitMs: 28000 },
    { span: 6, presentMs: 800, gridCells: 12, reverseP: 0.25, timeLimitMs: 27000 },
    { span: 7, presentMs: 750, gridCells: 12, reverseP: 0.40, timeLimitMs: 26000 },
    { span: 8, presentMs: 700, gridCells: 16, reverseP: 0.50, timeLimitMs: 25000 },
    { span: 9, presentMs: 650, gridCells: 16, reverseP: 0.60, timeLimitMs: 24000 }
  ],
  // 6 occurrences. n 2 -> 5, lures rise, and the stream goes dual-modality at tier 3.
  // `targetRate` sits near 0.4-0.45 rather than the textbook 0.25-0.30 for a reason: this
  // is a go/no-go task, so a learner who simply never responds scores (1 - targetRate) by
  // base rate alone. At 0.30 that passive strategy scores 0.70 against a tier-0 pass bar
  // of 0.72 - inside sampling noise on a 16-trial session, i.e. a level you can pass by
  // not playing. Keeping targetRate >= 0.40 puts the passive ceiling at 0.60, a clear
  // twelve points below the easiest pass bar. See `assertNoFreeRide` below.
  nback: [
    { n: 2, stimulusMs: 2000, isiMs: 1000, lureRate: 0.10, targetRate: 0.40, streamModality: 1, responseCount: 2, timeLimitMs: 2600 },
    { n: 2, stimulusMs: 1800, isiMs: 900, lureRate: 0.18, targetRate: 0.41, streamModality: 1, responseCount: 2, timeLimitMs: 2400 },
    { n: 3, stimulusMs: 1700, isiMs: 800, lureRate: 0.24, targetRate: 0.42, streamModality: 1, responseCount: 2, timeLimitMs: 2200 },
    { n: 3, stimulusMs: 1600, isiMs: 700, lureRate: 0.30, targetRate: 0.43, streamModality: 2, responseCount: 2, timeLimitMs: 2100 },
    { n: 4, stimulusMs: 1500, isiMs: 600, lureRate: 0.34, targetRate: 0.44, streamModality: 2, responseCount: 2, timeLimitMs: 2000 },
    { n: 5, stimulusMs: 1400, isiMs: 500, lureRate: 0.38, targetRate: 0.45, streamModality: 2, responseCount: 2, timeLimitMs: 1900 }
  ],
  // 4 occurrences (tiers 0, 1, 3, 5). Relations to integrate at once, 2 -> 5.
  relationalIntegration: [
    { relations: 2, premises: 2, dimensions: 1, integrationDepth: 1, timeLimitMs: 26000 },
    { relations: 3, premises: 3, dimensions: 2, integrationDepth: 2, timeLimitMs: 24000 },
    { relations: 4, premises: 4, dimensions: 2, integrationDepth: 3, timeLimitMs: 22000 },
    { relations: 5, premises: 5, dimensions: 3, integrationDepth: 4, timeLimitMs: 20000 }
  ],
  // 5 occurrences (tiers 1-5). Deduction depth 2 -> 5 chained constraints.
  constraintGrid: [
    { gridSize: 3, constraints: 3, deductionDepth: 2, glyphsPerCell: 1, timeLimitMs: 45000 },
    { gridSize: 3, constraints: 4, deductionDepth: 3, glyphsPerCell: 1, timeLimitMs: 42000 },
    { gridSize: 4, constraints: 5, deductionDepth: 3, glyphsPerCell: 2, timeLimitMs: 39000 },
    { gridSize: 4, constraints: 6, deductionDepth: 4, glyphsPerCell: 2, timeLimitMs: 36000 },
    { gridSize: 5, constraints: 7, deductionDepth: 5, glyphsPerCell: 2, timeLimitMs: 33000 }
  ],
  // 3 occurrences (tiers 0, 2, 4). salienceConflict is the fraction of items where the
  // eye-catching grouping is the wrong one - the whole point of the drill.
  oddOneOut: [
    { setSize: 5, ruleDimensions: 1, salienceConflict: 0.15, sharedFeatures: 1, timeLimitMs: 11000, ruleFamilies: ['constancy', 'distributionOfThree', 'sizeOrdering'] },
    { setSize: 6, ruleDimensions: 2, salienceConflict: 0.40, sharedFeatures: 2, timeLimitMs: 9500, ruleFamilies: ['constancy', 'distributionOfThree', 'sizeOrdering', 'symmetryCompletion', 'containment'] },
    { setSize: 8, ruleDimensions: 3, salienceConflict: 0.65, sharedFeatures: 3, timeLimitMs: 8000, ruleFamilies: ['distributionOfThree', 'sizeOrdering', 'symmetryCompletion', 'containment', 'rotation', 'reflection', 'attributeSwap'] }
  ],
  // 5 occurrences (tiers 1-5), always the tier capstone. Switch rate 0.25 -> 0.65.
  setShifting: [
    { activeRules: 2, switchRate: 0.25, cueMs: 500, responseCount: 2, timeLimitMs: 2600 },
    { activeRules: 2, switchRate: 0.35, cueMs: 400, responseCount: 3, timeLimitMs: 2400 },
    { activeRules: 3, switchRate: 0.45, cueMs: 350, responseCount: 3, timeLimitMs: 2200 },
    { activeRules: 3, switchRate: 0.55, cueMs: 300, responseCount: 4, timeLimitMs: 2000 },
    { activeRules: 4, switchRate: 0.65, cueMs: 250, responseCount: 4, timeLimitMs: 1800 }
  ],
  // 7 occurrences (twice in tier 0, once per tier after). More flankers, more conflict
  // trials, a shorter gap before the next one. `timeLimitMs` is the response deadline,
  // not the target reaction time - the staircase is what applies real speed pressure.
  flankerControl: [
    { flankerCount: 2, incongruentRate: 0.30, orientationSteps: 2, responseCount: 2, isiMs: 900, timeLimitMs: 3000 },
    { flankerCount: 2, incongruentRate: 0.35, orientationSteps: 2, responseCount: 2, isiMs: 850, timeLimitMs: 2850 },
    { flankerCount: 4, incongruentRate: 0.40, orientationSteps: 2, responseCount: 2, isiMs: 800, timeLimitMs: 2700 },
    { flankerCount: 4, incongruentRate: 0.45, orientationSteps: 3, responseCount: 2, isiMs: 750, timeLimitMs: 2550 },
    { flankerCount: 4, incongruentRate: 0.50, orientationSteps: 3, responseCount: 3, isiMs: 700, timeLimitMs: 2400 },
    { flankerCount: 6, incongruentRate: 0.55, orientationSteps: 3, responseCount: 3, isiMs: 650, timeLimitMs: 2250 },
    { flankerCount: 6, incongruentRate: 0.60, orientationSteps: 4, responseCount: 4, isiMs: 600, timeLimitMs: 2100 }
  ],
  // 12 occurrences - the only drill on the speed factor, so it fills both slots of every
  // tier. Finer differences, shorter exposure, tighter deadline, every rung.
  speedDiscrimination: [
    { featureCount: 1, discriminationStep: 1, exposureMs: 700, responseCount: 2, timeLimitMs: 1600 },
    { featureCount: 1, discriminationStep: 2, exposureMs: 660, responseCount: 2, timeLimitMs: 1550 },
    { featureCount: 1, discriminationStep: 3, exposureMs: 620, responseCount: 2, timeLimitMs: 1500 },
    { featureCount: 1, discriminationStep: 4, exposureMs: 580, responseCount: 2, timeLimitMs: 1450 },
    { featureCount: 2, discriminationStep: 5, exposureMs: 540, responseCount: 2, timeLimitMs: 1400 },
    { featureCount: 2, discriminationStep: 6, exposureMs: 500, responseCount: 2, timeLimitMs: 1330 },
    { featureCount: 2, discriminationStep: 7, exposureMs: 460, responseCount: 3, timeLimitMs: 1260 },
    { featureCount: 2, discriminationStep: 8, exposureMs: 420, responseCount: 3, timeLimitMs: 1190 },
    { featureCount: 3, discriminationStep: 9, exposureMs: 380, responseCount: 3, timeLimitMs: 1120 },
    { featureCount: 3, discriminationStep: 10, exposureMs: 340, responseCount: 3, timeLimitMs: 1050 },
    { featureCount: 3, discriminationStep: 11, exposureMs: 300, responseCount: 3, timeLimitMs: 980 },
    { featureCount: 3, discriminationStep: 12, exposureMs: 260, responseCount: 3, timeLimitMs: 900 }
  ]
};

function round2(x) {
  return Math.round(x * 100) / 100;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function clampNum(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function levelIdFor(order) {
  return `L${String(order).padStart(2, '0')}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/**
 * Build the ladder from the tables above. Deterministic and total: no rng, no clock.
 *
 * Rank = the level's index within its factor (0..11). It drives the generic escalation
 * (staircase start level, option count) so that a factor's difficulty rises smoothly
 * even as the ladder rotates between the two or three drills that train it.
 */
function buildLevels() {
  const levels = [];
  const occurrence = new Map();
  const lastParamsByDrill = new Map();

  for (let tier = 0; tier < TIER_COUNT; tier++) {
    for (let slot = 0; slot < LEVELS_PER_TIER; slot++) {
      const order = tier * LEVELS_PER_TIER + slot + 1;
      const id = levelIdFor(order);
      const drill = TIER_PLAN[tier][slot];
      const def = DRILL_BY_ID.get(drill);
      const factor = SLOT_FACTORS[slot];
      const rank = tier * 2 + (slot < 6 ? 0 : 1);
      const occ = occurrence.get(drill) || 0;
      occurrence.set(drill, occ + 1);

      const steps = DRILL_STEPS[drill];
      const step = steps[Math.min(occ, steps.length - 1)];

      const trials = TIER_TRIALS[tier];
      const accuracy = TIER_ACCURACY[tier];
      const startLevel = 1 + rank;               // 1..12 across a factor's twelve levels
      const expectedLevel = startLevel + 2;      // the staircase level a solid run reaches
      const timeLimitMs = step.timeLimitMs;

      const core = {
        trials,
        startLevel,
        expectedLevel,
        levelMin: 1,
        levelMax: startLevel + 8,
        levelStep: 1
      };
      for (const key of Object.keys(step)) {
        core[key] = Array.isArray(step[key]) ? step[key].slice() : step[key];
      }
      if (OPTION_DRILLS.has(drill)) core.optionCount = OPTIONS_BY_RANK[rank];

      // Every twelfth level is a capstone: a mixed challenge that samples one drill per
      // factor from this tier, its own drill first. `mixParams` carries each sampled
      // drill's own most recent parameters so the mix is not run on the wrong knobs.
      const capstone = order % LEVELS_PER_TIER === 0;
      let params = core;
      if (capstone) {
        const mixDrills = [];
        for (const candidate of [drill].concat(TIER_PLAN[tier].slice(0, 6))) {
          if (!mixDrills.includes(candidate)) mixDrills.push(candidate);
        }
        const mixParams = {};
        for (const mixId of mixDrills) {
          mixParams[mixId] = mixId === drill ? core : (lastParamsByDrill.get(mixId) || core);
        }
        params = Object.assign({}, core, { mixDrills, mixParams });
      }
      lastParamsByDrill.set(drill, core);

      const perTrialMs = Math.round(0.8 * timeLimitMs + 1500);
      const goal = {
        trials,
        accuracy,
        maxMs: Math.min(MAX_SESSION_MS, trials * perTrialMs),
        minLevel: startLevel
      };

      // Three star bands: the pass bar, a clean run, and a fast clean run above pace.
      const stars = [
        { accuracy: round2(accuracy) },
        { accuracy: round2(Math.min(0.90, accuracy + 0.07)), minLevel: startLevel + 1 },
        {
          accuracy: round2(Math.min(0.95, accuracy + 0.13)),
          minLevel: startLevel + 2,
          maxMsPerTrial: Math.round(0.55 * timeLimitMs) + 400
        }
      ];

      // Unlock: the previous level in this tier, or - for a tier's first level - enough
      // stars in the tier below AND a measured index that reaches this tier.
      const unlock = slot === 0
        ? {
          requires: [],
          minTier: tier,
          starsInTier: tier === 0 ? null : { tier: tier - 1, stars: STARS_TO_ADVANCE }
        }
        : { requires: [levelIdFor(order - 1)], minTier: tier, starsInTier: null };

      levels.push({
        id,
        tier,
        order,
        drill,
        factor,
        group: def.group,
        capstone,
        params,
        goal,
        stars,
        unlock
      });
    }
  }
  return levels;
}

/**
 * The accuracy a learner with no skill at all can reach on this level, by exploiting the
 * response structure rather than the stimulus: withholding every response on a go/no-go
 * stream scores `1 - targetRate`, answering every one scores `targetRate`, and blind
 * guessing on a forced choice scores `1 / optionCount`. A level whose pass bar sits at or
 * below that number can be passed by not playing, which would make the whole ladder a lie.
 */
const FREE_RIDE_MARGIN = 0.10;

function noSkillBaseline(params) {
  let worst = 0;
  const target = Number(params.targetRate);
  if (Number.isFinite(target) && target > 0 && target < 1) {
    worst = Math.max(worst, target, 1 - target);
  }
  for (const key of ['optionCount', 'responseCount']) {
    const k = Number(params[key]);
    if (Number.isFinite(k) && k >= 2) worst = Math.max(worst, 1 / k);
  }
  return worst;
}

/**
 * Fail loudly at load time if the tables above ever drift out of the vocabularies the
 * rest of the app relies on. Cheap (once, 72 levels) and it turns a silent content bug
 * into an immediate, locatable error.
 */
function validateTables(levels) {
  const factors = new Set(FACTOR_KEYS);
  const groups = new Set(GROUP_KEYS);
  const rules = new Set(ALLOWED_RULE_FAMILIES);
  for (const def of DRILLS) {
    if (!factors.has(def.factor)) throw new Error(`curriculum: drill ${def.id} has unknown factor ${def.factor}`);
    if (!groups.has(def.group)) throw new Error(`curriculum: drill ${def.id} has unknown group ${def.group}`);
    if (!Array.isArray(DRILL_STEPS[def.id]) || DRILL_STEPS[def.id].length === 0) {
      throw new Error(`curriculum: drill ${def.id} has no escalation table`);
    }
  }
  for (const lv of levels) {
    const def = DRILL_BY_ID.get(lv.drill);
    if (!def) throw new Error(`curriculum: level ${lv.id} uses unknown drill ${lv.drill}`);
    if (def.factor !== lv.factor) throw new Error(`curriculum: level ${lv.id} factor does not match drill ${lv.drill}`);
    if (def.minTier > lv.tier) throw new Error(`curriculum: level ${lv.id} uses drill ${lv.drill} below its minTier`);
    const fams = lv.params.ruleFamilies;
    if (fams) {
      for (const fam of fams) {
        if (!rules.has(fam)) throw new Error(`curriculum: level ${lv.id} uses forbidden rule family ${fam}`);
      }
    }
    const floor = noSkillBaseline(lv.params);
    if (lv.goal.accuracy < floor + FREE_RIDE_MARGIN) {
      throw new Error(
        `curriculum: level ${lv.id} can be passed without playing - pass bar ${lv.goal.accuracy} `
        + `vs no-skill baseline ${round2(floor)}`
      );
    }
  }

  // The drill-independent knobs must rise across a whole factor, not merely within one
  // drill: that is what makes a factor's twelve levels a ladder rather than three
  // unrelated ladders interleaved. Duration keys are excluded on purpose - see the
  // FACTOR_SCOPED_PARAMS comment for why milliseconds are not comparable across drills.
  for (const factor of FACTOR_KEYS) {
    const run = levels.filter((lv) => lv.factor === factor);
    for (let i = 1; i < run.length; i++) {
      for (const key of FACTOR_SCOPED_PARAMS) {
        const a = run[i - 1].params[key];
        const b = run[i].params[key];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        if (b < a) {
          throw new Error(
            `curriculum: ${factor} regresses on ${key} from ${run[i - 1].id} (${a}) to ${run[i].id} (${b})`
          );
        }
      }
    }
  }
  return levels;
}

/** The ordered 72-level ladder. Frozen: it is shared, read-only application data. */
export const LEVELS = deepFreeze(validateTables(buildLevels()));

deepFreeze(DRILLS);

const LEVEL_BY_ID = new Map(LEVELS.map((lv) => [lv.id, lv]));

/** Levels belonging to one tier, in order. Unknown tiers yield an empty array. */
export function levelsForTier(tier) {
  const t = Number(tier);
  if (!Number.isInteger(t) || t < 0 || t >= TIER_COUNT) return [];
  return LEVELS.filter((lv) => lv.tier === t);
}

/** Look up a level by id. Returns null when the id is unknown. */
export function levelById(id) {
  if (typeof id !== 'string') return null;
  return LEVEL_BY_ID.get(id) || null;
}

/** Coerce anything the caller hands us into the fields the unlock rules need. */
function readProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const levels = p.levels && typeof p.levels === 'object' ? p.levels : {};
  const tierRaw = Number(p.tier);
  return {
    status: typeof p.status === 'string' ? p.status : 'new',
    tier: Number.isFinite(tierRaw) ? Math.floor(tierRaw) : 0,
    levels
  };
}

function starsOf(state, levelId) {
  const rec = state.levels[levelId];
  if (!rec || typeof rec !== 'object') return 0;
  const s = Number(rec.stars);
  if (!Number.isFinite(s)) return 0;
  return clampNum(Math.floor(s), 0, STARS_PER_LEVEL);
}

function isPassed(state, levelId) {
  return starsOf(state, levelId) >= 1;
}

function starsByTier(state) {
  const totals = new Array(TIER_COUNT).fill(0);
  for (const lv of LEVELS) totals[lv.tier] += starsOf(state, lv.id);
  return totals;
}

function unlockOk(level, state, tierStars) {
  if (state.tier < level.unlock.minTier) return false;
  const rec = state.levels[level.id];
  if (rec && rec.unlocked === true) return true;
  for (const req of level.unlock.requires) {
    if (!isPassed(state, req)) return false;
  }
  const gate = level.unlock.starsInTier;
  if (gate && (tierStars[gate.tier] || 0) < gate.stars) return false;
  return true;
}

/**
 * Every level the profile may currently play, in ladder order.
 * An eliminated profile has no training at all - that is the product rule.
 */
export function unlockedLevels(profile) {
  const state = readProfile(profile);
  if (state.status === 'eliminated') return [];
  const tierStars = starsByTier(state);
  return LEVELS.filter((lv) => unlockOk(lv, state, tierStars));
}

/** The first unlocked level that has not been passed yet, or null when there is none. */
export function nextLevel(profile) {
  const state = readProfile(profile);
  if (state.status === 'eliminated') return null;
  const tierStars = starsByTier(state);
  for (const lv of LEVELS) {
    if (!unlockOk(lv, state, tierStars)) continue;
    if (!isPassed(state, lv.id)) return lv;
  }
  return null;
}

/**
 * Roll-up for the progress screen. `percent` is star completion (0-100), which is a
 * fairer picture than levels passed because it rewards quality, not just attendance.
 */
export function progressSummary(profile) {
  const state = readProfile(profile);
  const tierStars = starsByTier(state);
  const eliminated = state.status === 'eliminated';

  const byFactor = {};
  for (const key of FACTOR_KEYS) byFactor[key] = { passed: 0, total: 0, stars: 0 };

  const byTier = [];
  for (let t = 0; t < TIER_COUNT; t++) {
    byTier.push({ tier: t, total: 0, unlocked: 0, passed: 0, stars: 0, maxStars: 0, percent: 0 });
  }

  let unlocked = 0;
  let passed = 0;
  let stars = 0;

  for (const lv of LEVELS) {
    const s = starsOf(state, lv.id);
    const done = s >= 1;
    const open = !eliminated && unlockOk(lv, state, tierStars);

    stars += s;
    if (done) passed += 1;
    if (open) unlocked += 1;

    const f = byFactor[lv.factor];
    f.total += 1;
    f.stars += s;
    if (done) f.passed += 1;

    const row = byTier[lv.tier];
    row.total += 1;
    row.stars += s;
    row.maxStars += STARS_PER_LEVEL;
    if (done) row.passed += 1;
    if (open) row.unlocked += 1;
  }

  for (const row of byTier) {
    row.percent = row.maxStars === 0 ? 0 : round1((100 * row.stars) / row.maxStars);
  }

  const maxStars = LEVELS.length * STARS_PER_LEVEL;
  return {
    totalLevels: LEVELS.length,
    unlocked,
    passed,
    stars,
    maxStars,
    byFactor,
    byTier,
    percent: maxStars === 0 ? 0 : round1((100 * stars) / maxStars)
  };
}

/**
 * Per-factor performance targets for the progress radar, on the same 0-100 scale as
 * `profile.factorScores`. The base rises 11 points per tier; the emphasis offsets say
 * where a person at that tier should be strongest - induction and relational reasoning
 * carry the most fluid-intelligence variance, raw speed the least.
 * These are training targets, not ability estimates.
 */
export function factorTargets(tier) {
  const t = Number(tier);
  const clamped = Number.isFinite(t) ? clampNum(Math.floor(t), 0, TIER_COUNT - 1) : 0;
  const base = 34 + clamped * 11;
  const emphasis = {
    induction: 5,
    relational: 3,
    workingMemory: 1,
    spatial: 0,
    flexibility: -2,
    speed: -4
  };
  const out = {};
  for (const key of FACTOR_KEYS) out[key] = clampNum(Math.round(base + emphasis[key]), 0, 100);
  return out;
}
