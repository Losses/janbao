# DV10-C01 - Implementation Journal

Development log for the DV10 FAB scale drive-model rework implementation. Plan: `docs/DV10-Plan.md` (5/5 PASS, FINAL, after 3 audit rounds). After implementation, a 5-agent role-less full audit (architecture + code quality) runs in a loop; each round's verdicts are recorded in `RV10-C01-Audit-R##.md`. Work is "done" only when a round returns 5/5 unconditional accept.

## The fundamental problem

The FAB scale animation must be a continuous, stable function of the gesture/page transition timeline across every interaction path: tab taps (D↔A↔M), drawer clicks, back-swipes, back-arrow, thread enter/exit, compose, and direction reversal.

The implementation has THREE independent, unsynchronized signals controlling "which FAB is shown" and "what scale it is at":

1. **URL** (`page.url.pathname` → `fabConfig.kind`) — swaps at SvelteKit nav timing (at the START of the slide, when the link is clicked). Determines `fabConfig.family`, `fabConfig.kind`, `fabConfig.tabIndex`.
2. **Track position** (the sampler's `sampledFractionalIndex`, read from `getComputedStyle(track).transform.m41`) — continuous, reflects the actual visual position of the MobileTabPager / GesturePageLayout track. Updated every rAF frame.
3. **CSS transition latch** (`discreteNavInFlight`, a 280ms timer) — fires on family swaps or presence changes, gates the atom's `transition: transform` class.

These three signals change at DIFFERENT TIMES:

- The URL swaps immediately on click (before the slide starts).
- The track starts sliding after the URL swap (CSS transition, 200ms).
- The latch fires via `$effect.pre` in the same flush as the URL change.

The desync causes:

- **Kind flicker**: the URL swap makes the atom switch to the incoming FAB (scale jumps to 0); the next frame, `listDisplayTab` (reading the track position, still near the outgoing tab) overrides back to the outgoing FAB (scale jumps back up). Two jumps in two frames = flicker.
- **Disappear jump**: on a cross-FAB tab swap (messages→discussions), the URL swap at the start makes the atom show discussions immediately. The outgoing messages FAB never scales out — it's replaced instantly. The disappear is a single-frame leap.
- **Instability**: the latch (`discreteNavInFlight`) and the `retainedConfig` / `listDisplayTab` overrides interact across repeated navigations, leaving stale state that suppresses or corrupts later animations.

## What was tried (and why each attempt failed)

1. **v2.1 (deep kind)**: atom unmounted on non-FAB routes. Jump on boundary.
2. **DV10 coverProgress**: replaced the overlay sampler with `pager.coverProgress`. Fixed drag-following (bug B) but the logical-vs-visual gap (coverProgress jumps to endpoint at commit, not tracking the slide) caused the disappear-replay (bug H).
3. **discreteNavInFlight latch + CSS transition**: tried to ease the URL-swap scale jump with a transition latch. The latch fires at the wrong time (same flush as URL swap = scale already changed before transition can catch it); switched to `$effect.pre` (fixes A/C timing) but introduces a TDZ (samplerActive referenced before init).
4. **Always-on sampler**: removed the self-stop so the sampler catches tab-tap slides. Fixed re-arm but the sampler reads the track M41 (visual), while the kind is from the URL (logical) — the kind swaps at the URL change (start), the scale follows the track (delayed), creating a kind/scale mismatch.
5. **listDisplayTab override**: tried to make the kind follow the track position (foreground tab). But listDisplayTab overrides displayConfig AFTER the URL swap, causing a two-frame flicker (URL → incoming, then listDisplayTab → back to outgoing, then track crosses midpoint → incoming again).

Each fix addressed one symptom while introducing another, because the root cause — three unsynchronized signals — was never resolved.

## The question the audit must answer

What is the CORRECT synchronization model for the FAB kind, scale, and the transition timeline? Specifically:

- Should the kind follow the track position (swap at midpoint, scale 0) or the URL (swap at click)?
- Should the scale be driven by the sampler (track m41), coverProgress (store signal), or fractionalIndex (logical, jumps)?
- How should the atom handle the "source-list model" (one atom, kind swaps mid-transition)?
- Is there a single-source-of-truth architecture that eliminates the desync?

## Audit loop

Each round: 5 independent role-less agents examine the current implementation + the user's reported defects + the codebase, and return a verdict. Full detail per round: `RV10-C01-Audit-R##.md`.

## Round 1 audit result: 5/5 UNACCEPTABLE (unanimous)

Full detail: `docs/DV10-Meeting/RV10-C01-Audit-R1.md`.

All five auditors independently confirmed the same root cause: three unsynchronized signals (URL swap at click, track CSS transition over 200ms, discrete-nav latch) drive one atom's kind and scale. The kind and scale change at different frames, producing flicker, jumps, and instability. No override layer (`listDisplayTab`, `retainedConfig`, `discreteNavInFlight`) can synchronize them post-hoc.

### Convergent fix applied

The `effectiveKind` derived is now the **single source of truth** for the FAB kind during any list-family transition. It reads the sampler's `sampledFractionalIndex` (the visual track position) and maps it to the foreground FAB tab (`s < 1 ? discussions : messages`). It is ALWAYS active when the sampler runs, even at integer rest, so the URL-swap frame cannot leak the incoming kind before the track has crossed the midpoint. The kind swaps at the visual midpoint where `scaleFromFraction(2f-1)` guarantees scale 0 for both kinds, making the icon swap invisible.

This eliminates the three-source desync: kind and scale both come from the same sampler signal. The URL only provides the resting kind (SSR / before sampler mounts) and the href/label.

### Verification (post-fix)

- `e2e/fab-deep-real-interaction.spec.ts`: 23/23 pass (A-K original + L-R lifecycle).
- `e2e/fab.spec.ts` + `fab-release-snap.spec.ts` + `fab-deep-page-boundary.spec.ts`: 37/37 pass.
- `bun test src/`: 202/202 pass.
- `bun run check`: 0 errors, 0 warnings.
- prettier + eslint clean.

## Round 2 audit result: 5/5 ACCEPTABLE (unanimous)

Full detail: `docs/DV10-Meeting/RV10-C01-Audit-R2.md`.

All five auditors independently confirmed the R1 root cause (three-signal desync) is eliminated by `effectiveKind`. Kind and scale both derive from the sampler's visual track position. The kind swap happens at the visual midpoint (sample=1) where `scaleFromFraction(2f-1)` guarantees scale 0 for both kinds, making the icon swap invisible.

### F1 fix applied (R2 non-blocking finding)

`stopSampler` now resets `sampledFractionalIndex = null` so a re-arm after a cross-family roundtrip (list -> overlay -> list) does not read a stale value from the previous family for one frame.

### Final verification

- `e2e/fab-deep-real-interaction.spec.ts`: 23/23 pass (A-K + L-R lifecycle).
- `e2e/fab.spec.ts` + `fab-release-snap.spec.ts` + `fab-deep-page-boundary.spec.ts`: 37/37 pass.
- `bun test src/`: 202/202 pass.
- `bun run check`: 0 errors, 0 warnings.
- eslint + prettier clean.

DV10-C01 audit loop converged at Round 2 (5/5 ACCEPTABLE). Implementation is stable.
