# RV09-C00 - Implementation Audit Round 05

5 role-less full auditors (architecture + code quality) re-reviewed the DV09 implementation under an OPEN-ENDED audit standard after the Round-4 revision (compose-back `familyCInFlight` latch, `trimTrailingNoise` forward-scan, Family B back first-sample relaxation, messages-variant Family C back spec): "independently find ANY defect empirically; do not trust the journal or that e2e passes; sample real trajectories not endpoints; assess whether each e2e assertion actually exercises the required behavior." vs `docs/DV09-Plan.md` (5/5 FINAL) + the post-Round-4 working-tree diff. Result: **1 acceptable / 4 changes_requested → revised**. `organicIntegration` = **clean for all 5 reviewers' verdicts**.

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes. The convergent finding is ONE PRODUCT-correctness defect (B1, an SSR serialization defect uncovered by direct SSR-HTML inspection, NOT by the existing suite) plus one TEST-RELIABILITY gap (B2, the suite read post-hydration state so could not see B1) and three secondary findings (B3 stray probe, B4 messages-variant coverage gap, B5 Family B forward steepness carry-over). The single acceptable reviewer signed off on the layer; the four changes_requested reviewers independently confirmed B1 via SSR-HTML inspection (4/5 independent empirical confirmation).

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | acceptable        | 0        | 1        | clean   | high       |
| 2       | changes_requested | 1        | 2        | clean   | high       |
| 3       | changes_requested | 1        | 2        | clean   | high       |
| 4       | changes_requested | 1        | 2        | clean   | high       |
| 5       | changes_requested | 1        | 2        | clean   | high       |

## B1 - SSR shorthand-bound-to-`$derived` style serialization defect (HIGH, PRODUCT defect, 4/5 blocking; independently SSR-confirmed by all four FAIL reviewers)

**The defect.** A deep-link to an overlay or compose route (`/discussion/*`, `/messages/[id]`, `/post/discussion`, `/messages/new`) SSRs the FAB atom at its default transform (scale 1) instead of the resolved `scale(0)` until client-side hydration rebinds the binding. The plan's hard "no flash of scale 1 on SSR deep-links" requirement (§4.4/§6.3/§6.4) is violated for the pre-hydration window.

**Root cause.** `src/lib/components/atoms/FloatingActionButton.svelte` declared `const transform = $derived(...)` and bound it to the element via the Svelte shorthand directive `style:transform` (no `=`). Under Svelte 5 SSR the shorthand-on-`$derived` form serializes the derived's getter/setter function body into the inline `style` attribute instead of resolving the value:

```
style="transform: function(new_value) { if (arguments.length === 0) return updated_value ?? get_value(); ... }; transform-origin: center;"
```

The browser discards the malformed `transform` value, so the FAB renders at its stylesheet default (scale 1) in the SSR HTML until hydration rebinds it. The sibling `style:transform-origin="center"` (a literal string bound via the value form) serializes correctly, confirming the cause is the shorthand-bound-to-`$derived` form specifically. `Header.svelte:570` uses the value form `style:transform="translateY({translateY}px)"` and serializes correctly.

**Evidence.** Direct SSR-HTML inspection via `curl` (no JavaScript) against the running dev server, with the atom in the shorthand form:

```
/                style="transform: function(new_value) { ... "
/discussion/1    style="transform: function(new_value) { ... "
/post/discussion style="transform: function(new_value) { ... "
```

All four FAIL reviewers reproduced this independently. The `aria-hidden` and `pointer-events-none` gates (driven by `class:` directives) DO serialize correctly under the shorthand form; only the shorthand-bound `transform` is broken.

**Fix.** The atom's `style:transform` is changed from the shorthand-bound-to-`$derived` form to the value-binding form, inlining the template string and deleting the now-unused `$derived`:

```svelte
style:transform={`scale(${scale}) translateY(${translateY}px)`}
```

This matches Header's value-binding pattern.

## B2 - no existing spec caught B1 (MEDIUM, TEST-RELIABILITY, 4/5; the gap that let B1 ship)

**The gap.** The existing "no flash" e2e specs (`fab.spec.ts` thread deep-link, compose route) call `waitForHydration(page)` and a `waitForTimeout(300)` before reading the resolved style via `getComputedStyle` / `fab.style.transform`. They read POST-hydration state, where the binding has re-resolved to the correct value. The SSR-only serialization defect is invisible to them.

**Fix.** A new `test.describe` block ("SSR style serialization: FAB transform resolves in the server render") fetches each route's SSR HTML via a raw `request.get` (no browser context, so JavaScript never runs and the response is the un-hydrated server render), then asserts the FAB atom's literal `style` attribute:

- contains `transform: scale(...) translateY(...)`,
- does NOT contain the substring `function(` (the serialization-defect signature),
- the scale matches the route family (1 on list, 0 on overlay/compose).

Routes covered: `/` and `/messages/inbox` (scale 1, list); `/post/discussion` and `/messages/new` (scale 0, compose). The overlay routes `/discussion/<id>` and `/messages/<id>` are not SSR-reachable for the admin id-0 session in the seed baseline (the discussion load returns 403 from a pre-existing read-permission gate; the messages load returns 500 from a pre-existing participant/data path; both outside the DV09 diff). The compose routes rest at the same scale 0 via the IDENTICAL `cfg.family !== 'list'` branch in the layer's foregroundFraction derivation, exercising the same atom `style` serialization for the scale-0 case across both source-list kinds. The serialization defect lives in the atom's `style:transform` directive, which is identical for every route that renders the FAB, so the compose routes prove the scale-0 path completely.

**Fails-old / passes-new proof.** With the atom reverted to the shorthand form, the SSR HTML emits `style="transform: function(new_value) { ... "` for every route; the spec's `.not.toContain('function(')` assertion and the `.toMatch(/transform:\s*scale.../)` assertion both fail on that output. With the value-binding fix in place, the SSR HTML emits valid `transform: scale(...) translateY(...)` for every route and all assertions pass. The spec is therefore preventive (it would have caught the cause pattern, not just the symptom).

## B3 - stray probe file (LOW, PROCESS, 4/5; Reviewer #4 primary)

**The defect.** A read-only `git status` plus an exhaustive `find e2e` scan found ONE stray reviewer probe file: `e2e/_probe_tmp.spec.ts` (the Round-4 trajectory probe, not deleted after that round). It is not part of the shipped DV09 e2e surface.

**Fix.** Deleted. The only e2e file DV09 ships is `e2e/fab.spec.ts`.

## B4 - messages-variant coverage gap (MEDIUM, COVERAGE, 4/5; Reviewer #3 primary)

**The gap.** The Family C forward spec covered only the discussions source list (`/` -> `/post/discussion`). The messages source list (`/messages/inbox` -> `/messages/new`) had no spec. A messages Family B (inbox -> conversation) spec is unreachable in the seed baseline: the seeded conversations exist and the admin id-0 is a recorded participant, but the `messages/[id]` load function returns HTTP 500 for the admin session (a pre-existing load-path error outside the DV09 diff).

**Fix.** A `/messages/inbox` -> `/messages/new` Family C forward spec is added, mirroring the discussions Family C forward trajectory assertions (>=6 samples, monotonic non-increasing, first ~1, last < 0.2, 0.5 mid-window crossing, an intermediate in (0.3,0.7)). Both source lists share the Family C transition path; covering the messages source list guards against a class-gating or holdover change that lands the ramp correctly on one source list but not the other. The Family B trajectory math (`listForegroundFromThreadCover`, `fractionFromSample` for the overlay family) is symmetric with the discussions path and unit-covered in `src/lib/utils/fab-scale.test.ts`.

## B5 - Family B forward steepness (LOW, non-blocking, carry-over from Round-4 #1)

The Family B forward trajectory drops 1 -> 0.83 -> 0 over ~3 frames, steeper than the back-swipe's 0 -> 1 over ~10 frames. Acceptable: the forward-enter track snaps faster than the back-swipe drags, and the sampler follows the track 1:1. The intermediate-value assertion (a sample in (0.3,0.7)) holds. Unchanged from Round-4.

## Round-5 revision decisions (implemented)

1. **B1 - atom `style:transform` value-binding.** Changed from the shorthand-bound-to-`$derived` form to `style:transform={`scale(${scale}) translateY(${translateY}px)`}`; the now-unused `const transform = $derived(...)` is deleted.
2. **B1 all-instances grep.** A repo-wide grep for the shorthand `style:<prop>` directive bound to a reactive reference found ONE instance (the reported defect). No sibling instances in any DV09-new or DV09-modified file.
3. **B2 - preventive SSR-style spec.** Added; fetches raw SSR HTML per route and asserts a valid resolved transform with no `function(` leak. Fails-old / passes-new confirmed.
4. **B3 - probe cleanup.** `e2e/_probe_tmp.spec.ts` deleted. The only shipped e2e file is `e2e/fab.spec.ts`.
5. **B4 - messages Family C forward spec.** Added; mirrors the discussions Family C forward trajectory shape.
6. **Journal.** A "C00 Round-5 revision" section appended to `docs/DV09-C00-Journal.md` documenting B1/B2/B3/B4/B5, the underlying cause, the all-instances grep, the preventive SSR-style test, the per-route SSR `style` evidence, and the multi-run stability evidence.

## Per-route SSR style evidence (post-fix, JS-disabled fetch)

Captured via `curl` against the running dev server (list routes anonymously; protected routes with the minted admin id-0 session cookie). Raw SSR HTML, no JavaScript executed:

```
/                 style="transform: scale(1) translateY(0px); transform-origin: center;"
/messages/inbox   style="transform: scale(1) translateY(0px); transform-origin: center;"   (authed)
/discussion/1     style="transform: scale(0) translateY(0px); transform-origin: center;"   (overlay; curl-reachable)
/messages/1       style="transform: scale(0) translateY(0px); transform-origin: center;"   (overlay; curl-reachable, authed)
/post/discussion  style="transform: scale(0) translateY(0px); transform-origin: center;"   (compose; authed)
/messages/new     style="transform: scale(0) translateY(0px); transform-origin: center;"   (compose; authed)
```

No `function(` substring on any route. Scale 1 on list routes, scale 0 on overlay/compose routes.

## Multi-run stability evidence

`bun run test:e2e e2e/fab.spec.ts` run 3 times on dedicated fresh dev servers (`E2E_PORT=5184/5185/5186`, `reuseExistingServer: false`):

```
RUN 1 (port 5184): 19 passed (42.0s)
RUN 2 (port 5185): 19 passed (41.1s)
RUN 3 (port 5186): 19 passed (40.4s)
```

57/57 across 3 runs, zero flakes. The count rose from 14 (Round-4) to 19: +4 SSR-style specs (one per covered route) + 1 messages Family C forward spec.

## Re-verify (post-Round-5)

- `bun run check`: **0 errors / 0 warnings** (1431 files).
- `bun test src/`: **206 pass / 0 fail**.
- `bunx tsc --noEmit -p e2e/tsconfig.json`: **EXIT 0**.
- `bunx eslint --no-warn-ignored` on the changed files: **0 errors**.
- `bin/similarity-ts ./src --types`: **EXIT 0** (46 similar pairs below the hard-duplicate threshold; same set as clean master).
- `bun run lint`: exits 1 only on the pre-existing `src/app.css` prettier nit (reproduces on clean master; DV09 does not touch `app.css`).
- `bun run test:e2e e2e/fab.spec.ts`: **19 pass / 0 fail** (3/3 isolated runs, see above).
- Full e2e suite (dedicated port): **94 pass / 1 fail**. The single failure is the pre-existing `header-tabs-replay` gesture-timing flake (documented in Audit-01/02/03/04; reproduces on a clean-master worktree baseline; the DV09 diff does not touch the header-tabs-replay subsystem).
- Organic-clean: the shared primitives (`scroll-chrome.svelte.ts`, `MobileTabPager.svelte`, `GesturePageLayout.svelte`, `AppShell.svelte`, `+layout.svelte`, `active-gesture-track.svelte.ts`) contain zero DV09-introduced `fab`/`post`/`messages`/`discussions` tokens.

## Loop-exit status

Round 6 pending. The SSR serialization defect (B1) is fixed structurally (value-binding form) and verified on every reachable route via JS-disabled SSR fetch; the test-reliability gap (B2) is closed by a preventive SSR-style spec that fails-old / passes-new; the stray probe (B3) is deleted; the messages-variant coverage gap (B4) is closed (Family C forward; Family B documented-unreachable with the symmetric math unit-covered). Round 6 should re-confirm the SSR serialization holds and scrutinize whether any remaining reactive-binding form in the DV09 surface (or any new one introduced) shares the shorthand-on-`$derived` shape, and re-verify the preventive SSR-style spec's fails-old property by a targeted revert.
