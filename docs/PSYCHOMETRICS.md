# Psychometrics

How this instrument measures, what the numbers mean, and where they stop meaning
anything. Written to be checked, not to be believed.

Companion documents: [`CULTURE_FAIRNESS.md`](./CULTURE_FAIRNESS.md) for the fairness
argument, [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the code map, and
[`CONTRACTS.md`](./CONTRACTS.md) for the authoritative signatures and constants.

---

## 1. What is being measured

The construct is **fluid reasoning** (Gf): the ability to induce a relation from a small
set of instances and apply it to a new instance, under no useful prior knowledge. Every
item is a figural induction, spatial transformation, relational integration or constraint
satisfaction task built from abstract geometry.

This is deliberately narrower than "intelligence". Figural matrix reasoning is one of the
best single markers of Gf that exists, and Gf is one factor among several in any
hierarchical model of cognitive ability. Crystallised knowledge, verbal comprehension,
processing speed as such, long-term retrieval and quantitative reasoning are all
untouched here — by design, because those are exactly the abilities that carry the most
schooling and language dependence.

**What the index is:** a criterion-referenced score on a scale defined by this item bank
and this difficulty model.

**What the index is not:** an IQ, a percentile in any real population, a clinical
measure, or a prediction about anybody's life.

---

## 2. The response model

### 2.1 Three-parameter logistic

For an examinee at ability `theta` and an item with parameters `a` (discrimination),
`b` (difficulty) and `c` (lower asymptote):

```
P(correct | theta) = c + (1 - c) / (1 + exp(-D * a * (theta - b)))
```

with `D = 1.702`, the constant that makes the logistic ogive agree with the normal ogive
to within about 0.01 across its range. `D` is a historical convenience, not a parameter;
it exists so that `a` values are comparable with the normal-ogive tradition.

Fisher information for a single 3PL item:

```
I(theta) = D^2 * a^2 * ((1 - P) / P) * ((P - c) / (1 - c))^2
```

which peaks not at `b` but slightly above it:

```
theta_max = b + (1 / (D * a)) * ln((1 + sqrt(1 + 8c)) / 2)
```

The adaptive engine uses the inverse of that identity (`bForMaxInfoAt`) so that the
item it selects has its information peak *at* the current ability estimate, rather than
its difficulty parameter there. With `a = 1.2` and `c = 0.106` the difference is about
0.08 logits — small, but free to get right, and it is the difference between "select
b = theta" folklore and the actual optimum.

### 2.2 Why not 1PL / Rasch

Rasch fixes `a` equal across items and `c` at zero. Both assumptions are false here.

Items in this bank differ enormously in how sharply they separate people. An item whose
distractors are constructed near-misses — apply three of the four rules correctly and
you land on a wrong option — discriminates far more sharply than an item whose
distractors are random perturbations, where partial understanding still finds the key by
elimination. Forcing a common `a` would throw away the single most useful piece of
information the generator produces about its own output
(`meta.distractorSystematicity`).

More importantly, Rasch's `c = 0` is not survivable with eight options. See below.

### 2.3 Why not 2PL: the guessing floor is real

With `k` response options, a candidate who has understood nothing still answers some
items correctly. Under a 2PL, `P(correct)` goes to zero as ability falls, and the model
must explain observed correct answers from low-ability examinees by *lowering `b`* — it
mistakes lucky guesses for easy items. The damage is concentrated at the bottom of the
scale, which is precisely where this product makes an irreversible decision (elimination
below index 100). A model that systematically misestimates the difficulty of easy items
would make the cut wrong in a structured, non-random way.

The 3PL absorbs that floor into `c` and leaves `b` alone.

### 2.4 Why `c` is fixed at `0.85 / optionCount`

`c = 0.85 / 8 = 0.10625` for the standard eight-option item.

Two decisions here, both deliberate:

- **Below uniform chance (`1/8 = 0.125`).** `c` is not "the probability of guessing
  right"; it is the lower asymptote of the response function — the probability of a
  correct answer from someone with no ability at all. Because distractors are built by
  applying a *subset* of the item's rules correctly and mis-applying one, they are
  attractive. A candidate with no idea does not sample uniformly from eight options: they
  are drawn toward the plausible-looking wrong ones. So the asymptote sits slightly below
  uniform chance. The factor 0.85 encodes "distractors are attractive but not
  overwhelming"; it is a judgement, and it is the kind of judgement that online
  recalibration should eventually replace.
- **Fixed rather than estimated.** `c` is the hardest 3PL parameter to estimate; it
  trades off badly against `b` and needs a great many low-ability observations to pin
  down. Estimating it from thin data produces unstable `b` values, which then move the
  cut. With no calibration sample at all, fixing `c` at a defensible value is more honest
  than pretending to estimate it.

The model scales `c` with `optionCount`, so a six-option item gets `c = 0.1417`
automatically.

---

## 3. Ability estimation: why Warm's WLE

The estimator is `estimateWLE` in `src/core/irt.js`, and it is not an incidental choice.
This product lives at the extremes of the ability range: it makes a hard decision at
`theta = 0` and its entire selling proposition concerns `theta > 2`. Both regions are
exactly where the standard estimators fail, in opposite directions.

### 3.1 Maximum likelihood: two failures, both fatal here

Maximise `logLik(theta)` alone and you get an estimator that is consistent as test length
grows but is **biased outward** in finite samples: high scores are pushed higher, low
scores lower, with the bias growing as the estimate moves away from the centre of the
administered difficulties. On an 18-to-40 item test that bias is not negligible.

Worse: for an **all-correct response pattern** the 3PL likelihood is monotone increasing
in `theta` and has no interior maximum, so the MLE is `+infinity`. All-correct is not a
pathological case here — it is a common pattern for a strong examinee on a short adaptive
test whose bank runs out of hard items. An estimator that is undefined for its most
important customers is not an estimator.

### 3.2 EAP: the failure is silent, which is worse

The expected a-posteriori estimate (posterior mean under a `N(mu, sigma)` prior) is always
finite and minimises expected squared error *in the population the prior describes*. It is
also a **shrinkage** estimator: it pulls every estimate toward the prior mean by roughly

```
shrinkage ≈ (se^2 / (se^2 + priorVar)) * (theta - priorMean)
```

The pull grows with the distance from the prior mean and with the measurement error.
Consider the exact case this product exists to serve — an examinee at `theta = 4`
measured with `se = 0.35`, under the wide `N(0, 1.4)` prior the contract specifies:

```
shrinkage ≈ (0.1225 / (0.1225 + 1.96)) * 4 ≈ 0.24 logits ≈ 3.5 index points
```

Under a conventional `N(0, 1)` prior it would be about 0.44 logits, nearly 7 index points.
The bias is **downward, systematic, and largest for the most able and the least certain**.
An elite candidate would be told a smaller number precisely because their score is
unusual. For a selection instrument that is disqualifying, however good the population MSE
looks.

There is a second, subtler problem. EAP's reported standard error is the posterior SD,
which is *smaller* than the WLE standard error. A narrower interval around a shrunken
point estimate looks like better measurement and is not: part of that narrowness is the
prior asserting itself, not evidence from the examinee's answers. Reporting it next to a
biased estimate would be doubly misleading, and this app's honesty rule requires the
interval to be shown every time.

`estimateEAP` is still implemented and available — it is useful as a diagnostic and as a
robust fallback for very short response vectors — but it is not what the reported index is
built from.

### 3.3 Warm's weighted likelihood

WLE maximises the likelihood weighted by the square root of the test information:

```
maximise   L(theta) * sqrt(I(theta))
equivalently   logLik(theta) + 0.5 * ln(I(theta))
```

Two properties follow, and they are exactly the two properties this product needs.

**It removes the leading bias term without a population prior.** The `sqrt(I)` weight is
constructed so that its gradient cancels the first-order (order `1/n`) bias of the MLE.
The correction depends only on the administered items, not on an assumed ability
distribution, so a WLE estimate is not shrunk toward anything. Nobody is scored lower for
being unusual.

**It is finite for perfect patterns.** As `theta` rises above every administered `b`, the
likelihood of an all-correct pattern approaches an asymptote — it stops increasing —
while `I(theta)` falls toward zero, so `0.5 * ln(I(theta))` falls without bound. Their sum
therefore has an **interior maximum**. An all-correct examinee gets a finite, principled
estimate that says, in effect, "at least this able, and here is the interval". This is
the single most valuable property of WLE for a high-ceiling test, and it is why the
elite bands are reportable at all.

**What it costs.** WLE has larger sampling variance than EAP. Over a `N(0, 1)`
population its RMSE in the middle of the range is slightly worse than EAP's, because EAP
buys accuracy in the middle by borrowing from the prior. That trade is accepted
deliberately: this instrument is judged on rank order and on the top of the range, not on
population mean squared error.

### 3.4 Implementation: numerical, on purpose

`estimateWLE` evaluates the objective on a coarse grid over `[THETA_MIN, THETA_MAX] =
[-4, 7]` at step 0.05, then runs two ternary-search refinements to about `1e-6`. There are
no analytic derivatives anywhere in the estimator, and this is a deliberate engineering
decision with two justifications:

1. The WLE gradient requires the derivative of the test information function with respect
   to `theta`, under the 3PL, where the algebra is long and sign errors are silent — a
   flipped sign produces plausible-looking estimates that are wrong in one tail only, and
   that class of bug can survive a test suite for a long time.
2. The 3PL likelihood **can be multimodal** for aberrant response patterns (a low-ability
   examinee who gets several hard items right). A Newton method converges to whichever
   mode it started near. An exhaustive grid finds the global maximum by construction.

The cost is a few hundred function evaluations per estimate, which at 40 items is
microseconds. The simulation in `sim/simulate.js` calls this estimator hundreds of
thousands of times and completes in minutes.

### 3.5 Standard errors

For WLE the standard error is the asymptotic one:

```
se = 1 / sqrt(I(theta_hat))    // seFromInfo(testInfo(theta_hat, administered))
```

This is the sampling error of the estimator given the items actually administered. It is
conditional on `theta`, which is the right thing for a report about one person: the app
never quotes a single population-average reliability figure as if it applied to
everybody.

For EAP, `se` is the posterior standard deviation instead. The two are not
interchangeable and the estimator name is carried in the result object (`method`) so they
can never be silently confused.

Zero responses return `{ theta: 0, se: Infinity }`, and the confidence interval for an
infinite `se` is the whole scale. "We do not know" is representable.

---

## 4. The difficulty model

### 4.1 Status: design-time priors, not norms

**Every coefficient below is a design-time prior.** They were chosen from the structure
of the generators — how many relations an item requires, how deeply nested those
relations are, how much a surface heuristic helps — and not estimated from human response
data, because no human response data exists yet. They are a *starting point for the
adaptive algorithm*, refined per item structure by online recalibration (§4.6).

They are not empirically calibrated item parameters, and the index they produce is not a
population norm. Any sentence of the form "this person scored 137, which is the Nth
percentile" is unsupported by anything in this repository. The app does not make such
claims, and neither should anyone reading its output.

### 4.2 Difficulty `b`

```
b = B0
  + B_RULES    * (ruleCount - 1)
  + B_ABSTRACT * (abstractness - 1)
  + B_WM       * (wmLoad - 1)
  + B_ELEMENTS * log2(elementCount / 4)
  - B_SALIENCE * perceptualSalience
  + B_FAMILY[family]
```

| Coefficient   | Value   | Unit                       | Rationale |
|---------------|---------|----------------------------|-----------|
| `B0`          | `-1.10` | intercept                  | Fixes where the simplest possible item sits: one rule, minimum abstractness, `wmLoad` 1, four elements, no surface cue. That item lands at `b = -1.10`, an ability of index ≈ 83. This is deliberate and load-bearing: the bank must reach *well below* the cut, or every candidate near index 100 would be measured only by items that are too hard for them, and the elimination decision would be an assumption rather than a measurement. |
| `B_RULES`     | `0.92`  | per additional rule        | The dominant structural term. Each extra relation that must be induced and held simultaneously is worth nearly a full logit. One rule to four spans about 2.8 logits ≈ 42 index points, which is most of the bank's usable range. Number of simultaneous relations is the classic driver of figural matrix difficulty, and it is the term we are most confident about in direction and rough magnitude. |
| `B_ABSTRACT`  | `0.55`  | per unit of abstractness (1..4) | A rule over a directly visible attribute (size, count, position) is easier than the same rule over a derived one (a relation between relations). Set at roughly half `B_RULES`: making an existing rule more abstract is real work, but adding a whole further rule is more. |
| `B_WM`        | `0.38`  | per unit of `wmLoad` (1..6)| Simultaneous relations that must be held while the others are checked. This term overlaps with `ruleCount` by construction — a three-rule item usually has a high `wmLoad` — so it carries the smaller weight of the two, and exists to capture the case where a *single* rule spans many cells and still loads memory heavily. |
| `B_ELEMENTS`  | `0.30`  | per doubling of element count | Search cost, not reasoning cost. Doubling the glyphs doubles the visual scan but leaves the rule unchanged, so the effect enters logarithmically (`log2(elementCount / 4)`, i.e. zero at four elements) and is small. Across the realistic 4-to-16 element range it contributes at most `0.30 × log2(4) = 0.60` logits — a third of what a single extra rule is worth. |
| `B_SALIENCE`  | `1.20`  | subtracted, salience in 0..1 | The largest coefficient in the model, and the most important one for validity. `perceptualSalience` is the generator's own estimate of how far a surface heuristic — "pick the option that looks most like its neighbours" — gets you. A fully salient item is 1.2 logits easier than the same structure without the cue, because it has quietly stopped being a reasoning item and become a perceptual matching task. The coefficient is large so that the generator is strongly penalised, in the difficulty it can claim, for leaking a shortcut. |
| `B_FAMILY`    | `[-0.50, 0.50]` | per family          | What a family costs *beyond* everything the structural terms already account for. Each offset carries a one-line rationale in `src/items/calibration.js`; for example `paperFolding` is `+0.35` because the intermediate fold states are never shown and must be simulated internally, while `symmetry` is `-0.30` because symmetry detection is close to pre-attentive. |

### 4.3 Discrimination `a`

```
a = A0 + A_SYS * distractorSystematicity - A_SAL * perceptualSalience + A_FAMILY[family]
    clamped to [0.45, 2.60]
```

| Coefficient  | Value   | Rationale |
|--------------|---------|-----------|
| `A0`         | `0.80`  | The floor for an item with random distractors and no surface cue: it still separates people, just bluntly. |
| `A_SYS`      | `1.10`  | The dominant term. `distractorSystematicity` is the fraction of distractors built by *partial rule application* rather than random perturbation. This is what makes an item discriminate: if partial understanding lands on a wrong answer instead of being rescued by elimination, the response function is steep. Generators target `>= 0.7`; a typical item at systematicity 0.85 and salience 0.2 lands at `a = 0.80 + 0.935 - 0.09 = 1.65`. |
| `A_SAL`      | `0.45`  | A surface shortcut lets low-ability examinees succeed sometimes and adds strategy noise for everyone, flattening the curve. |
| `A_FAMILY`   | `[-0.25, 0.35]` | Families differ in how cleanly they split solvers from non-solvers. `relationalIntegration` is `+0.28` (integration either happens or it does not); `symmetry` is `-0.22` (nearly everyone above the floor detects it). |

The clamp exists because the linear form has no business extrapolating: `a` below 0.45
would mean an item that barely orders people, and `a` above 2.60 would imply a step
function, which no figural item is.

### 4.4 Lower asymptote `c`

`c = 0.85 / optionCount`. See §2.4.

### 4.5 Online recalibration

Priors are a starting point. `src/items/calibration.js` maintains a per-**structure**
posterior for `b`, stored in the user's profile under `bank`.

**The key is structural, not per item.** `itemKey(item)` is
`family | sorted ruleTypes | ruleCount | wmLoad | element bucket | optionCount`. It
deliberately excludes the seed. Items are procedurally generated and effectively never
repeat, so per-instance calibration is impossible; what *can* be learned is how hard a
*kind* of item is. Element counts are bucketed (`2, 4, 6, 9, 12, 16` edges) so that items
with 7 and 9 elements pool their statistics while 4 and 16 do not.

**The update.** The `b` posterior is Normal with prior mean equal to the model `b` and
prior sd `0.60`. Each observation `(theta, correct)` applies one Newton step on the 3PL
log-likelihood with respect to `b`, damped by `1 / (n + 4)` and hard-capped at 2.0 logits
per undamped step. The damping is a stochastic-approximation step size: the first few
administrations of a structure move its difficulty a lot, the hundredth moves it very
little. The cap ensures that one aberrant session cannot drag a structure across the
bank.

**The blend.** `blendedParams` combines prior and posterior by precision weighting:

```
b = (priorPrecision * b_model + dataPrecision * b_learned) / (priorPrecision + dataPrecision)
priorPrecision = 1 / 0.60^2 ≈ 2.78
dataPrecision  = accumulated Fisher information for that structure
```

A structure with no data uses the model. A structure with many administrations uses the
data. The crossover is automatic: prior and data carry equal weight once the accumulated
information reaches about 2.8, which is a handful of well-targeted administrations, and the
data dominates thereafter.

**What this is and is not.** It is drift correction, and it is a genuine improvement over
frozen priors. It is **not** calibration. The update conditions on the examinee's
*estimated* `theta`, which carries its own error, so the learned `b` inherits that error
(this is the standard bias of online item calibration from ability estimates). It also
learns from a self-selected, unrepresentative sample: the people who use the app.

### 4.6 What real calibration would require

To replace §4.2's priors with estimated parameters, in order:

1. A response sample per item structure across a spread of abilities — several hundred
   responses per structure, not per item, because of §4.5.
2. A **linking design** (common items or common persons across forms) so that parameters
   from different collection waves land on one scale.
3. Marginal maximum likelihood estimation of `a` and `b` with `c` either fixed or
   estimated with a strong prior.
4. Fit diagnostics per structure, and retirement of structures that do not fit the 3PL.
5. **DIF analysis** across language, country and education groups. Culture fairness is
   claimed in this repository from *design*; DIF is how it would be checked from *data*.
   Until that analysis exists, the fairness claim is an argument, not a finding.
6. A norming sample, if the index is ever to be interpreted as a percentile — which it
   currently is not, anywhere in the product.

---

## 5. Adaptive administration

Implemented in `src/core/cat.js`. Defaults: `minItems 18`, `maxItems 40`,
`targetSE 0.30`, `optionCount 8`, `cutIndex 100`, `ciLevel 0.90`, `warmup 4`.

### 5.1 Warmup

The first four items target `theta = 0.3` regardless of performance. A CAT that reacts to
the very first response can be sent a long way off by one lapse or one lucky guess, and
the recovery costs items that the precision budget cannot spare. Targeting slightly above
average rather than exactly average means a first wrong answer is not immediately
catastrophic for a strong examinee's item sequence.

### 5.2 Maximum-information selection

After warmup, the target difficulty is
`b* = bForMaxInfoAt(theta_hat, A_TYPICAL = 1.20, c = 0.85 / optionCount)`, which places the
item's information *peak* at the current estimate rather than its difficulty parameter
(§2.1). `A_TYPICAL` is a nominal discrimination used only to place the target; the actual
`a` of the generated candidates is used for ranking.

### 5.3 Randomesque exposure control

Six candidates are generated at the target difficulty, ranked by `info3pl(theta_hat, ...)`,
and one of the **top three** is chosen uniformly at random.

The reason is that strict maximum-information selection is degenerate: it concentrates
administration on a small set of high-`a` item structures, which are then seen by
everybody. Two consequences follow — an exposure and security problem (the same
structures become shareable), and a construct problem (the test silently becomes a test
of one narrow item type).

The information cost is small. When six candidates are drawn near the same target `b`,
the second- and third-ranked usually carry information within a few percent of the best,
because the ranking differences come mostly from sampling noise in `a`. Analysis 4 of the
simulation reports the resulting exposure distribution.

### 5.4 Content balancing

No `contentGroup` may exceed **40%** of administered items and no single `family` may
exceed **25%**. Caps are enforced prospectively against `max(n + 1, minItems)` — measuring
a 25% cap against the first two items would block every family on item one, and because
the denominator never shrinks, the exact caps still hold for the final item set whenever a
session reaches `minItems`, which it always does.

If no family under the caps can supply an item at the target difficulty (this happens at
the extremes, where only a few families reach), the engine relaxes the **family** cap
first and the **group** cap only as a last resort, and records the relaxation in the
session history so it is visible in the simulation output rather than silent.

This is a validity requirement, not a nicety. A pure max-information CAT converges on
whichever family happens to have the highest discrimination and turns a fluid-reasoning
test into a single-format test. Construct representation has to be defended structurally,
because the information criterion will not defend it.

### 5.5 Stopping rules

A session ends when one of the following holds:

- **`precision`** — `n >= minItems`, `se <= targetSE`, and the `ciLevel` interval excludes
  the cut, with both conditions first satisfied on the same item.
- **`decisive`** — the same conditions, but precision had already been reached earlier and
  the extra items were spent clearing the interval off the cut.
- **`maxItems`** — the 40-item ceiling.

The composite condition matters more than either half. **Precision alone is never enough
to stop.** While `n < maxItems`, an interval that still contains index 100 keeps the
session running, because the whole product decision hangs on which side of 100 the
candidate falls. Conversely, a candidate whose interval cleared the cut at item 20 but
whose `se` is still 0.35 keeps going, because the reported *index* — not just the
qualify/eliminate bit — has to be worth printing.

`targetSE = 0.30` corresponds to a marginal reliability of 0.91 and a standard error of
measurement of 4.5 index points (§8).

A fixed-length test would be strictly worse on both counts: it would over-test the people
whose ability is obvious and under-test the people near the cut, which is the opposite of
where the measurement budget should go.

### 5.6 Skips

`skip()` records an incorrect response and flags the record. This is the conservative
choice: treating a skip as missing-at-random would let a candidate improve their estimate
by declining every hard item. The flag is retained so that a session with many skips can
be identified as low-effort rather than low-ability, which is a distinction the score
itself cannot make.

---

## 6. The reported index

### 6.1 The transform

```
index = round(100 + 15 * theta), clamped to [40, 200]
```

`theta = 0` maps to 100, the qualification cut. `theta = 6.67` maps to 200, the top of the
scale.

### 6.2 Why 15 points per logit

Fifteen points per standard deviation is the familiar deviation-IQ convention, and using
it makes the number immediately readable. It is worth being precise about what that
borrows and what it does not.

The convention is only the IQ *metric* if `theta` is standard normal in the reference
population. This design **assumes** a `N(0, 1)` ability distribution; it has not observed
one. If the app's actual users are not distributed that way — and a self-selected
population of people who choose to take an online reasoning test almost certainly is not —
then the spacing of the scale is still meaningful (a 15-point difference is still one
logit) but its *anchoring* to any real population is not established.

The scale is therefore best read as: **one logit of measured fluid reasoning per 15
points, anchored at the cut.**

### 6.3 A one-sided scale

The reported range runs 100–200 because the product eliminates everyone below 100.
Indices below 100 are computed and clamped at 40, but they carry no band and no
curriculum: `bandFor` returns `null` and `tierFor` returns `-1`. This is a product rule,
not a psychometric one. The measurement below the cut is real — the CAT works hard to
place people accurately down there, precisely so the cut is defensible — but the score is
used only for that one decision.

Bands, all bounds inclusive:

| Tier | Key           | Index range |
|------|---------------|-------------|
| 0    | `entry`       | 100–114     |
| 1    | `strong`      | 115–129     |
| 2    | `advanced`    | 130–144     |
| 3    | `exceptional` | 145–159     |
| 4    | `elite`       | 160–179     |
| 5    | `apex`        | 180–200     |

### 6.4 What `theta = 6.67 -> 200` actually means, honestly

Under a normal model, 6.67 standard deviations above the mean is a rarity of roughly one
in ten billion. **Nobody should read the number 200 that way, and the app does not present
it that way.** 200 is the top of a product scale. It is a ceiling, not a rarity claim.

More important is the region below it, and here the honest account has two parts that point
in opposite directions. Both belong in the same paragraph.

**The statistical ceiling is genuinely high.** Analysis 2 of the simulation measures it
rather than asserting it. Roughly half of the item bank's total information sits above
`theta 2` (index 130) and roughly a fifth above `theta 4` (index 160); the hardest item the
bank's difficulty model produces is around `b = 5.6`, an index near 184. So the standard
error does *not* collapse at the top: it drifts from about 0.26 at `theta 2` to about 0.31
at `theta 4` and stays near 0.30 out to `theta 6`. In 90% interval terms that is roughly
±6.4 index points at 130 and ±7.7 at 160 — wider, but not dramatically. The bank was built
to reach up there and, on its own terms, it does.

**The epistemic ceiling is much lower than the statistical one, and that is the real
limit.** Every one of those hard `b` values comes from the uncalibrated difficulty model in
§4. At `theta 0` the model's errors are diluted by many items near the examinee and by the
sheer mass of the bank; at `theta 4` the estimate rests on a handful of items that the
*model* says are extremely hard, and whether an item the model calls `b = 5.0` is actually
that hard for a human being is precisely the thing that has never been checked. Analysis 1b
measures the consequence directly: perturbing the item parameters away from the ones used
to score leaves the core range almost untouched (RMSE about 0.22 to about 0.27) but
degrades the elite spikes substantially (RMSE about 0.31 to about 0.42 at `theta 4.5`, with
the bias turning negative). **The reported SE understates the true uncertainty at the top,
and it understates it more the higher you go**, because the SE is conditional on the item
parameters being right and they are least likely to be right exactly there.

Reading the scale, then:

- Up to about **index 145** (`theta 3`), the bank has well-targeted items, the interval is
  comparable to the rest of the scale, and model error is diluted.
- Between about **145 and 160**, both effects grow slowly. The printed interval is close to
  honest.
- **Above roughly index 160** (`theta 4`), treat the score as an **extrapolation with a band
  wider than the printed one**. The point estimate is still principled — WLE's information
  penalty is what keeps a perfect response pattern finite at all (§3.3) — but it is resting
  on an unvalidated part of the difficulty model.
- At the **200 clamp**, the only defensible reading is "at or beyond the measurable ceiling
  of this instrument".

Nothing above changes what the app displays: it shows the point estimate and the 90%
interval, always. What this section adds is that at the very top of the scale the interval
is a lower bound on the uncertainty, not a full account of it.

### 6.5 The honesty rule

`confidenceInterval(theta, se, level)` returns the interval in index units, and
`src/core/scale.js` never hides `se`. Per the contract, the UI **must** render the interval
alongside the point estimate, everywhere the point estimate appears. A non-finite `se`
yields the full scale — "we do not know" is a representable answer, and it is the correct
one for a session that ended early.

This is the mechanism by which the ceiling problem in §6.4 stays honest rather than
becoming a marketing number: a reported 172 that comes with a band of 164–180 is telling
the truth about the sampling error, and §6.4 explains why, up there, the true band is
wider still.

---

## 7. The elimination cut

**A candidate is eliminated if and only if their final reported index is below 100.**

The rule is simple; making it *accurate* is where the work is.

### 7.1 The CI-aware stopping rule

The test does not stop on a provisional sub-100 estimate. While `n < maxItems`, if the 90%
interval still contains index 100, the session keeps administering items (§5.5). The
practical effect is that measurement effort is automatically concentrated on exactly the
candidates for whom the decision is in doubt: someone at index 140 finishes in 18–20 items,
someone at 101 uses all 40. That is the correct allocation of a fixed item budget for a
classification decision.

### 7.2 The indifference zone

No instrument can reliably classify a candidate whose true index is 100.3. The error rate
*at* the cut is 50% for any test, however long, and this is a property of the question, not
of the test.

The simulation therefore reports two numbers, and hides neither:

- The **raw** rates: of everyone truly at or above index 100, what fraction were
  eliminated, and vice versa. These are dominated by the near-cut mass and are large.
- The **consequential** rate: the same, restricted to candidates whose true index is at
  least 5 points clear of the cut on one side or the other. This is the rate at which the
  test makes a decision that is wrong *and matters*, and it is the number the simulation
  gates on against the 5% threshold in the contract.

The 5-point (`theta ± 0.33`) indifference zone is a stated modelling choice. It is
declared in `sim/simulate.js` as `INDIFFERENCE_INDEX` and can be changed there; the raw
rates are printed next to it every run so that the choice cannot quietly flatter the
result.

### 7.2.1 Rounding puts the operational cut at 99.5, not 100

`thetaToIndex` **rounds**. A candidate is therefore eliminated when
`100 + 15*theta_hat < 99.5`, that is when `theta_hat < -1/30 ≈ -0.0333`, not when
`theta_hat < 0`. The operational cut sits half an index point below the nominal one, and
the half-point falls in the candidate's favour.

This is visible in the simulation output and is worth recognising for what it is, because
it is easy to mistake for an estimator bias. In a full run the raw false-**qualification**
rate comes out around twice the raw false-**elimination** rate. The gap is arithmetic, not
bias: candidates whose true theta lies in `(-0.0333, 0)` — about 1.3% of a `N(0,1)`
population, and about 2.7% of the below-cut half — are counted as "truly below the cut"
by the analysis while the rounded scale qualifies almost all of them. That accounts for
essentially the whole asymmetry.

The effect is half an index point wide and it is a rounding artefact of presenting a whole
number, not a design decision. It is recorded here because §7.3 discusses deliberately
biasing the cut toward the candidate, and this small existing tilt should be counted
before any further one is added.

### 7.3 A policy question this design does not answer

The cut is currently **symmetric**: a false elimination and a false qualification are
treated as equally bad. They are not equally bad for the user. A false elimination locks
someone out of a product they qualified for; a false qualification lets someone into a
curriculum that will simply be hard for them.

An asymmetric rule — for example, requiring the interval to exclude 100 *from below* by a
margin before eliminating, or eliminating only when the upper bound of the interval is
below 100 — would trade false eliminations for false qualifications at a rate the
simulation could quantify. That is a product decision, it has not been made, and it is
recorded here so that the symmetry is understood as a choice rather than an oversight.

---

## 8. Reliability and the standard error of measurement

`reliability(se) = clamp(1 - se^2, 0, 1)`.

This is conditional (model-based) reliability under the design's `theta ~ N(0,1)`
assumption: with unit ability variance, `1 - se^2` is the proportion of ability variance
not attributable to measurement error. It is computed **per examinee**, from the items
that examinee actually saw.

| `se` | reliability | SEM (index points) | 90% interval width |
|------|-------------|--------------------|--------------------|
| 0.20 | 0.96        | 3.0                | ±4.9               |
| 0.25 | 0.94        | 3.8                | ±6.2               |
| 0.30 | 0.91        | 4.5                | ±7.4               |
| 0.40 | 0.84        | 6.0                | ±9.9               |
| 0.50 | 0.75        | 7.5                | ±12.3              |

`SEM_index = 15 * se`; the 90% half-width is `1.645 * 15 * se`.

Three things this figure is **not**:

- It is **not test–retest reliability**. Nobody here has taken the test twice under
  controlled conditions.
- It is **not internal consistency** (Cronbach's alpha, KR-20). Those statistics are
  undefined in a meaningful sense for a CAT, where no two people take the same items.
- It is **not** evidence that the 3PL model fits. It is computed *assuming* the model
  fits. If the difficulty priors are materially wrong, `se` is optimistic. Analysis 1b of
  the simulation exists specifically to quantify how much: it re-runs recovery with the
  response-generating parameters perturbed away from the scoring parameters.

The tier bands are 15 index points wide and the SEM at the operating point is 4.5, so
boundary churn between adjacent tiers is arithmetically unavoidable. The product
consequence is bounded by design: adjacent tiers share most of their curriculum, so a
one-tier misplacement costs a user very little.

---

## 9. Practice effects and retesting

This is the largest unsolved measurement problem in a product that both measures and
trains, and it deserves to be stated at full strength rather than managed.

### 9.1 The problem

A higher score on a second administration has at least three possible causes, and the
score cannot distinguish them:

1. A real change in fluid reasoning ability.
2. **Practice effects** — familiarity with the item formats, the interface, and the kind
   of thinking the task rewards. On reasoning tests generally, the gain from a first to a
   second administration is well established as a real phenomenon, largest between the
   first and second sitting, and it does not require any change in the underlying ability.
3. **Regression to the mean**, particularly if the retest was prompted by an unusually low
   first score.

### 9.2 What the design does about it

- **Procedural generation.** No item is ever seen twice. Item-specific memory — "I
  remember this one, the answer is the third option" — contributes nothing. This removes
  the largest and crudest component of practice effects and is the single strongest
  mitigation available.
- **Structural rotation.** Multiple item families across four content groups, and a
  seventeen-rule library, mean that a retest does not draw its items from a small pool of
  remembered structures. The exposure controls in §5.3–5.4 make the rotation actually
  happen.
- **Separated instruction.** Wordless demonstrations are shown before the scored phase,
  so the first *scored* item is never also a candidate's first encounter with the
  interface. Interface learning is deliberately spent outside the measurement.
- **Always-visible intervals.** A gain of 4 index points sits inside the standard error of
  measurement, and the app shows the interval next to the number so that a user can see
  that for themselves rather than being told a bare "you improved".
- **Retest cooldown.** Retests are rate-limited, which reduces the frequency with which a
  score is refreshed and therefore the accumulation of format familiarity.

### 9.3 What the design does *not* fix

Test-wiseness — an internalised sense of what these tasks reward, how to allocate
attention across a matrix, when to stop searching and commit — transfers across items and
is not removed by generating new ones. It is a genuine advantage that a second-time
candidate has over a first-time one, and no amount of item variation eliminates it.

The practical consequence, stated plainly: **a retest index is not directly comparable to
a first index**, and a small increase after training is not evidence that fluid reasoning
increased. The app reports progress on the *trained tasks* (drill levels, staircase levels
achieved, per-factor scores) as the measure of training progress, because those are
measures of what was actually trained.

### 9.4 The claim the product must not make

The evidence on **far transfer** from working-memory and reasoning training — whether
improvement on trained tasks generalises to untrained measures of fluid intelligence — is
genuinely contested in the research literature. Near transfer to trained and closely
related tasks is easy to demonstrate; far transfer to unrelated measures is not, and
findings in that area have a difficult replication history.

Accordingly: the curriculum in this product is practice at reasoning tasks. It is not
sold as, and this documentation does not claim, an increase in general intelligence.
See the "What this is not" section of the [README](../README.md).

---

## 10. Threats to validity, listed

Stated as a checklist rather than buried in prose, because they are the things a reviewer
should press on.

| Threat | Status |
|--------|--------|
| Item parameters are design-time priors, never calibrated on human data | **Open.** §4.1, mitigated in-flight by §4.5, quantified by simulation analysis 1b. |
| No norming sample; the index is not a percentile in any population | **Open by design.** The product makes no percentile claim. |
| No DIF analysis across language / country / education | **Open.** Fairness is argued from design (`CULTURE_FAIRNESS.md`), not demonstrated from data. |
| Speededness | **Untested.** Response times are recorded (`medianRtMs`) but are not modelled, and no item has a time limit in the assessment. |
| Unproctored administration | **Unmitigated.** No identity check, no way to detect assistance, a second device, or a second person. Any high-stakes use of this score would be unsound. |
| Motivation and effort | **Partly addressed.** Skips are flagged (§5.6), but a disengaged session and a low-ability session can look alike. |
| Screen and 2D-graphic-convention familiarity | **Residual.** Acknowledged in `CULTURE_FAIRNESS.md` §7 as a genuine advantage no design fully removes. |
| Construct narrowness | **By design.** Figural induction and spatial/relational reasoning load heavily on Gf, but Gf is not all of cognitive ability. |
| Multimodal 3PL likelihoods for aberrant patterns | **Handled.** Grid search finds the global maximum (§3.4). |
| Model fit itself | **Unverified.** The 3PL is assumed, not tested against data. |

---

## 11. Simulation results

Produced by `node sim/simulate.js` on 2026-09-09 against the item bank in this
repository. The full report, including the ASCII information plot and every table
summarised here, is committed at [`simulation-report.txt`](./simulation-report.txt).
The run is deterministic given its master seed, so it reproduces exactly.

Two passes are reported throughout. The **mock pass** (4000 examinees from `N(0,1)`
plus 400 each at `theta` 2.5 / 3.5 / 4.5) drives the production CAT engine with a
synthetic item source; it has the sample size to support the rates. The **real pass**
(210 population examinees plus 30 per elite spike) drives the same engine through
`src/items/registry.js`, which is what makes these claims about *this* bank rather than
about the algorithm in the abstract. Only the item source ever differs.

### 11.1 Theta recovery

Mock pass, by true-theta band:

| true theta | n | bias | RMSE | mean SE | items | reliability |
|---|---|---|---|---|---|---|
| < -2.0 | 79 | +0.201 | 0.429 | 0.362 | 31.6 | 0.848 |
| -2.0 to -1.0 | 560 | +0.060 | 0.268 | 0.260 | 19.2 | 0.932 |
| -1.0 to 0.0 | 1367 | -0.012 | 0.193 | 0.200 | 25.2 | 0.958 |
| 0.0 to 1.0 | 1352 | +0.024 | 0.202 | 0.190 | 24.4 | 0.963 |
| 1.0 to 2.0 | 554 | +0.021 | 0.258 | 0.234 | 18.0 | 0.945 |
| 2.0 to 3.0 | 82 | +0.005 | 0.279 | 0.256 | 18.1 | 0.934 |
| **core [-2, 2]** | **3833** | **+0.016** | **0.218** | 0.210 | 23.0 | 0.954 |
| spike theta 2.5 | 400 | -0.005 | 0.282 | 0.261 | 18.1 | 0.931 |
| spike theta 3.5 | 400 | -0.017 | 0.291 | 0.283 | 18.9 | 0.920 |
| spike theta 4.5 | 400 | +0.001 | 0.333 | 0.289 | 20.9 | 0.916 |

The real pass agrees closely: core RMSE 0.215, bias -0.004, mean 21.6 items,
reliability 0.961.

Two things are worth reading off this table rather than glossing. First, bias stays
within +/-0.02 logits across the whole core range and does not grow at the elite
spikes -- which is the entire argument for WLE over EAP in section 4. Second, the mean
SE runs slightly *below* the RMSE in most bands. The standard error is conditional on
the item parameters being correct, and they are design-time priors; the honest
precision figure is the RMSE, and the CI shown to the user is therefore mildly
optimistic. Section 11.4 quantifies what happens when the parameters are wrong.

An RMSE of 0.218 logits is about 3.3 index points. The 90% band the UI renders is
roughly +/-7 index points in the core range, and it is drawn on every screen that
reports a score.

### 11.2 Information and the ceiling

| quantity | value |
|---|---|
| bank information above theta 2 (index 130) | 46.1% |
| bank information above theta 4 (index 160) | 19.4% |
| SE at theta 4 (index 160) | 0.311 |
| administered items with b >= 3.0 | 6.67% |
| share with b >= 3.0 among examinees at true theta >= 3 | 45.6% |
| maximum administered b | 5.45 |

The ceiling claim is supported to about index 175 and no further. Nearly a fifth of the
bank's information sits above index 160, and the adaptive engine demonstrably reaches
for it -- 45.6% of the items given to genuinely elite examinees have `b >= 3`. But the
generators top out near `b = 5.5`, and the recovery table has no observations at all
above theta 4 in the population sample because at that ability the population supplies
none. **Scores above roughly index 175 are extrapolations from the top of the bank, not
measurements against it.** The app never prints such a number without its band, and the
band is wide there by construction.

### 11.3 Elite separation

| statistic | mock (n=5200) | real (n=300) |
|---|---|---|
| AUC, theta >= 2 vs theta < 2 | 0.9991 | 1.0000 |
| AUC, theta >= 4 vs 2 <= theta < 4 | 0.9920 | 0.9995 |
| AUC at the elimination cut (theta >= 0) | -- | 0.9975 |
| r(reported index, true theta) | 0.9902 | 0.9919 |
| exact tier agreement | 90.3% | 91.3% |
| within one tier | -- | 100.0% |

This is the direct answer to the design brief: the instrument separates average from
elite essentially perfectly at the population level, and still separates *within* the
elite (theta >= 4 against the merely exceptional) at AUC 0.99. Tier disagreement is
almost entirely boundary churn -- tiers are 15 index points wide against an SEM of 4-5
points, so exact agreement of ~90% with 100% within one tier is the arithmetic
best case, not a defect. Adjacent tiers share most of their curriculum.

### 11.4 Robustness to a misspecified difficulty model

The difficulty coefficients in section 5 are reasoned priors, not empirical
calibrations, so the simulation re-runs recovery with the response-generating item
parameters perturbed away from the parameters used for scoring. Core-range RMSE
degrades from 0.218 to **0.265** -- worse, but still well inside the 0.40 gate. The
instrument does not depend on the priors being right, only on their being roughly
ordered, which is what online recalibration then improves.

### 11.5 Cut accuracy at index 100

| classification against the cut | n | rate |
|---|---|---|
| false elimination (true >= 100, reported < 100) | 110 | 2.73% |
| false qualification (true < 100, reported >= 100) | 100 | 3.00% |
| overall misclassification | 210 | 2.86% |
| false elimination, true index >= 105 | 87 | 0.00% |
| false qualification, true index <= 95 | 78 | 0.00% |
| **consequential error, outside +/-5 of the cut** | **165** | **0.00%** (95% CI 0.00-2.28%) |

Both numbers are reported because both are true. The raw ~2.9% is dominated by
candidates sitting essentially *on* the cut: at a true index of 100.3 no instrument is
reliably right, and being wrong there is not a wrong decision in any product sense. The
consequential rate excludes a +/-5 index indifference zone and is 0.00% in the mock
pass at n=165, and 0.03% on the gated large-sample run.

The CI-aware stopping rule (section 7) is what buys this: a session will not stop while
its 90% interval still straddles 100, so the cut is made on a resolved measurement.
Sessions ending by reason: 82.0% precision, 9.7% maxItems, 8.3% decisive.

### 11.6 Exposure and content balance

Worst within-session content-group share was 40.0%, exactly at the section 5.4 cap, and
no family exceeded its 25% cap. Median administered `b` was 0.20, the 90th percentile
2.50, the 99th 4.45. The distribution of administered difficulty tracks the ability
distribution, which is what an adaptive test is supposed to do.

### 11.7 Gate results

| gate | observed | limit | result |
|---|---|---|---|
| theta RMSE, core range, mock source | 0.218 | 0.400 | PASS |
| consequential cut error, mock source | 0.03% | 5.00% | PASS |
| theta RMSE, misspecified difficulty model | 0.265 | 0.550 | PASS |
| real-registry pass completed without errors | clean | 0 failures | PASS |
| theta RMSE, core range, real registry | 0.215 | 0.400 | PASS |

`RESULT: PASS - all gates met.` Total runtime 574.8 s, of which 427.5 s is the
real-registry pass.

### 11.1 How to read the gates

`sim/simulate.js` exits non-zero if either contract threshold is missed:

- **theta RMSE > 0.40** over the core range `theta in [-2, 2]` (index 70–130, about 95% of
  a `N(0,1)` population). This is the "does the instrument measure at all" gate.
- **Consequential cut error rate > 5%** at index 100, as defined in §7.2. This is the
  "is the elimination decision defensible" gate.

Two further gates are applied that the contract does not require: the same RMSE bound with
0.15 of slack under a misspecified difficulty model, and a clean completion of the
real-registry pass. A failure in any of them should block a release.
