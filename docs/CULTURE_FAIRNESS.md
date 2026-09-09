# Culture fairness

The product claim is that **a person from any country, any language and any schooling
starts equal**. This document sets out how the design tries to earn that claim, exactly
what is forbidden and enforced, and — at the end, at full strength — what the design does
not fix.

Companion documents: [`PSYCHOMETRICS.md`](./PSYCHOMETRICS.md) for the measurement model,
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the code map.

---

## 1. What "culture-fair" can and cannot mean

A test cannot be made culture-free. Every task is presented on some medium, in some
convention, to a person with a history. What a design *can* do is remove the specific,
identifiable channels through which culture, language and schooling reach the score, and
be explicit about the ones that remain.

The channels removed here are:

- **Language.** No words, in any script, anywhere in a stimulus. Not in the item, not in
  the options, not in the instructions, not in the interface flow.
- **Notation.** No digits, no mathematical or logical symbols, no punctuation used to
  carry meaning.
- **Taught content.** No rule that requires a mathematical fact, procedure or vocabulary
  someone had to be taught. Every rule is a perceptual or relational regularity that can
  be *induced from the item itself*.
- **Cultural iconography.** No symbol that carries a meaning learned from a specific
  religion, nation, game, calendar system or writing tradition.
- **Reading order.** No task whose solution depends on scanning left-to-right, or on any
  other directional habit.
- **Colour vision.** No task where colour is the only way to see the answer, and a
  palette chosen for colour-vision deficiency when colour is used at all.

The channel that is **reduced but not removed** is familiarity with screens and with
two-dimensional graphic conventions. Section 7 deals with that honestly.

---

## 2. The forbidden list

This is the normative list from `CONTRACTS.md` §1.1. It applies to **every item, every
option, every drill stimulus and every wordless demonstration**, without exception.

Forbidden:

- **Letters or words of any script** — Latin, Cyrillic, Greek, CJK, Devanagari, Arabic,
  Hebrew, Thai, Hangul, Ge'ez, Cherokee, and every other. The audit tests Unicode
  letter/digit categories, not an alphabet allowlist, so "any script" is meant literally.
- **Digits or numerals of any script**, and also no tally marks arranged as a numeral
  system. Counting up to five by subitising is allowed (see §3); representing a number by
  a *notation* is not.
- **Mathematical and notational symbols** — plus, minus, times, divide, equals,
  less-than, greater-than, percent, radical, infinity, sigma, pi, and anything else that
  belongs to a notation someone had to be taught.
- **Punctuation used semantically** — question marks and exclamation marks in particular.
  A blank cell in a matrix is drawn as a dashed outline, never as a question mark, because
  "?" is a learned convention of Latin-script typography.
- **Arrows, chevrons used as arrows, check marks and ballot crosses.** An arrow is a
  culturally learned direction symbol and a check mark is a learned correctness symbol.
  Both are replaced by geometry (§5) or by animation (§6).
- **Culturally loaded glyphs** — crescent, five-point star, six-point star, any cross
  form, hooked forms adjacent to a swastika, yin-yang, heart, playing-card suits, musical
  notes, currency marks, traffic signs, flags, hands, faces, animals, clocks, calendars,
  zodiac signs, religious or national emblems, and emoji.
- **Reading-order dependence** that only works left-to-right (§5).

`src/items/shapes.js` exports `FORBIDDEN_KEYS` as a machine-checkable version of the
glyph part of this list:

```
star5, star6, crescent, cross, plus, check, arrow, heart, yinYang,
suitHeart, suitSpade, suitClub, suitDiamond, note, swastika, digit, letter
```

A test asserts that `SHAPE_KEYS` and `FORBIDDEN_KEYS` do not intersect. **An equal-armed
plus/cross primitive is specifically forbidden and must never be added**, because it is
one stroke-weight away from a religious symbol and because it is also a mathematical
operator.

---

## 3. The allowed lexicon

Every stimulus in the entire product is assembled from these primitives and no others
(`src/items/shapes.js`):

```
circle, ring, ellipse, semicircle, quarterDisc, square, roundedSquare, rectangle,
triangleUp, triangleDown, triangleRight, triangleLeft, rightTriangle, diamond,
trapezoid, parallelogram, pentagon, hexagon, octagon, arc, bar, dot, lShape,
tShape, zShape, uShape, notchedSquare, notchedCircle
```

Every one of these is a plain closed or open figure. None of them names anything. None of
them belongs to a writing system or a symbol set. `lShape`, `tShape`, `zShape` and
`uShape` are named after their outlines for the convenience of developers reading the
code; they are polyomino-style geometric forms, and their similarity to certain Latin
letters is coincidental to their construction — they exist because they are the simplest
forms with a distinguishable orientation and chirality, which is what rotation and
reflection rules need.

Attributes that may vary:

| Attribute      | Range | Note |
|----------------|-------|------|
| `shape`        | the 28 keys above | |
| `size`         | 4 steps: `0.42, 0.60, 0.78, 0.96` | relative to the cell; ordered, so a size rule is a visible ordering |
| `fill`         | `empty, solid, hStripe, vStripe, dStripe, dots, half` | texture, not colour: survives greyscale printing and any colour-vision deficiency |
| `color`        | 7 values, index-addressed | Okabe–Ito, see §6 |
| `rotation`     | multiples of 45° | coarse enough to be unambiguous on a small screen |
| `count`        | 1–5 | **always subitisable** — see below |
| `position`     | grid cell | |
| `lineWeight`   | 3 steps: `2, 3.5, 5` | |
| containment    | nesting depth 0–2 | |

**Why `count` stops at five.** Subitising — apprehending a small quantity at a glance,
without counting — works up to about four or five items and is not taught. Counting past
that requires a counting procedure, which is taught, varies with schooling, and is
therefore exactly the kind of thing this test must not measure. Multiple glyphs are also
placed in a fixed symmetric arrangement so that quantity is read as a pattern rather than
enumerated.

---

## 4. Why these rule families

Allowed rule families (`CONTRACTS.md` §1.3, implemented in `src/items/rules.js`):

```
constancy, progression, distributionOfThree, rotation, reflection, translation,
overlayUnion, overlayIntersection, overlayDifference, overlayExclusive,
containment, quantityProgression, sizeOrdering, symmetryCompletion,
sequenceAlternation, attributeSwap, ruleChaining
```

The selection criterion was **perceptual inducibility**: each family is a regularity that
a person can extract from three or four instances by looking, without knowing anything in
advance. They fall into recognisable groups:

- **Invariance and change** (`constancy`, `progression`, `quantityProgression`,
  `sizeOrdering`) — "this stays the same, that increases along an ordered attribute". The
  ordering is visible in the stimulus (a size series is visibly graded), so nothing has to
  be known about numbers.
- **Spatial transformation** (`rotation`, `reflection`, `translation`) — physical
  operations on a figure, all of which have direct real-world analogues (turning an
  object, seeing it in water, sliding it) available to anyone who has handled objects.
- **Set composition** (`overlayUnion`, `overlayIntersection`, `overlayDifference`,
  `overlayExclusive`, `containment`) — what happens when two figures are combined. These
  are set operations, but they are presented as **visible superposition**, never as
  notation. Nobody needs to know the word "intersection" or the symbol for it to see that
  the answer keeps only the strokes that appeared in both.
- **Distribution and completion** (`distributionOfThree`, `symmetryCompletion`,
  `sequenceAlternation`) — "each of these three appears once in every row and column",
  "the figure is symmetric, complete it", "these alternate". `distributionOfThree` is a
  Latin-square constraint and is inducible by anyone who notices that nothing repeats
  along a line.
- **Higher-order** (`attributeSwap`, `ruleChaining`) — relations between relations. These
  carry the difficulty at the top of the bank and are what makes the ceiling reachable.

**Forbidden rules**, equally explicitly: prime numbers, Fibonacci, arithmetic on digit
values, algebraic manipulation, modular arithmetic beyond simple visual cycling, formal
logic notation, anything requiring taught mathematics, anything requiring vocabulary.

The distinction being drawn is between a **regularity you can see** and a **fact you had
to be taught**. "Every third figure repeats" is the first. "These are the primes" is the
second: it looks like a pattern to someone with a particular schooling and looks like
noise to everyone else, so it does not measure reasoning — it measures who went to that
school. The same argument rules out Fibonacci and digit arithmetic. Simple visual cycling
(after the last state comes the first again) is allowed because it is *observable in the
item*: the cycle is shown, not assumed.

---

## 5. Reading-order neutrality

Roughly half the world reads right-to-left or has done historically, and scanning habits
are learned. Two mechanisms are used so that a directional habit confers no advantage:

**Matrix rules are verifiable from both rows and columns.** Where the rule family supports
it, a matrix item's rule set holds along rows *and* along columns. A solver who scans
right-to-left, top-to-bottom, or column-first arrives at the same answer by the same
amount of work. This is a hard requirement on the generators, not a preference.

**Series items carry a geometric direction cue, never an arrow.** A sequence item places
its elements on a visible **track or rail** — a drawn path the elements sit on — so that
the order of the sequence is a property of the geometry rather than of a symbol the solver
must already understand. Arrows are forbidden precisely because "this triangle means go
that way" is a learned convention, not a perceptual fact. A track is not: things laid
along a line have an order you can see.

The blank to be filled is drawn as a **dashed outline** in the position it occupies. It is
never a question mark, and its position within the series is not always terminal — an
interior blank forces the solver to use both sides, which further neutralises scan
direction.

---

## 6. Colour, instructions and chrome

### 6.1 Colour is never the sole information carrier

The palette (`COLORS` in `src/items/shapes.js`) is the seven chromatic values of the
Okabe–Ito colour-vision-deficiency-safe set:

```
#E69F00 orange   #56B4E9 sky blue    #009E73 bluish green   #F0E442 yellow
#0072B2 blue     #D55E00 vermillion  #CC79A7 reddish purple
```

These remain mutually distinguishable under deuteranopia, protanopia and tritanopia, which
between them cover the large majority of colour-vision deficiency.

The stronger rule sits above the palette: **colour is never the only carrier of
information in an item unless the rule is explicitly about colour**, and when it is, the
palette above is what makes it fair. Every other attribute channel — `fill` texture,
`size`, `shape`, `rotation`, `count`, `lineWeight` — is achromatic and independently
sufficient. Item stimuli render as `--stim` ink on `--bg-elev`, a pairing held at 7:1
contrast, so an item works in greyscale.

### 6.2 Instructions are wordless animations

All instruction is delivered by **wordless animated demonstration** (`src/ui/demos.js`).
`demoFor(kindId)` returns `{ frames: [{ svg, ms }], loop: true }` and one exists for every
item family and every drill id. A demo shows a miniature worked example: the stimulus
appears, the transformation plays out, the correct option is indicated *geometrically*
(by a highlight ring, never a check mark), and the loop repeats.

This is not a nicety layered over a text tutorial — it is the only instruction channel
there is. The requirement in `CONTRACTS.md` §1.4 is that **the whole app is operable with
zero reading**, and the demo system is what makes that true.

### 6.3 A label-free UI with an optional language layer

Interface controls are geometric icons (`src/ui/icons.js`), and every flow — start an
assessment, answer, continue, retry, navigate, change a setting — is completable without
reading a single word.

On top of that sits an **optional** chrome layer (`src/ui/i18n.js`) offering labels in
eight languages:

```
English, Español, Português, Русский, العربية, हिन्दी, 中文, Kiswahili
```

The contract's rule is absolute and worth restating: **nothing functional may depend on
`t()`**. `t()` returns `''` for unknown keys and never throws, labels can be switched off
entirely (`settings.showLabels`), and a user who never enables them can complete every
part of the product including training. The languages are a comfort for people who want
them, never a requirement. Right-to-left languages are supported in the chrome layer, and
this changes only the chrome — item stimuli are unaffected, because they have no reading
order to flip (§5).

---

## 7. What is enforced automatically

The rules above are not a style guide. They are checked by code, and the checks run in CI.

### 7.1 `registry.auditItem(item)`

Every generated item can be handed to `auditItem`, which returns `{ ok, problems[] }`. The
markup scan rejects:

- **Glyph-bearing elements** — `text`, `tspan`, `textPath`, `tref`, every `altGlyph` and
  `font-face` variant, `glyph`, `missing-glyph`, `foreignObject`, `image`, `script`,
  `iframe`, `video`, `audio`, `embed`, `object`.
- **Typographic attributes** — anything in the `font-*` family, and any attribute whose
  name indicates text rendering.
- **Letters or digits in any attribute value**, matched by the Unicode property classes
  `\p{L}` and `\p{Nd}` rather than by an alphabet list, so no script is privileged or
  overlooked. Numeric, paint, path-data and points attributes are validated by shape
  instead (a `d` attribute must be path data, a `fill` must be a recognised paint), so a
  letter cannot hide inside one.
- **Non-local references** — `href` / `xlink:href` must point at a local `#id`, so nothing
  can be pulled in from outside the document.
- **XML entities** other than the five standard ones, which blocks numeric character
  references as a route to smuggling a glyph in.
- `style` attribute contents, scanned property by property under the same rules.

`auditItem` also checks structural validity: exactly one option matches `answerId`, option
ids are unique, no two options are byte-identical, the option count is 6 or 8, and every
`meta` field is present and inside its documented range.

### 7.2 `test/items.test.js`

The unit suite generates a large sample of items **across all families** and asserts, per
`CONTRACTS.md` §22, that every one passes the audit, that `SHAPE_KEYS` and
`FORBIDDEN_KEYS` are disjoint, and that no item SVG contains a `<text>` element. Run with
`npm test`.

### 7.3 `tools/audit-culture.mjs`

A standalone auditor that goes wider than the unit suite: it samples items across every
family, **the first trial of every drill**, and **every wordless demo**, and reports any
markup that could put a letter, digit or cultural glyph in front of a candidate. Run it
with `node tools/audit-culture.mjs [n]` (default 400 items).

The reason it exists separately from `test/items.test.js` is coverage of the two surfaces
that unit tests do not naturally reach: drill stimuli, which are generated by a different
code path from assessment items, and demos, which are the *instruction* channel and would
be the most damaging place for a stray glyph to appear.

---

## 8. The limits, stated plainly

Everything above is real, and none of it makes the test culture-free. The honest residuals:

**Screen familiarity.** A candidate who has used touchscreens and pointing devices all
their life will spend none of their attention on the interface. A candidate meeting one for
the first time will spend some, and attention spent on the interface is attention not spent
on the item. The wordless demos, the large touch targets and the absence of any timed
element in the assessment reduce this; nothing removes it.

**Two-dimensional graphic conventions.** This is the deepest residual and the hardest to
argue away. Reading a flat drawing as a representation of a form, understanding that a
figure on a page can be "rotated", accepting that a dashed outline means "something goes
here" — these are conventions of graphic literacy, and graphic literacy is *taught*,
mostly by schooling and by exposure to printed and screen media. The evidence that
performance on figural reasoning tasks varies with familiarity with pictorial conventions
is longstanding and generally accepted. A test made entirely of abstract 2D figures
cannot be neutral with respect to 2D figure literacy — it can only be neutral with respect
to *which* culture's figures.

**Test-taking familiarity.** Knowing what a multiple-choice item is, that exactly one
option is intended, that guessing is permitted, that you should keep going when an item is
hard — these are all learned, largely at school. The wordless demos teach the mechanics but
not the disposition.

**Self-selection.** The people who take an online reasoning test are not a random sample of
anybody. Nothing in the design touches this, and it is why `PSYCHOMETRICS.md` refuses to
call the index a percentile.

**Motivation and conditions.** Unproctored administration means a candidate's score
reflects their circumstances — noise, interruptions, the device they had — as well as their
reasoning. This falls unevenly across populations, and it falls hardest on exactly the
candidates the fairness argument is meant to protect.

**Fairness here is argued, not measured.** Every claim in this document is a claim about
*design*. The empirical test of fairness is differential item functioning analysis across
language, country and education groups — asking whether two candidates of equal measured
ability but different background have different odds on the same item. That analysis
requires a response dataset that does not yet exist. Until it does, this document should
be read as a statement of what the design intends and enforces, and not as evidence that
the intention succeeded.
