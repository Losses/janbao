# RV15-Plan-Audit-01 - Plan audit round 01

Five independent open-ended auditors (no roles, no steering, read-only, no e2e, no
git mutation) reviewed `docs/DV15-Plan.md` against the code.

## Tally

| Auditor | Verdict           |
| ------- | ----------------- |
| 1       | PASS              |
| 2       | PASS              |
| 3       | changes_requested |
| 4       | PASS              |
| 5       | PASS              |

**4 PASS / 1 changes_requested → round 1 FAIL (not 5/5).**

All five independently confirmed the root cause and that the latch eliminates the
spike; the PASS verdicts were nonetheless explicit that two issues need fixing
before a clean 5/5. The two issues below were flagged by every auditor (as
blocking by auditor 3, as non-blocking by the other four).

## Blocking issues (deduplicated)

### B1 - the cited regression guard is click-only; the gesture deep→tab commit arm is uncovered

`e2e/header-tab-descent-cross-tab-exit.spec.ts:191,200` drives the back leg with
`page.locator('header button').first().click()` - a header back-arrow click, not a
CDP-touch gesture. The click path does not enter Effect B (its tracked deps
`dragging` / `navStore.pendingNav` do not change on a click); Effect C's idle
branch (`Header.svelte:322-336`) sets `settleAwaitTitle = false`, so the morph
settle arm takes the **regular** branch (`:180`, reads `prev`/`current`, never
`target`). The latch `latchedTargetTabs` is therefore never read on this path.

The plan's §6 / §7 claim "deep→tab commit preserved … Guarded by
`header-tab-descent-cross-tab-exit.spec.ts`" is wrong: that spec does not
exercise the gesture deep→tab commit arm where `latchedTargetTabs = true` must
hold `target = 1` so the tab descent animates. The fix is correct on this path by
trace (at release `backTarget` is the tab root → `latchedTargetTabs = true`), but
the preservation is **asserted, not tested**. A future regression breaking the
latch on the gesture deep→tab path would ship undetected. (Flagged blocking by
auditor 3; non-blocking-but-real by auditors 1, 2.)

**Fix:** add a gesture-driven deep→tab descent guard. `/profile/settings` is a
GPL-mounted deep route whose back target is `/` (a tab root), so a `swipeBack`
from `/profile/settings` → `/` is a gesture deep→tab commit. Assert via
`__headerMorphProbe` that `settling === true` AND `morph >= 0.9` are observed
together in the commit window, and that the tabs layer descends through real
intermediate `translateY` px (the `header-tab-descent-cross-tab-exit` trajectory
check). This is the symmetric positive guard to the spike's negative guard.

### B2 - §4.1 and §6 contradict on latch placement vs. the `!navStore.backTarget` guard

- §4.1 places the latch "right after `const inc = ...`" (`Header.svelte:261`),
  which is **before** the `if (!navStore.backTarget)` guard at `:262-266`.
- §6 claims "Effect B's existing `if (!navStore.backTarget)` guard (`:262-266`)
  returns before the latch write; `latchedTargetTabs` retains its prior value",
  which only holds if the latch is **after** the guard.

Both cannot be true. (Flagged by all five.) It is functionally immaterial - when
`backTarget` is null `settling` is not set, so the settle arm never reads the
latch - but the plan ships an internal contradiction on a code-safety claim, and
an implementer following §4.1 verbatim produces code that violates §6.

Auditor 4 further notes `backTargetFor` (`navigation-logic.ts:57-64`) always
returns a non-empty string (stacks are seeded with ≥1 entry), so the
`!navStore.backTarget` branch is effectively dead code; the edge case is
unreachable regardless. The placement should still be specified **after** the
guard so §6's reasoning holds by construction.

**Fix:** amend §4.1 to place the latch **after** the `!navStore.backTarget`
guard, immediately before `if (committed)` (between `Header.svelte:266` and
`:267`). Note in §6 that the guard is effectively dead code
(`backTargetFor` never returns empty), so the null-path reasoning is moot but
the placement keeps the text consistent.

## Notable concerns (non-blocking, to adopt)

- **§3.4 click-path mechanism is wrong (auditors 1, 2, 4).** The plan says the
  back-button path runs "Effect B's clear branch → `settling` stays false → morph
  takes the rest arm". In fact Effect B does not re-run on a click (its tracked
  deps are `dragging` and `navStore.pendingNav`, neither of which changes). The
  title change fires Effect C's idle branch (`:322-336`), which sets
  `settling = true`, `settleAwaitTitle = false`, `settleTarget = 1`, so morph
  takes the settle **regular** arm (`:180`, `prev*(1-p)+current*p`). The
  CALIBRATION result (maxMorph = 0) holds because `prev = 0` and `current = 0`
  on a deep→deep click - but via the regular arm, not the rest arm. Conclusion
  correct, mechanism wrong.
- **Effect C re-arm reasoning is loose (auditors 1, 2, 4, 5).** §6 says the
  re-arm is safe because "the morph endpoint does not change on a title-only
  re-arm". The structural reason: the re-arm path (`:304-317`) sets
  `settleAwaitTitle = false` and `settleTarget = 1`, which forces the morph
  settle arm out of the `awaitTitle`/`targetZero` branches and into the regular
  branch (`:180`) that does not read `target`. `latchedTargetTabs` is unread, not
  "unchanged". Reword.
- **§4.5 cascade is slightly overstated (auditors 2, 5).** `searchProgress`
  (`:588`) and `tabProgress` (`:596`) also read `morph` but are gated on
  `isSearch` (false on every deep→deep route), so they evaluate to 0 and are
  benign. The cascade should say "every visible symptom **on a deep→deep route**"
  and note the two search consumers are inert there. Also name
  `rootLayerStyle`'s `pointer-events` term (`:546`) and `layerDownStyle`'s
  `isDeepToDeep` selectand (`:550`): both evaluate identically across the
  popstate flip when `morph = 0`, leaving no residual.
- **Three-deep chains (auditor 1).** The spike needs the **destination's back**
  to be a tab. A three-deep chain whose destination's back is also deep (e.g.
  `/profile/comments/* → /profile/[id]/*`, where `/profile` is deep) does NOT
  spike - `targetHasTabs` stays false. Auditor 4 (V11) independently verified
  this. Add a sentence: the fix is a no-op on deep→deep→deep shapes whose
  destination-back is deep, and GENERALIZATION's two-deep shape is the minimal
  spike witness.

## Verified-clean (carry forward, consensus)

- **Root cause** confirmed by all five via independent static trace: the
  popstate pop (`navigation-logic.ts:152-154`) flips `backTarget` from the deep
  reveal target to the destination's back (a tab) while `currentPath` lags
  (SvelteKit updates `page.url` at/after `afterNavigate`), so `targetHasTabs`
  flips false→true mid-settle and the commit arm (`Header.svelte:171-174`)
  returns `0·0 + 1·1 = 1`.
- **The latch eliminates the spike** on every deep→deep commit shape traced
  (`/profile/edit→/profile/settings`, `/admin/categories→/admin`,
  `/profile/settings→/profile/[id]`-style). All five confirmed morph holds at 0
  through the settle with the latch applied.
- **Gesture deep→tab descent preserved** (trace): at release `backTarget` is the
  tab root → `latchedTargetTabs = true` → `target = 1` → morph ramps `0→1`.
  B1 above is the missing empirical guard, not a logic gap.
- **Cancel arm safe**: `latchedTargetTabs` is written in the same Effect B
  `untrack` block as the cancel params, and `backTarget` does not mutate on a
  cancel, so latch === live. (All five.)
- **Click / popstate path inert re. the latch**: the regular arm does not read
  `target`. (All five; mechanism corrected per §3.4 note above.)
- **Search path untouched**: `isSearch` false on deep routes; latch and settle
  arm are not on the `searchScrubbing` path. (All five.)
- **SSR clean**: `latchedTargetTabs = $state(false)`; the latch write is in
  Effect B (client-only); SSR render takes the rest arm. (All five.)
- **`releaseConsumed` same-flush re-run**: the `:239` early return fires before
  the latch write (which sits in the `:259-284` `untrack` block). No double-write.
  (All five.)
- **Consumer cascade holds**: every `morph` consumer evaluates identically
  across the popstate flip when `morph = 0`; no consumer expression needs
  editing. `getCurrentTabIndex` already imported (`:35`); no new import. (All
  five.)
- **Latch source alignment**: `latchedTargetTabs` reads `navStore.backTarget` at
  the same Effect B instant as `latchedIncoming` (`:261,269,275`) - identical
  commit-time snapshot, symmetric to the title latch discipline. (Auditor 5 V9.)
- **All line citations accurate** (all five, ±2 lines).
- **Scope honesty**: the deferred unified-transition-record refactor (§4.4/§8) is
  genuine defense-in-depth; the minimal latch closes THIS defect and the
  morph-target divergence. (All five.)

## Revision decisions

Adopt B1 (add the gesture deep→tab descent guard, specified in §7 and §5) and B2
(place the latch after the `!navStore.backTarget` guard; note the guard is
effectively dead code). Correct §3.4 (click path takes the settle regular arm,
not the rest arm; Effect B does not re-run on a click), the Effect C re-arm
wording (the `awaitTitle`/`targetZero` branches stop being taken, so `target` is
unread), §4.5 (name the `isSearch`-gated search consumers and the
`pointer-events` / `isDeepToDeep` terms as inert-at-morph-0), and add the
three-deep-chain note. Re-audit in round 2.
