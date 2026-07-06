# RV20-C03 - Audit Round 07 (2-auditor model)

Fourth real-time round under the v2 concern/nitpick classification. Two
auditors (A, B) examined the post-R6 state. The owner issued a
classification correction mid-round (2026-07-05): code-comment accuracy
is ALWAYS a concern, never a borderline nitpick; only `.md` doc text is
a nitpick. Under that correction the round is **not clean** (two
code-comment concerns).

## Prompt sent (clean, non-leading)

Identical in shape to R4/R5/R6, with an added line reinforcing that
every code comment (including test-file headers and field docstrings)
must accurately describe current behavior. No prior-round framing.

## Auditor verdicts (and reclassification under the corrected rule)

- **Auditor A: PASS** as written, but the verdict rested on a
  misclassification. Auditor A called `CoordinatorInput.fromPathname`
  ("Inputs the coordinator reads" while `coordinate()` does not read
  it) a borderline nitpick. Under the owner's corrected rule that is a
  code-comment concern, so the round is not clean on A's own findings.
- **Auditor B: FAIL.** One blocking concern: the `classify` docstring's
  `pointerup` line claimed it cancels "if reversed and below the commit
  threshold," but the code cancels on `reversed` alone; the Layer 2
  classifier has no commit-threshold concept (that lives in `swipe.ts`).

## Concerns (both blocking, both fixed)

1. **`classify` `pointerup` docstring referenced a "commit threshold"
   the code does not have** (auditor B; `nav-intent.ts:222-224`). Fixed
   by rewriting the whole `classify` behavior block to match the code:
   `pointerup` is a no-op unless currently dragging; from `deciding` it
   returns to `idle`; from a drag state it goes to `committed`, or to
   `cancelled` when `reversed`. The rewrite also documents the no-op
   guards auditor B noted as omissions (`pointercancel` from `idle`;
   `tap`/`goto`/`popstate`/`hashchange` when the event carries no
   target).

2. **`CoordinatorInput` docstring overclaimed** (auditor A,
   reclassified; `nav-coordinator.ts:35-37`). "Inputs the coordinator
   reads" while `fromPathname` is carried but unread. Fixed: the
   docstring now names exactly what `coordinate()` reads
   (`toPathname`, `toSubKey`, `toSnapshotCapture`, `cacheHas`,
   `hasToSnippet`) and states `fromPathname` is carried for Cycle 4/5
   and unread in Cycle 3. Verified against the `input.*` reads at
   `nav-coordinator.ts:88,96,106,107`.

## Comprehensive comment-accuracy sweep

Per [[fix-thoroughly-not-band-aid-patches]], after the two fixes I
grepped the five layer files for aggregate docstring claim verbs
("reads"/"writes"/"produces"/"the resolver"/"the coordinator") and
verified each against the code. The other aggregate docstrings are
accurate: the coordinator's `coordinate()` behavior block matches its
three branches; `tabTabResolver` does read `fromTabIndex`/`toTabIndex`
(line 240); the R4 stack docstrings and the R6 `reversed`/test-header
fixes hold. The sweep was grep-targeted on claim verbs, not a
line-by-line read; R8 auditors should still sample freely.

## Added coverage

- `land then reset reaches at-rest (the wrapper microtask flow)` closes
  auditor B's observation that the canonical landing -> at-rest path
  had no explicit reducer-level test.

## Observations (non-blocking, left as-is)

- `'scrubbing'` sub and `progressDirectionFor` `'cancelled'` branch are
  forward-looking (Cycle 4), documented.
- `hashchange` shares the `tap`/`goto`/`popstate` case body; the shared
  path is tested.

## State after R7 fixes

93/93 unit tests pass across the four pure-half suites; `bun run check`
0 errors / 0 warnings; `bun run lint` exit 0 (52 similar-type pairs, 3
transitory/test-fixture); shadow mode preserved.

Consecutive pass votes: **0** (R7 carried two code-comment concerns
under the corrected classification).
