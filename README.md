# Fluid Intelligence Engine

A wordless, culture-fair, adaptive assessment of fluid reasoning, and a training
curriculum for the people who pass it.

Everything you see is abstract geometry. There are no words, no digits and no cultural
symbols in any stimulus, in any script. Instructions are wordless animated
demonstrations. The whole application is operable without reading anything.

---

## The claim, honestly

This is a computerised adaptive test built on a three-parameter logistic IRT model with
procedurally generated figural items, scored with Warm's weighted likelihood estimator and
reported on a 100–200 index (100 + 15·θ) that is always shown with its confidence interval.
It is designed to have a high ceiling and to be readable by anyone regardless of language
or schooling. **Its item parameters are design-time priors, not empirically calibrated
norms; it has no norming sample, no differential-item-functioning study, and no
test–retest data.** The index is a score on this instrument's own scale — not an IQ, not a
percentile in any real population, and not a diagnosis. Everything it does well and
everything it cannot yet support is set out in
[`docs/PSYCHOMETRICS.md`](docs/PSYCHOMETRICS.md).

---

## How it works

1. **Assess.** An adaptive test of 18–40 items. After a four-item warmup it selects each
   item to maximise information at your current estimate, subject to exposure control and
   content balance, and stops when the estimate is precise enough *and* the confidence
   interval has cleared the qualification cut.
2. **Qualify or not.** The reported index is `round(100 + 15·θ)`. **Below 100 is
   elimination** — training is locked. At 100 or above you are placed in one of six tiers.
   The test does not stop on a provisional sub-100 estimate: while items remain, an
   interval that still straddles 100 keeps the session running, so the cut is measured
   rather than guessed.
3. **Train.** A 60+ level curriculum across six factors — induction, spatial, working
   memory, relational, speed, flexibility — driven by 13 drill engines with adaptive
   staircases. Levels unlock by tier and by prerequisite.

---

## Running it

Node 23 is needed for the tests, the simulation and the tools. **The application itself
has no dependencies and no build step** — the browser loads the ES modules directly.

```sh
node tools/serve.mjs        # then open http://localhost:5173
npm test                    # node --test test/
npm run sim                 # the psychometric simulation; exits non-zero on failure
npm run build               # -> dist/eq-game.html, one self-contained file
```

`npm run serve`, `npm test`, `npm run sim` and `npm run build` are the same four commands
through `package.json`.

A few extras:

```sh
node sim/simulate.js --fast          # skip the slow real-registry pass (~2 min instead of ~15)
node sim/simulate.js --quick         # 1/5 sample sizes, smoke run only
node sim/simulate.js --seed=12345    # the whole report is a function of the seed
node sim/simulate.js --real-n=60     # shorten the real-registry pass
node --test "test/irt.test.js"       # a single suite
node tools/audit-culture.mjs 800     # standalone culture-fairness audit
node tools/serve.mjs --port 8080     # if 5173 is taken
node tools/build-single.mjs --verbose  # bundle, listing every module by size
```

A full `npm run sim` takes a few minutes: the mock-item passes are fast, but the
real-registry pass generates every item for 300 simulated examinees and that is
genuinely slow. Use `--fast` in a tight loop and the full run before you believe a
change to `irt.js`, `cat.js` or `calibration.js` was safe.

`npm run build` produces a single HTML file with the modules carried in an import map of
`data:` URLs and the CSS inlined. It runs from a filesystem with no server: open
`dist/eq-game.html` directly.

---

## Project layout

```
index.html            shell: viewport, colour-scheme, stylesheets, module entry
src/main.js           bootstrap and the elimination gate

src/core/             rng, stats, irt (3PL + WLE), scale, cat, staircase, store, events
src/items/            shapes, svg, rules, calibration, registry + 8 item families
src/train/            curriculum (60+ levels), session scoring, 13 drill engines
src/ui/               router, components, icons, wordless demos, i18n, 9 screens
src/styles/           CSS custom properties, dark-first with a light override

test/                 node:test suites, one per core module plus items and curriculum
sim/simulate.js       theta recovery, information, elite separation, exposure, cut accuracy
tools/serve.mjs       zero-dependency dev server
tools/build-single.mjs single-file bundler
tools/audit-culture.mjs standalone culture-fairness auditor
docs/                 CONTRACTS.md (authoritative), PSYCHOMETRICS, CULTURE_FAIRNESS,
                      ARCHITECTURE
```

[`docs/CONTRACTS.md`](docs/CONTRACTS.md) is the single source of truth for every
signature, data shape and constant. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
explains the data flow, the extension points and the seeding discipline.

---

## What this is not

- **Not a clinically normed IQ test.** There is no norming sample. The index is a score on
  this instrument's scale; the 15-points-per-logit spacing borrows the deviation-IQ
  *convention* but not its population anchoring. No percentile claim is made anywhere in
  the product, and none should be inferred.
- **Not a diagnosis, and not a measure of anyone's worth or potential.** It measures
  performance on figural reasoning tasks, on one day, under whatever conditions the person
  happened to be in. Fluid reasoning is one factor among several in any model of cognitive
  ability, and cognitive ability is one thing among many that matter about a person.
- **Not a promise of far transfer.** The evidence on whether working-memory and reasoning
  training generalises to untrained measures of intelligence is genuinely contested. Near
  transfer to the trained tasks is easy to show; far transfer is not, and it has a
  difficult replication history. The curriculum here is practice at reasoning tasks and is
  reported as such — drill levels, staircase levels, per-factor progress — never as an
  intelligence gain.
- **Not culture-free.** It is culture-*fair* by design: no language, no notation, no
  taught mathematics, no cultural iconography, no reading-order dependence, colourblind-safe
  and never colour-only. What it cannot remove is familiarity with screens and with
  two-dimensional graphic conventions, and that residual advantage is real. See
  [`docs/CULTURE_FAIRNESS.md`](docs/CULTURE_FAIRNESS.md) §8.
- **Not suitable for high-stakes use.** Administration is unproctored. There is no identity
  check and no way to detect assistance, a second device or a second person. Any consequential
  decision about a real human being should not rest on this score.
- **Not calibrated yet.** Item parameters come from a documented design-time difficulty
  model, refined in flight by online Bayesian updates per item *structure*. That is drift
  correction, not calibration. What proper calibration would require is listed in
  [`docs/PSYCHOMETRICS.md`](docs/PSYCHOMETRICS.md) §4.6.
- **Not equally trustworthy across its range.** The bank reaches high enough that the
  standard error stays near 0.30 all the way up, but scores above roughly index 160 rest on
  the part of the difficulty model that is least supported. Treat them as extrapolations
  with a band wider than the one printed. The reasoning, and the simulation that measures
  it, are in [`docs/PSYCHOMETRICS.md`](docs/PSYCHOMETRICS.md) §6.4.

---

## About the elimination rule

Scoring below index 100 locks training. That is a deliberate product rule and it is
implemented exactly, which is why so much of the engineering in `src/core/cat.js` is spent
on making the cut *accurate* rather than fast: the confidence-interval-aware stopping rule
exists so that the measurement budget goes to the candidates for whom the decision is
genuinely in doubt. The simulation reports the resulting error rates — both the raw rates
and the rates excluding an indifference zone around the cut — in analysis 5.

The cut is currently symmetric: a false elimination and a false qualification are treated
as equally bad. They are not equally bad for the person. That is discussed openly in
[`docs/PSYCHOMETRICS.md`](docs/PSYCHOMETRICS.md) §7.3.
