# RV21-C01 Audit 129 (R129)

**Date:** 2026-08-05. **Round:** R129. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

The largest single-round finding set so far: 8 defects across two
sub-classes. Counter stays 0/5.

## Sub-class B (6 sites) -- compose routes mis-classified as non-centerTab

The core factual error: all three compose routes that mount NavPipelineHost
SET `centerTab` (`/post/discussion` centerTab=0; `/messages/new` and
`/messages/add/[userId]` via MessageCompose centerTab=2). So they take
`#republishToPager`'s `centerTab` branch (line 4756, publishes
`backMorph: rawDragFraction` unconditionally) and NEVER reach the
non-centerTab branch (line 4781). Several comments placed compose in the
non-centerTab / "no centerTab" bucket:

- `orchestrator:264-266` (PipelineMountInputs.centerTab docstring) --
  "When undefined ... (compose route, deep page, or tab host)." Compose has
  centerTab set, so it is NOT in the "When undefined" set. Removed "compose
  route."
- `orchestrator:4781` (non-centerTab branch inline comment) -- "No
  centerTab: tab host (bidirectional), compose route, or deep page."
  Removed "compose route."
- `mobile-pager.svelte.ts:21` -- "publishes ... on centerTab thread
  routes" over-narrow (excludes compose). Fixed to "centerTab routes."
- `mobile-pager.svelte.ts:25-26` -- listed "compose" under "every
  NavPipelineHost drag that does NOT pill-map both endpoints to a tab."
  Compose takes the centerTab branch, not this clause (and its endpoints DO
  pill-map). Removed "compose."
- `mobile-pager.svelte.ts:31` + `Header.svelte:214` -- the null-publication
  condition was phrased "the source route is not a centerTab thread," but
  the actual code condition is `centerTab === undefined`. A centerTab
  COMPOSE route satisfies "not a centerTab thread" but is excluded by the
  real check. Fixed to "`centerTab` is undefined."
- `orchestrator:241-242, 247-248, 260` (fromTabIndex/centerTab field
  docstrings) -- "thread host" / "thread route" framing over-narrow
  (compose also sets centerTab). Broadened to "NavPipelineHost (thread and
  compose)" / "centerTab route."

Header.svelte:207 itself correctly groups "deep page, compose, and
centerTab threads alike" -- confirming compose is a centerTab publisher,
which is what made the mis-classification sites factually wrong.

## Sub-class A (2 sites) -- `#headerT` rationale under-describes readers

`#headerT` (the translation dict) is read via `resolveDeepHeaderTitle` at
THREE sites: `playEnterAnimation` (1267-1268), the discrete-nav arm (2984),
and `#armSettleEaseFromGesture` (3457).

- `orchestrator:627-629` (`#headerT` docstring) -- "Kept current so the
  gesture-release settle arming can resolve the back-target title" named
  only reader #3, and "back-target title" is itself over-narrow (the
  gesture target can be `/search`; the discrete-nav reader resolves the
  destination). Fixed to enumerate all three readers and "an endpoint
  title."
- `orchestrator:3978-3983` (`notifyHeaderState` inline comment) -- the
  parenthetical "(which reads `#headerT` ... in `#armSettleEaseFromGesture`)"
  locked the rationale to one reader when three benefit. Broadened to
  enumerate all three.

## Why prior rounds missed these

R120-R128 swept the terminal/startMorph/at-rest/commitStartRaw/
settleStartProgress/displayConfig/priorTerminalSearchProgress/armSettleEase/headerT-rationale
neighborhoods. The compose-`centerTab` classification and the
`mobile-pager.svelte.ts` field docstring were outside every prior lexical
sweep (no round grepped `compose` as a concept across the layer, or
re-derived the `centerTab` branch's reach set against the routes that
actually set it). Each round's re-derivation covers a new field/branch
neighborhood.

## Verify

`bun run check` 0/0; `prettier --check` clean on all 3 edited files; no
U+2014 em-dash; comment-only changes.

## Disposition

Counter after R129: 0/5. 8 defects this round (the most yet) -- the
over-narrow / mis-classification tail is still active, now spanning a new
sub-class (route-`centerTab` classification). Convergence requires the
sweep to cover every field/branch docstring AND re-derive each against the
routes/callers that actually exercise it.

**No git mutation.** No commits, no branches, no pushes.
