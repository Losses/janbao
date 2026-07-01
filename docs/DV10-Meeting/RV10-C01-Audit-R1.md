# RV10-C01 - Audit Round 1

5 independent role-less auditors examined the DV10 implementation against the codebase at `6cd2cfa`. Result: **5/5 UNACCEPTABLE** (unanimous). All five independently confirmed the same root cause: three unsynchronized signals (URL swap, track CSS transition, discrete-nav latch) driving one atom's kind and scale, papered over with override layers that cannot synchronize at the frame level.

## Tally

| Auditor | Verdict | Organic |
|---------|---------|---------|
| 1 | UNACCEPTABLE | has-fundamental-architectural-flaw |
| 2 | UNACCEPTABLE | has-fundamental-architectural-flaw |
| 3 | UNACCEPTABLE | has-fundamental-architectural-flaw |
| 4 | UNACCEPTABLE | has-fundamental-architectural-flaw |
| 5 | UNACCEPTABLE | has-fundamental-architectural-flaw |

## Convergent root cause (5/5)

**Kind is derived from `page.url.pathname` (`fabConfig`, FloatingActionButtonLayer.svelte:112-177); scale is derived from the track visual position (sampler m41 for Family A, coverProgress for Family B). These two signals change at different frames. No override layer can synchronize them post-hoc.**

Frame-level mechanism (all 5 independently traced):

- Frame 0 (click/commit): URL swaps → `fabConfig.kind` flips to the incoming tab. Track m41 is still at the outgoing position (CSS transition hasn't started or is at 0%). `listDisplayTab` guard requires non-integer sample — but the stale value IS an integer — so the override doesn't fire. Atom renders incoming-kind at scale 0 for one frame.
- Frame 1+: Track starts sliding (200ms CSS). Sampler reads the moving m41. `listDisplayTab` eventually fires (when sample becomes non-integer), overriding kind back to outgoing. Then at the midpoint, kind flips again to incoming. Three kind switches in 200ms = flicker.

This mechanism produces all reported defects:
- **Kind flicker (messages→discussions)**: three kind switches (URL→listDisplayTab→midpoint).
- **Disappear jump**: the outgoing FAB is replaced by the incoming at scale 0 instantly (URL frame), never scaling out.
- **Repeated-click instability**: the latch state and override residuals accumulate across rapid navigations.
- **Back-swipe disappear-replay (H)**: `coverProgress` jumps to logical endpoint (1) at commit while the track is still sliding.
- **Velocity anomaly**: the atom's CSS transition and the sampler are two clocks running on the same property.

## Convergent target architecture (5/5)

**Kind AND scale must BOTH be pure functions of ONE continuous signal: the live visual track position (sampler m41).**

- `kind` = the foreground tab at the sampled position. Swaps at the midpoint (sample = integer boundary), where `scaleFromFraction(2f-1)` guarantees scale 0 for both kinds — making the icon swap invisible.
- `scale` = `scaleFromFraction(tabFraction(sample, kindTab))`. Same sampler.
- URL enters only as the **resting endpoint** (seed `kind` when sampler is at integer rest) and for mount gating / href / label — NOT during a transition.
- `coverProgress` must either become visual (track the CSS slide through commit, not jump to 1) or be replaced by the same sampler for Family B.
- `discreteNavInFlight`, `listDisplayTab`, `chipExitActive`, `retainedConfig` kind-override — **delete**. They are patches over the missing single-source-of-truth.
- Family C (compose, no track) keeps the CSS transition as its isolated path.

**Two implementation strategies emerged:**

1. **Sampler-owns-everything** (auditors 1-4): the sampler reads `getComputedStyle(track).m41` every frame for BOTH kind and scale. The URL only seeds the resting kind. CoverProgress is either unified into the sampler or fixed to be visual.

2. **Two-phase commit** (auditor 5): the URL swap is deferred to the track transition's midpoint (cancel → slide → commit at transitionend), reusing GesturePageLayout's existing beforeNavigate pattern (:727-811). This aligns the URL swap with the visual midpoint.

Both strategies converge on: one signal for kind+scale, URL demoted to resting/label only.

## Keep vs rewrite (5/5 consensus)

**Keep:**
- `fab-scale.ts` (pure math, `scaleFromFraction(2f-1)` encodes the correct handoff).
- `FloatingActionButton.svelte` atom (single-transform, orthogonal, correct).
- `active-gesture-track` store pattern.
- `mobile-pager.svelte.ts` store factory (drop coverProgress field or make it visual).
- Scroll-hide driver (orthogonal, correct).
- Route-config table (declarative, correct).
- MobileTabPager track geometry + CSS transition.

**Rewrite:**
- `FloatingActionButtonLayer.svelte` core: `fabConfig` URL-derived kind → resting-only; `displayConfig`/`listDisplayTab`/`retainedConfig` → single sampler-driven kind+scale derived; delete `discreteNavInFlight`, `chipExitActive` override, `foregroundFraction` family branching; sampler arms on ALL tracks (unify Family A + B signal source).
- `GesturePageLayout.svelte` coverProgress publishing: stop jumping to logical endpoint at commit; either keep publishing visual position through the slide or let the sampler drive Family B too.
- `MobileTabPager.switchTo` / `MobileTabBar.onclick`: route through a two-phase commit coordinator (extract from GesturePageLayout's beforeNavigate pattern) so the URL swap is deferred to the visual midpoint.

## What happens next

The user has asked for multiple rounds of audit + autonomous fix + comprehensive lifecycle/behavior testing. The next step is Round 2: revise the implementation based on the R1 convergence, then re-audit.
