/* Exercises every drill engine and the drill session end to end: trial generation,
   grading, termination, culture-fairness of the stimuli, and determinism. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/core/rng.js';
import { PRESETS } from '../src/core/staircase.js';
import { DRILL_MODULES, drillById } from '../src/train/drills/index.js';
import { DRILLS, LEVELS, levelById } from '../src/train/curriculum.js';
import { createDrillSession } from '../src/train/session.js';

const FACTORS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];
const KINDS = ['choice', 'stream', 'span', 'sequence'];
const EXPECTED_IDS = [
  'matrixForge', 'ruleMiner', 'nback', 'corsi', 'mentalRotation', 'paperFolding',
  'relationalIntegration', 'setShifting', 'sequenceExtrapolation', 'oddOneOut',
  'constraintGrid', 'flankerControl', 'speedDiscrimination'
];

/* Pull every svg string a trial can carry, whatever its kind. */
function trialSvgs(trial) {
  const out = [];
  const stim = trial.stimulus;
  if (stim) {
    if (typeof stim.svg === 'string') out.push(stim.svg);
    if (Array.isArray(stim.frames)) for (const f of stim.frames) if (f && typeof f.svg === 'string') out.push(f.svg);
  }
  if (Array.isArray(trial.options)) for (const o of trial.options) if (o && typeof o.svg === 'string') out.push(o.svg);
  return out;
}

/* A wrong response for any kind, so grade() is exercised on both branches. */
function wrongResponse(trial) {
  if (Array.isArray(trial.options) && trial.options.length) {
    const other = trial.options.find((o) => o.id !== trial.answerId);
    return other ? other.id : '__none__';
  }
  if (Array.isArray(trial.answer)) return trial.answer.length ? [] : [0];
  if (trial.answerId != null) return trial.answerId === 'match' ? 'nomatch' : 'match';
  return '__none__';
}

function correctResponse(trial) {
  if (trial.answerId != null) return trial.answerId;
  if (trial.answer !== undefined) return trial.answer;
  return '__none__';
}

test('the registry exposes exactly the 13 contract drills', () => {
  const ids = DRILL_MODULES.map((m) => m.id).sort();
  assert.deepEqual(ids, [...EXPECTED_IDS].sort());
  for (const id of EXPECTED_IDS) assert.equal(drillById(id).id, id);
});

test('drillById throws a clear error for an unknown id', () => {
  assert.throws(() => drillById('nope'), /nope/);
});

test('every drill declares a valid factor and a real staircase preset', () => {
  for (const m of DRILL_MODULES) {
    assert.ok(FACTORS.includes(m.factor), `${m.id} factor ${m.factor}`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(PRESETS, m.staircasePreset),
      `${m.id} preset ${m.staircasePreset} missing from staircase PRESETS`
    );
    assert.equal(typeof m.makeRun, 'function');
  }
});

test('curriculum DRILLS metadata agrees with the drill modules', () => {
  for (const d of DRILLS) {
    const mod = drillById(d.id);
    assert.equal(mod.factor, d.factor, `${d.id} factor disagrees between curriculum and module`);
  }
});

/* The heart of it: run each drill at a low, middle and high staircase level. */
for (const mod of DRILL_MODULES) {
  test(`drill ${mod.id} produces gradeable, wordless trials at several levels`, () => {
    for (const level of [1, 4, 8]) {
      const rng = makeRng(`${mod.id}:${level}`);
      const run = mod.makeRun(rng, { startLevel: level, trials: 6 });

      assert.ok(KINDS.includes(run.kind), `${mod.id} kind ${run.kind}`);
      assert.ok(Number.isFinite(run.totalTrials) && run.totalTrials > 0, `${mod.id} totalTrials`);

      const records = [];
      let seen = 0;
      for (let i = 0; i < run.totalTrials + 4; i++) {
        const trial = run.nextTrial(level);
        if (trial === null) break;
        seen++;

        assert.ok(trial.stimulus, `${mod.id} trial ${i} has no stimulus`);
        for (const svg of trialSvgs(trial)) {
          assert.ok(!/<text[\s>]/i.test(svg), `${mod.id} trial ${i} rendered a <text> element`);
          assert.ok(!/[0-9]/.test(svg.replace(/<[^>]*>/g, '')), `${mod.id} trial ${i} rendered a digit as content`);
        }
        if (run.kind === 'choice') {
          assert.ok(Array.isArray(trial.options) && trial.options.length >= 2, `${mod.id} choice trial needs options`);
          const ids = trial.options.map((o) => o.id);
          assert.equal(new Set(ids).size, ids.length, `${mod.id} duplicate option ids`);
          assert.ok(ids.includes(trial.answerId), `${mod.id} answerId not among options`);
        }

        const good = run.grade(trial, correctResponse(trial));
        const bad = run.grade(trial, wrongResponse(trial));
        assert.equal(typeof good.correct, 'boolean', `${mod.id} grade() must report a boolean`);
        assert.equal(typeof bad.correct, 'boolean');
        assert.equal(good.correct, true, `${mod.id} did not accept its own stated answer`);

        records.push({ trialId: trial.id, correct: good.correct, rtMs: 1200, level });
      }

      assert.ok(seen > 0, `${mod.id} produced no trials`);
      assert.ok(seen <= run.totalTrials, `${mod.id} produced more trials than totalTrials`);
      assert.equal(run.nextTrial(level), null, `${mod.id} did not terminate after totalTrials`);

      const s = run.summary(records);
      assert.ok(Number.isFinite(s.accuracy) && s.accuracy >= 0 && s.accuracy <= 1, `${mod.id} accuracy`);
      assert.ok(Number.isFinite(s.meanMs), `${mod.id} meanMs`);
      assert.ok(Number.isFinite(s.level), `${mod.id} level`);
      assert.ok(Number.isFinite(s.factorDelta), `${mod.id} factorDelta`);
    }
  });
}

test('drills are deterministic for a fixed seed', () => {
  for (const mod of DRILL_MODULES) {
    const shot = () => {
      const run = mod.makeRun(makeRng(`det:${mod.id}`), { startLevel: 3, trials: 4 });
      const out = [];
      for (let i = 0; i < 4; i++) {
        const t = run.nextTrial(3);
        if (!t) break;
        out.push(trialSvgs(t).join('|') + '#' + String(t.answerId ?? JSON.stringify(t.answer ?? null)));
      }
      return out.join('||');
    };
    assert.equal(shot(), shot(), `${mod.id} is not deterministic for a fixed seed`);
  }
});

test('summary() survives an empty record set', () => {
  for (const mod of DRILL_MODULES) {
    const run = mod.makeRun(makeRng(`empty:${mod.id}`), { startLevel: 1, trials: 3 });
    const s = run.summary([]);
    assert.ok(Number.isFinite(s.accuracy), `${mod.id} accuracy on empty records`);
    assert.ok(s.accuracy >= 0 && s.accuracy <= 1);
  }
});

/* The session layer: stars, xp and pass/fail, driven through a real drill. */
test('createDrillSession runs a level to completion and scores it', () => {
  const level = LEVELS[0];
  const profile = {
    status: 'qualified', tier: 0, xp: 0,
    levels: {}, drillStats: {},
    factorScores: { induction: 50, spatial: 50, workingMemory: 50, relational: 50, speed: 50, flexibility: 50 }
  };
  const session = createDrillSession({ rng: makeRng('session'), level, profile });
  session.start();

  let guard = 0;
  while (guard++ < 400) {
    const trial = session.current();
    if (!trial) break;
    session.respond(correctResponse(trial), 900);
  }

  const outcome = session.finish();
  assert.equal(outcome.levelId, level.id);
  assert.equal(outcome.drill, level.drill);
  assert.ok(outcome.trials > 0, 'session ran no trials');
  assert.ok(outcome.accuracy > 0.9, `answering correctly should score high, got ${outcome.accuracy}`);
  assert.ok(outcome.stars >= 1 && outcome.stars <= 3, `stars ${outcome.stars}`);
  assert.equal(outcome.passed, true, 'a perfect run should pass its level');
  assert.ok(Number.isFinite(outcome.xp) && outcome.xp > 0, `xp ${outcome.xp}`);
  assert.ok(Number.isFinite(outcome.factorDelta));
});

test('a failed run earns no stars and does not pass', () => {
  const level = LEVELS[0];
  const profile = {
    status: 'qualified', tier: 0, xp: 0, levels: {}, drillStats: {},
    factorScores: { induction: 50, spatial: 50, workingMemory: 50, relational: 50, speed: 50, flexibility: 50 }
  };
  const session = createDrillSession({ rng: makeRng('session-fail'), level, profile });
  session.start();

  let guard = 0;
  while (guard++ < 400) {
    const trial = session.current();
    if (!trial) break;
    session.respond(wrongResponse(trial), 4000);
  }

  const outcome = session.finish();
  assert.ok(outcome.accuracy < 0.35, `wrong answers should score low, got ${outcome.accuracy}`);
  assert.equal(outcome.passed, false, 'a failed run must not pass');
  assert.equal(outcome.stars, 0, `stars ${outcome.stars}`);
});

test('every curriculum level names a drill that can actually build a run', () => {
  for (const level of LEVELS) {
    const mod = drillById(level.drill);
    const run = mod.makeRun(makeRng(`lvl:${level.id}`), level.params || {});
    const trial = run.nextTrial((level.params && level.params.startLevel) || 1);
    assert.ok(trial, `level ${level.id} (${level.drill}) produced no first trial`);
    assert.ok(levelById(level.id), `levelById cannot resolve ${level.id}`);
  }
});
