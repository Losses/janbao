# DV20 Cycle 5b2 — Handoff Document

**Date:** 2026-07-12. **Author:** the orchestrator agent from the 2026-07-11/12 session. **For:** the next agent continuing the DV20 5b2 audit loop.

## Documents to read FIRST (before touching anything)

1. **`docs/DV20-Meeting/DV20-C05b2-spec.md`** — the cycle spec. Scope, 7 end-state
   items, binding constraints, the 7-phase plan, and **15 Known conditions** (documented
   deviations with justifications + resolution paths). The Known conditions are the bar;
   assess them as known + planned, not as undiscovered divergences.
2. **`docs/DV20-Plan.md`** — the macro architecture. 5-layer pipeline: orchestrator/state
   machine → intent classifier → resolver → coordinator → single all-rAF executor. Key
   sections: §4 (resolver pairs + TransitionPlan), §5 (all-rAF, velocity-matched commit,
   "no CSS transitions, no setTimeout", "no consumer reads back from the DOM"), §9
   (SvelteKit interop, nested sub-pagers), §13 (#3 no shortcuts, #4 UNIFY do-not-bridge,
   #5 state machine sole authority, #6 honesty).
3. **`docs/DV20-Meeting/DV20-C05b2-Handoff.md`** — this document.
4. **`docs/DV20-C05b2-Journal.md`** — the implementation + audit journal (Sessions 1-19).
   Each session documents what changed, key decisions, gate outputs, and deviations. Session
   20 (R10-R12 fixes) was not yet appended — the handoff's "Fixed (this round)" section
   covers it.
5. **`docs/RV20-C05b2-Audit-{10..12}.md`** — the 3 most recent audit rounds. These have
   the latest findings + fixes. Earlier rounds (01-09) are in the same directory.
6. **Memories** (in `~/.claude/projects/.../memory/`): especially `audit-loop-autonomous-
   rolling`, `audit-prompt-must-not-lead` (no scope framing), `audit-prompt-must-not-lead`
   (minimal prompt), `dv20-concern-vs-nitpick-classification` (comment accuracy is always a
   concern), `communication-style-objective-respectful` (no calques, no casual vocab).

**Do NOT read during an audit:** the Journal or prior Audit files are FORBIDDEN for
auditors (they would lead the auditor). The orchestrator (you) reads them for context.

## Current state

DV20 Cycle 5b2 implements the full mobile navigation pipeline rollout: every route
that was on `GesturePageLayout` or `MobileTabPager` now mounts `NavPipelineHost`
or `NavPipelineTabHost`. The new pipeline (all-rAF executor, unified following-visual
model, state-machine authority) is the SOLE transition mechanism for every mobile
route.

**Audit loop progress: R1-R12 complete. Counter: 0/5 (no clean round yet).**
R13 is the next audit round.

**Gate (green):**
- `bun run check`: 0 errors / 0 warnings (1461 files)
- `bun run lint`: EXIT=0
- `bun test src/lib/utils src/lib/stores`: 418 pass / 0 fail
- `bun run test:e2e`: **196 passed** (full suite, all specs)

**Spec:** `docs/DV20-Meeting/DV20-C05b2-spec.md` — 15 Known conditions documented.
**Journal:** `docs/DV20-C05b2-Journal.md` — Sessions 1-19 (need Session 20 for the
R10-R12 fixes).
**Audit files:** `docs/RV20-C05b2-Audit-{01..12}.md`.

## What the next agent must do

### 1. Continue the audit loop (R13+)

Launch R13 with the **MINIMAL prompt** (no scope framing):

```
You are an independent code auditor for the Janbao forum's mobile navigation/gesture
architecture (project "DV20", Cycle 5b2). Find ANY defect empirically in the current
state of the code.

Read `docs/DV20-Meeting/DV20-C05b2-spec.md` (the cycle spec, including its "Known 5b2
conditions" section) and `docs/DV20-Plan.md` (the macro architecture). These define what
the system IS and the bar.

FORBIDDEN: Do NOT read any `docs/DV*-C*-Journal.md` or `docs/RV*-C*-Audit-*.md`. Do NOT
mutate any file. Do NOT run the e2e suite.

Read the code. Form your own judgment. Find ANY defect empirically.

VERDICT: PASS (zero concerns) | PASS-WITH-CONCERNS | FAIL.
FINDINGS: each with severity (HIGH/MED/LOW/CONCERN), file:line, one-line summary, concrete
failure scenario, classification (real behavior defect | comment/doc inaccuracy | missing
coverage | architecture/bridge concern).

Be honest. If you cannot determine something, say "undetermined." Do not pad, invent, or
infer the desired answer.
```

Launch 2 independent auditors (background). Triage both when they return. Fix ALL
findings before launching the next round. The convergence bar is **5 consecutive PASS
votes** (2 per round).

### 2. Fix ALL findings before the next round

**No carrying.** If a round's findings are not fully addressed (fixed or documented as
Known), do NOT launch the next round. Fix everything first. This was a repeated error in
the 2026-07-12 session — findings were "carried" across rounds, causing the loop to
never converge.

### 3. Run the FULL e2e suite

The gate is `bun run test:e2e` (all specs, 196 tests). Do NOT narrow it to a 6-spec
sweep — that misses broken tests in other specs (the R12 audit found 3 HIGH broken tests
that the 6-spec gate missed).

### 4. Use sub-agents when the context window fills

When the context is near-full, launch sub-agents (not "carry to the next window"). The
2026-07-12 session successfully used 3 sub-agents to fix production bugs + e2e tests that
would not have fit in the remaining context.

## Key architecture decisions in 5b2

### The pipeline's signals (pager store)

The pager store (`src/lib/stores/mobile-pager.svelte.ts`) carries these pipeline-specific
fields beyond the legacy `fractionalIndex` / `dragging` / `backMorph` / `coverProgress`:

- **`trackFractionalIndex`**: the tab host's 1:1 track fractional position (replaced the
  old FAB sampler's `getComputedStyle` DOM read-back). Published by the orchestrator from
  `trackTranslateX(plan, executor.progress)`.
- **`committed`**: whether the last gesture release was commit (true) or cancel (false).
  Set synchronously by the orchestrator's release gate; cleared in `#landAtRest` + `unmount`.
  Read by Header Effect B (commit/cancel classification) + Effect D (settle-end on
  committed===null). Replaced the dead `navStore.pendingNav`.
- **`replaceStateIntent`**: whether the original goto used `replaceState: true`. Set by
  `Header.onBack` before `goto(target, { replaceState: true })`. Read by `#dispatchNav`
  to preserve the replaceState intent across the orchestrator's intercept + re-dispatch.

### What was deleted

- `nav-coordinator.ts` (Layer 4): never wired (the skeleton approach replaced its chip-exit
  role).
- `familyNeedsSamplerDuringDrag` (fab-scale.ts): dead after the sampler elimination.
- NavPipelineHost `left` prop + `{:else if left}` branch: unreachable (all tab roots
  intercepted by built-in branches).
- `active-gesture-track` live writers: dead store (kept for dead-file imports pending 5b3).

### What is 5b3 scope (not 5b2)

- Deleting `GesturePageLayout` / `MobileTabPager` / `swipe.ts` / `DualColumnLayout`.
- Removing `backParent` from `RouteData`.
- Overlaying the deep page's cached snapshot during the backward-to-deep slide (Known #9
  visual proxy).
- The Header's morph/title animation migration from CSS transitions + setTimeout to rAF
  (Known #12).

## Key lessons from the 2026-07-12 session

1. **No carrying.** Fix ALL findings before the next round. Carrying wastes rounds (the
   next audit re-discovers the same unfixed items).
2. **No discarding.** Every audit finding is evidence. Never discard results — triage each
   against the current code state (already fixed → confirmed; not yet fixed → fix it).
3. **Minimal prompt only.** No scope framing (file lists, defect-type lists,
   claims-to-verify, trajectory lists, method prescriptions). The prompt is ONLY: spec +
   Plan + "find any defect" + forbidden-reads + output format.
4. **Full e2e suite.** The gate must be `bun run test:e2e` (all specs). Narrow gates
   miss broken tests.
5. **Sub-agents for context limits.** When the context is filling, launch sub-agents to
   continue fixing. Do not push to the next window.
6. **The loop is autonomous.** No stop-checks (the user authorized rolling fix → gate →
   audit without interruption). Only interrupt for architect-level sign-off (macro-plan
   deviations needing human decision).
7. **Comment accuracy is always a concern** (code comments, not .md prose). Stale refs to
   `GesturePageLayout` / `MobileTabPager` / `LoadingChip` / `pendingNav` / the sampler in
   active code comments are concerns, not nitpicks.
8. **Code-comment rule:** no references to superseded implementations. No "formerly GPL...",
   no "old behavior was...", no "previously...". Describe current behavior only.
9. **No em-dashes** (U+2014) in any file covered by eslint `local/no-emdash`.

## Known issues to watch for in R13

1. **NavPipelineHost line 57 orphaned comment**: the `left` prop was removed but a
   blank line / orphaned docstring may remain. Clean it.
2. **NavPipelineHost lines 74/83/92 stale "GPL" references**: comments say "matching
   GPL's enterRaf" / "matching GPL's shouldAnimateEnter" / "matching GPL's
   resolvedLeftHref". These are historical comparisons (GPL is dead) — an auditor might
   flag them. Fix them to describe the current behavior.
3. **`navStore.navInFlight` is read by the Header's CSS-transition gate** (lines ~730-755)
   but never set to true by the pipeline (it's a dead signal). The gate's `navInFlight`
   term is dead (always false). This is part of Known #12 (Header CSS transitions).
4. **Header Effect C/D comments**: the 2026-07-12 session sed-fixed the pendingNav
   comments, but the sed was broad and might have left some inaccuracies. An auditor will
   find them.
5. **The FAB layer still uses `readRenderedFabScale`** (a one-shot DOM read for the
   family-swap ease anchor). Known #1 (reactive race justification; TODO to eliminate).
6. **`pointercancel` is treated as a regular release** (Known #10; fix coupled to 5b3
   `detectSwipe` rework).

## Files the next agent should be familiar with

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` — the universal orchestrator.
- `src/lib/stores/mobile-pager.svelte.ts` — the pager store (committed,
  replaceStateIntent, trackFractionalIndex).
- `src/lib/stores/nav-state-machine-logic.ts` — the state machine reducer (cancel flips
  both macro.plan + activePlan progressDirection).
- `src/lib/components/templates/NavPipelineHost.svelte` — the deep-page/thread/compose host.
- `src/lib/components/templates/NavPipelineTabHost.svelte` — the 3-tab host (bidirectional).
- `src/lib/components/templates/FloatingActionButtonLayer.svelte` — the FAB layer (rAF
  family-swap ease; reads pager.trackFractionalIndex + coverProgress; known DOM read
  readRenderedFabScale).
- `src/lib/components/organisms/Header.svelte` — the Header (reads pager.committed +
  pager.backMorph + pager.replaceStateIntent; tap-morph sync via trackMorph reading
  backMorph; CSS transitions + setTimeout are Known #12).
- `src/lib/utils/history-nav.ts` — `backSwipeShouldPopHistory` (simplified to check
  actual previous history entry, not tab-index).

## The convergence path

If R13 returns clean (2/2), the counter goes to 2/5. Then R14 (4/5), R15 (5/5
convergence). At 5/5, Cycle 5b2 is done. Cycle 5b3 (delete old mechanism + backParent) +
Cycle 6 (offline unification) follow.
