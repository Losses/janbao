# RV15-C00-Audit-01 - Implementation audit round 01

Five independent open-ended auditors (no roles, no steering, read-only, no e2e,
no git mutation) reviewed the C00 implementation (the actual `git diff` - 3
files, +58/−1: `Header.svelte`, `header-probe.ts`, the e2e spec) against the
approved plan `DV15-Plan.md` and journal `DV15-C00-Journal.md`.

## Tally

| Auditor | Verdict |
| ------- | ------- |
| 1       | PASS    |
| 2       | PASS    |
| 3       | PASS    |
| 4       | PASS    |
| 5       | PASS    |

**5/5 PASS → C00 round 1 PASS. Implementation accepted.**

All five independently confirmed the diff implements plan §4.1 (latch state at
`Header.svelte:94`, latch write at `:272` after the `!navStore.backTarget` guard
before the `if (committed)` split, morph settle arm read at `:163`), that the
fix eliminates the deep→deep spike (morph holds 0) while preserving the deep→tab
descent (morph ramps to 1), and that cancel / click / search / SSR / re-arm /
`releaseConsumed` / null-`backTarget` / probe-tracking paths are all inert. No
blocking issues.

## Blocking issues

None.

## Notable concerns (non-blocking, adopted where trivial)

- **N1 - PRESERVE trajectory witness captures drag-phase morph, not settle-phase
  descent (auditors 1, 3, 4, 5).** `settleProgress` jumps to `settleTarget` in a
  single rAF (`Header.svelte:runSettleDriver`), so the post-release settle is one
  morph jump animated by the CSS transition; the ≥3 intermediate morph buckets
  the assertion counts are dominated by the drag-phase `pager.backMorph` ramp.
  The load-bearing assertions are `commitFrame` (`settling && morph >= 0.9`, a
  genuine settle-arm witness that fails on any regression driving morph toward 0)
  and `commitFrame.latchedTargetTabs === true` (proves the latch write ran). The
  post-release descent's px-level animation is covered by
  `header-tab-descent-cross-tab-exit` (rAF computed-px sampler, green). The
  combination is sound; the bucket count is a softer trajectory guard than plan
  §7's literal translateY-px sampler. Journal discloses the deviation.
- **N2 - regression sweep narrower than plan §7 (auditors 2, 4).** The journal's
  original "15/15" covered 5 Header-direct neighbours. The 3 omitted
  GesturePageLayout/pager/animation specs (`swipe-back-pill-flicker`,
  `tab-exit-preview`, `enter-animation`) were run after the audit flagged this:
  **11/11 pass**, bringing the sweep to **26 tests across 8 specs**.
  `header-title-crossfade-clip` is a separate pre-existing OPEN defect
  (clip-container geometry), out of scope.
- **N3 - PRESERVE comment overstates novelty (auditor 4).** The comment named
  only `header-tab-descent-cross-tab-exit` as click-only; it did not acknowledge
  `header-tabs-replay.spec.ts` already gesture-covers the same arm
  (`swipeBackHalf /profile/settings → /messages/inbox`) for its no-snap-replay
  invariant. Adopted: the comment now frames PRESERVE as the additive
  `latchedTargetTabs` commit-frame witness, not sole coverage.
- **N4 - latch write simplified vs plan §4.1 (auditor 4).** The plan's snippet
  carried a defensive `navStore.backTarget ? ... : false` ternary; the
  implementation writes `getCurrentTabIndex(navStore.backTarget) >= 0` bare. Safe
  by construction: the `!navStore.backTarget` guard (`:267-271`) precedes the
  write, and `backTargetFor` never returns empty. No change.
- **N5 - `commitFrame.latchedTargetTabs === true` not load-bearing (auditor 5).**
  Effect B writes the latch unconditionally on release, so this assertion would
  pass even if the morph arm regressed to the live read. The load-bearing
  assertion is `commitFrame` itself. Documentary; kept.
- **N6 - `settling ?` gate defensive/inert (auditors 1, 2, 5).** `$effect.pre`
  writes `settling` and the latch in the same flush; the pre-latch release window
  does not open in observable renders. Kept for readability.

## Verified-clean (consensus, all five)

- Diff implements plan §4.1 verbatim (state `:94`, write `:272`, read `:163`);
  `getCurrentTabIndex` already imported (`:35`); no new import, no new type
  (plain `boolean`), interface-first / zero-inline-typing rules respected.
- Deep→deep commit (`/profile/edit → /profile/settings`): latch freezes the
  reveal target's tab-ness (`false`) before the popstate flips live
  `targetHasTabs` to true; morph holds 0 through every settle flush; the
  `0·0 + 1·1 = 1` spike is gone. DEFECT/GENERALIZATION `maxMorph 1.000 → 0.000`.
- Deep→tab commit (`/profile/settings → /`): latch `true` → `target = 1` → morph
  ramps to 1; tab descent preserved (PRESERVE + `header-tab-descent-cross-tab-exit`
  - `header-tabs-replay` green).
- Cancel: latch written before the commit/cancel split; `backTarget` does not
  mutate on cancel → latch === live → cancel-arm morph unchanged.
- Effect C re-arm / click / popstate: `settleAwaitTitle = false` forces the
  regular arm (`prev`/`current`), which does not read `target`; latch unread.
- `releaseConsumed` same-flush re-run: the `:244` early return fires before the
  latch write; no double-write.
- Null-`backTarget`: `backTargetFor` never returns empty (seeded stacks), so the
  guard is dead code; placement after it holds §6's reasoning by construction.
- Probe `$effect`: adding `latchedTargetTabs` is a snapshot read into a
  non-state window sink; no re-run loop.
- SSR: `$state(false)` default; latch write is `$effect.pre` (client-only); SSR
  render reads live `targetHasTabs` (unchanged).
- PRESERVE is a genuine gesture deep→tab commit (`swipeBack` = real CDP touch);
  non-vacuous (fails on a stuck-false or stuck-true latch).
- Diff is Header-local: only `Header.svelte`, `header-probe.ts`, the e2e spec;
  no touch to `navigation.svelte.ts`, `navigation-logic.ts`,
  `GesturePageLayout.svelte`, `mobile-pager`, or any shared primitive.
- Journal claims consistent with the diff (empirical e2e results UNVERIFIED per
  the read-only/no-e2e constraint, but consistent with the trace).

## Deviation assessment

Acceptable. The single semantic deviation (PRESERVE morph-bucket trajectory
witness vs plan §7's translateY-px sampler) is equivalent (morph is the 1:1
input to `rootLayerStyle` translateY) and more robust (paint-independent probe);
the load-bearing commit-frame assertion is settle-specific and discriminating.
The latch-write simplification (N4) is safe by construction. The regression-sweep
gap (N2) is closed by the 11/11 supplemental run.

## Revision decisions

Adopt N3 (PRESERVE comment accuracy). N1/N5/N6 are documentary (no code change;
the load-bearing assertions are correct). N2 is closed by the supplemental
regression run (journal updated). N4 needs no change (safe by construction).
`bun run check` 0/0 stands (no code-behaviour change in the revision - a comment
only). **DV15-C00 COMPLETE at 5/5.**
