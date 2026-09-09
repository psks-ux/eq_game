# Architecture

How the code is arranged, how data moves through it, where to plug new things in, and the
seeding discipline that keeps the whole thing reproducible.

Companion documents: [`PSYCHOMETRICS.md`](./PSYCHOMETRICS.md),
[`CULTURE_FAIRNESS.md`](./CULTURE_FAIRNESS.md), and
[`CONTRACTS.md`](./CONTRACTS.md) — which is authoritative for every signature and
constant named here.

---

## 1. The shape of the thing

Four constraints determine almost every structural decision:

- **No build step and no npm dependencies.** The browser loads `src/main.js` as a module
  and everything follows from there. Node is used only for tests, the simulation and the
  two tools.
- **Named ES-module exports only**, no `export default`, no dynamic `import()`, and every
  relative specifier ends in `.js`. This means the source is directly loadable by a
  browser *and* statically analysable by `tools/build-single.mjs`, which is what makes a
  single-file distribution possible without a bundler.
- **Determinism.** Nothing in item generation, IRT, CAT or drill content may call
  `Math.random()` or `Date.now()`. See §5.
- **Layering.** Dependencies point one way: `ui → train → items → core`. Nothing in
  `items/` imports from `train/` or `ui/`, and nothing below `ui/` touches the DOM.
  **There is exactly one exception**, and it is worth naming rather than hiding:
  `core/cat.js` imports `items/registry.js` and `items/calibration.js`, because an
  adaptive session needs a *default* item source and a way to blend learned item
  parameters. The coupling is breakable at runtime — `createSession` accepts
  `itemSource` and `familyCatalog`, which is how both `test/cat.test.js` and the fast
  pass of `sim/simulate.js` run the engine with no generators at all — but the static
  import is real, and a strict layering check will flag it. Everything else obeys the
  arrows.
- **No cycles.** The 52 modules reachable from `src/main.js` form a directed acyclic
  graph. That is what lets the bundler emit a flat import map without worrying about
  evaluation order, and it is worth preserving: ES modules tolerate cycles, but a cycle
  through a module with top-level side effects fails in ways that are painful to debug.

---

## 2. Module map

```
index.html                shell: viewport, colour-scheme, 3 stylesheets, module entry
src/main.js               bootstrap: profile -> router -> mount, plus the elimination gate

src/core/                 no DOM, no item knowledge, pure logic
  rng.js                  seedable PRNG; makeRng(seed), hashSeed(str), rng.fork(tag)
  stats.js                logistic, erf, normal pdf/cdf/quantile, mean/sd/quantile,
                          pearson, pointBiserial, auc, clamp, linspace
  irt.js                  3PL: p3pl, info3pl, testInfo, seFromInfo, maxInfoTheta,
                          bForMaxInfoAt, logLik, estimateWLE / estimateEAP / estimate,
                          reliability
  scale.js                theta <-> index, BANDS, bandFor, tierFor, confidenceInterval
  cat.js                  the adaptive test: createSession(opts) -> session
  staircase.js            adaptive difficulty for training (Kaernbach weighted up-down)
  store.js                localStorage profile with an in-memory fallback
  events.js               tiny pub/sub bus

src/items/                stimulus generation; imports core only
  shapes.js               SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS,
                          FORBIDDEN_KEYS, shapePath, isCultureSafe
  svg.js                  Glyph -> SVG string; gridSvg, optionSvg, defsPatterns,
                          glyphKey / cellKey canonicalisation
  rules.js                the 17 transformation rules; applyRule, pickRuleSet, ruleCost
  calibration.js          DIFFICULTY_MODEL, priorIrtParams, itemKey, updateBank,
                          blendedParams, bankSummary
  registry.js             FAMILIES, familyByKey, generateItem,
                          generateItemAtDifficulty, auditItem
  matrix.js progression.js series.js analogy.js oddoneout.js
  logicgrid.js folding.js rotation.js            <- one FamilyModule each

src/train/                the curriculum; imports items + core
  curriculum.js           DRILLS, LEVELS (60+), levelsForTier, unlockedLevels,
                          nextLevel, progressSummary, factorTargets
  session.js              createDrillSession: stars, XP, factor deltas
  drills/index.js         DRILL_MODULES, drillById
  drills/*.js             13 drill engines, one file each

src/ui/                   DOM; imports everything below it
  router.js               hash router over the nine routes
  components.js           mountSvg, button, card, optionGrid, meter, dialog,
                          sparkline, radar, bell, infoCurve
  icons.js                geometric-only icon set
  demos.js                demoFor(kindId) -> wordless animated instruction
  i18n.js                 optional 8-language chrome layer; nothing depends on it
  screens/*.js            home, test, result, eliminated, train, drill, progress,
                          settings, about

src/styles/               base.css, components.css, screens.css (CSS custom properties)

test/*.test.js            node:test suites, one per core module + items + curriculum
sim/simulate.js           the psychometric simulation (see PSYCHOMETRICS.md §11)
tools/serve.mjs           zero-dependency dev server on :5173
tools/build-single.mjs    single-file bundler -> dist/eq-game.html
tools/audit-culture.mjs   standalone culture-fairness auditor
```

The dependency direction, drawn once:

```
                     +----------------+
                     |    ui/*        |  DOM, screens, demos, i18n
                     +--------+-------+
                              |
                   +----------+----------+
                   |                     |
            +------v------+       +------v------+
            |  train/*    |       |   items/*   |   generation + calibration
            +------+------+       +------+------+
                   |                     |
                   +----------+----------+
                              |
                       +------v------+
                       |   core/*    |   rng, stats, irt, scale, cat, store
                       +------+------+
                              :
                              :......> items/registry.js, items/calibration.js
                                       (core/cat.js only, as its DEFAULT item source;
                                        overridable via the itemSource seam)
```

---

## 3. Data flow

### 3.1 Generation

```
rng ── registry.generateItemAtDifficulty(rng, spec)
        │  spec = { targetB, optionCount, families, exclude, bank, maxTries }
        │
        ├─ pick a family respecting spec.families and a soft content balance
        ├─ family.generate(rng, { targetB, optionCount })
        │     └─ rules.pickRuleSet -> apply rules over a grid of Glyphs
        │        -> svg.gridSvg / svg.optionSvg -> Item with meta, irt: null
        ├─ calibration.priorIrtParams(item.meta, item.family) -> { a, b, c }
        └─ keep the candidate whose irt.maxInfoTheta is closest to spec.targetB
```

The generator verifies its own output before returning: exactly one option satisfies the
full rule set, all options are pairwise distinct by canonical `cellKey`, and distractors
are built by partial rule application (target `distractorSystematicity >= 0.7`). If
verification fails it resamples, up to 50 attempts, then throws — a wrong item is never
returned.

### 3.2 Administration

```
ui/screens/test.js
   └─ cat.createSession({ rng | seed, bank, ...CAT_DEFAULTS overrides })
         nextItem()  ──> registry.generateItemAtDifficulty at bForMaxInfoAt(theta_hat)
                          x6 candidates, ranked by info3pl, uniform over the top 3
         submit(optionId, rtMs)
              ├─ record correct/incorrect, family, contentGroup, params, rt
              ├─ irt.estimateWLE(all responses) -> theta, se
              └─ stopping rule -> { correct, theta, se, index, done }
         result() ──> { index, ci, theta, se, reliability, eliminated, itemsUsed,
                        medianRtMs, byFamily, byContentGroup, informationCurve,
                        finishedReason }
```

Content balance and exposure control live inside `selectItem`; the screen has no say in
what it is shown. The screen's only jobs are to render the item, to time the response and
to hand back an option id.

### 3.3 Scoring and the gate

```
result() ──> scale.thetaToIndex(theta)            index = round(100 + 15*theta)
             scale.confidenceInterval(theta, se)  always rendered next to the index
             index < 100  ─> profile.status = 'eliminated' ─> #/eliminated
             index >= 100 ─> profile.status = 'qualified'
                             scale.tierFor(index) -> tier 0..5 -> curriculum unlock
```

`main.js` installs the gate as a **navigation guard**, not as a screen-level check: a
profile with `status: 'eliminated'` can reach only `#/eliminated` and `#/about`, and a
profile with `status: 'new'` cannot reach `#/train`. Putting the guard in the router means
a new screen cannot accidentally omit it.

### 3.4 Training

```
curriculum.unlockedLevels(profile) ─> Level { drill, factor, params, goal, stars }
   └─ train/session.createDrillSession({ rng, level, profile })
         └─ drills/<id>.makeRun(rng, level.params) -> Run
               nextTrial(level) -> Trial { stimulus, options, answerId, timeLimitMs }
               grade(trial, response) -> { correct, detail }
               core/staircase adjusts `level` between trials
         finish() -> Outcome { accuracy, trials, meanMs, finalLevel, stars, xp,
                               factorDelta, passed }
   └─ store.saveProfile: levels[levelId], drillStats[drillId], factorScores, xp, streak
```

Star and XP computation lives in `train/session.js`, never in the UI, so the same run
produces the same outcome whether it is driven by a screen or by a test.

### 3.5 The learning loop back into the bank

Each administered assessment item feeds `calibration.updateBank(bank, { key, theta,
correct })`, which maintains a per-**structure** posterior for `b` in
`profile.bank[itemKey]`. `blendedParams` then precision-weights that posterior against the
design-time prior on subsequent sessions. See `PSYCHOMETRICS.md` §4.5 for what this is —
drift correction — and what it is not.

---

## 4. Extension points

### 4.1 Adding an item family

1. Create `src/items/<family>.js` exporting exactly:
   ```js
   export const family;        // 'myFamily', unique
   export const bRange;        // [min, max] difficulty the generator can actually reach
   export const contentGroup;  // 'induction' | 'spatial' | 'relational' | 'constraint'
   export function generate(rng, { targetB, optionCount }) { /* -> Item */ }
   ```
   Return an Item per `CONTRACTS.md` §9 with `irt: null` — the registry fills it.
   Build stimuli only from `items/shapes.js` primitives via `items/svg.js`, and only from
   rules in `items/rules.js`.
2. Import the module in `src/items/registry.js` and add it to `FAMILIES`.
3. Add a `B_FAMILY` and an `A_FAMILY` offset in `src/items/calibration.js`, each **with a
   one-line rationale comment**. The offsets are bounded to `[-0.5, 0.5]` and
   `[-0.25, 0.35]`; they express what the family costs *beyond* what the structural terms
   already capture.
4. Add a wordless demo for the family in `src/ui/demos.js`. A family with no demo is an
   instruction the user cannot receive.
5. Run `npm test` (the item suite samples every family) and
   `node tools/audit-culture.mjs`.
6. Re-run `npm run sim` and check analysis 4: the new family should appear in the exposure
   table with a share consistent with the content caps, and analysis 2 should show whether
   it extended the bank's difficulty reach.

Nothing else needs to change. The CAT discovers the family through `FAMILIES`, and content
balance picks it up through `contentGroup`.

### 4.2 Adding a drill

1. Create `src/train/drills/<id>.js` exporting:
   ```js
   export const id;               // 'myDrill'
   export const factor;           // one of the six factor keys
   export const staircasePreset;  // key into staircase PRESETS
   export function makeRun(rng, params) { /* -> Run */ }
   ```
   The `Run` is pure logic — `kind`, `totalTrials`, `nextTrial(level)`, `grade(trial,
   response)`, `summary(records)`. It must not touch the DOM; the UI drives it.
2. Register it in `src/train/drills/index.js` (`DRILL_MODULES`).
3. Add its metadata to `DRILLS` in `src/train/curriculum.js`.
4. Add a wordless demo keyed by the drill id in `src/ui/demos.js`. This is required, not
   optional: `demoFor` must resolve for every drill id.
5. Add levels that use it (§4.3).

`src/ui/screens/drill.js` renders by `Run.kind` (`choice`, `stream`, `span`, `sequence`),
so a new drill of an existing kind needs no UI work at all.

### 4.3 Adding a level

Append a `Level` to `LEVELS` in `src/train/curriculum.js`:

```js
{
  id: 'L61', tier: 2, order: 61,
  drill: 'relationalIntegration', factor: 'relational',
  params: { /* passed straight to makeRun */ },
  goal: { trials: 24, accuracy: 0.78, maxMs: 60000, minLevel: 4 },
  stars: [ { accuracy: 0.75 }, { accuracy: 0.85 },
           { accuracy: 0.92, maxMsPerTrial: 12000 } ],
  unlock: { requires: ['L60'], minTier: 2 }
}
```

Two invariants the curriculum tests enforce, and that a new level must not break:

- Every tier covers **all six** factor keys (`induction, spatial, workingMemory,
  relational, speed, flexibility`).
- `params` escalate **monotonically within a factor** as `order` increases. A later level
  in the same factor may not be easier than an earlier one.

### 4.4 Adding a rule

Add a `RuleDef` to `RULES` in `src/items/rules.js` with `key`, `arity`, `dimension`,
`abstractness` (1–4), `apply(glyphs, ctx)` and `canApply(glyphs)`. `apply` must be **pure**
— take glyphs, return new glyphs, mutate nothing — because generators apply candidate rules
speculatively and roll back.

Before adding one, check it against `CULTURE_FAIRNESS.md` §4: the rule must be inducible
from the item by looking, with no taught knowledge. If explaining it requires naming a
mathematical concept, it does not belong here.

---

## 5. Determinism and the seeding discipline

Everything statistical in this codebase is reproducible, and it stays that way by rule
rather than by luck.

**The rule.** No `Math.random()` and no `Date.now()` inside item generation, IRT, CAT or
drill content. Randomness enters only through an injected `rng` object from
`core/rng.js`. Wall-clock time is permitted only in UI/session timing code, at the call
site, and its values are stored as data (`createdAt`, `rtMs`) rather than used to make
decisions.

**The mechanism.** `makeRng(seed)` takes a number or a string and returns a plain object
of closures: `next, int, pick, sample, shuffle, bool, gauss, fork`. `fork(tag)` derives a
new, independent generator from the parent's seed plus the tag. That single method is what
makes the discipline practical:

- Every consumer forks its own stream from a parent seed, so **adding a call in one place
  cannot shift the numbers everywhere else**. Without forking, inserting one extra
  `rng.next()` in the CAT would change every item in every subsequent session, and no
  simulation result would ever be comparable across commits.
- Forks are addressed by meaningful tags — `cat:item:7:2`, `grid:12:5`, `real:184` — so a
  specific draw can be reproduced in isolation for debugging.

**Where seeds come from.**

| Context | Seed |
|---------|------|
| Tests | a literal in the test file |
| `sim/simulate.js` | `--seed` (default `20240917`); the entire report is a pure function of it |
| A CAT session | `opts.rng` or `opts.seed`; a fixed default if neither is given |
| A drill run | derived from the profile and the level id, so a level replays identically |
| Item generation | the rng handed down from the caller — generators never create their own |

**Test seams.** `cat.createSession` accepts an optional `itemSource(rng, spec)` and an
optional `familyCatalog`. Production passes neither and gets the registry. `test/cat.test.js`
injects a synthetic bank with known IRT parameters, which keeps the CAT suite independent
of the generators. `sim/simulate.js` uses the same seam for its fast pass: **only the item
source is ever mocked; the adaptive engine under test is always the real one.**

**Why it matters beyond tidiness.** The claims in `PSYCHOMETRICS.md` §11 are numbers
produced by a simulation. If that simulation were not reproducible, a change to an unrelated
module could move a reported error rate and nobody would be able to tell whether the
instrument had changed or the dice had.

---

## 6. Build and serve

**Development.** `node tools/serve.mjs` serves the repository root at
`http://localhost:5173` with correct MIME types, no caching whatsoever, and directory-index
resolution. There is no watcher and no reload injection: the browser loads the real source
files, so a refresh is the reload. Because the app is a hash router, no server-side SPA
fallback is needed and a 404 stays an honest 404.

**Distribution.** `node tools/build-single.mjs` produces `dist/eq-game.html`, one file that
runs from a filesystem with no server at all. It:

1. reads `index.html` and finds the `<script type="module" src=...>` entry;
2. walks the ESM graph from that entry, rewriting **only** `from '...'` and side-effect
   `import '...'` relative specifiers to bare `app:<normalised path>` specifiers — export
   bindings are never touched, so module semantics and name resolution are exactly as they
   were;
3. emits a `<script type="importmap">` mapping each bare specifier to a
   `data:text/javascript;charset=utf-8,<encodeURIComponent(source)>` URL;
4. inlines the stylesheets, following CSS `@import` recursively (a media condition on an
   `@import` becomes an `@media` wrapper);
5. writes the file and prints the module count, the source and encoded sizes, the largest
   modules, and any warnings.

The specifier rewriter works on a **masked copy** of each source in which string, comment
and regex-literal *contents* are replaced by filler while all real syntax and all offsets
survive. Keywords are then located in the masked text and the specifier string that follows
is rewritten in the original. The consequence is that `const s = "we import './x.js'"` and
`// import './y.js'` are left completely alone, which a naive regex bundler would not
manage. The build fails loudly if any relative specifier survives the rewrite.

It handles nested relative paths, directory imports (`./drills` and `./drills/` both
resolve to `drills/index.js`), extensionless specifiers, and leaves already-bare specifiers
untouched — warning about each one, since the browser will have to resolve it by itself.

---

## 7. Tests

`npm test` runs `node --test test/`. Suites: `irt`, `scale`, `cat`, `rng`, `calibration`,
`staircase`, `items`, `curriculum`, `store`.

They are unit tests with **no DOM**. UI modules are deliberately excluded — their contract
is that they are thin, that all decisions live below them, and that they are covered by the
tools instead: `tools/audit-culture.mjs` reaches drills and demos, and
`tools/build-single.mjs` fails the build if any module in the graph cannot be resolved or
rewritten.

The heavier statistical verification is not in the unit suite at all. It lives in
`sim/simulate.js`, which exits non-zero on the contract thresholds and is the thing to run
before believing that a change to `irt.js`, `cat.js` or `calibration.js` was safe.
