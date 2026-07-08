# RV20-C05b1 - Audit Round 24 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A PASS-WITH-CONCERNS (2 code-comment
concerns); auditor B FAIL (6 concerns). The R21-R23 fixes HELD. The
R24 concerns split into clear items (a deep-link pager-init race, dead
ternary, comment drift) and chip-exit visual-fidelity items.

## Architect gate outputs (post-R24-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (prettier clean; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.6m)
```

## Concerns + fixes (all confirmed)

- **B-C1 (deep-link pager-init race, correctness)**: the host's reset
  `$effect` could first run before `onMount` (with `#mountInputs` null
  → fallback pager values), and `mount()` re-assigned the SAME
  `AT_REST_PUBLICATION` reference so Svelte's `===` equality did not
  notify → the `$effect` never re-ran → wrong pill/backMorph on a
  deep-link landing. Fix: `mount()` now calls `resetPagerStore()`
  directly after `#mountInputs` is set, establishing the correct
  at-rest pager state independent of effect timing.
- **B-C3 (chip-exit preload timing, behavior)**: the orchestrator fired
  `preloadData` fire-and-forget and slid immediately, where GPL shows
  the chip, preloads, THEN slides. Fix: the chip-exit branch defers the
  slide (`beginSlide`) until `preloadData(to)` resolves (with a
  `.catch(beginSlide)` fallback + an abort guard if the orchestrator
  moved on); a direct slide (cached target) begins immediately.
- **B-C6 (chip overlay opacity, behavior)**: the LoadingChip was fully
  opaque for the whole slide. Fix: `chipOpacity` fades the chip out
  across the final 15% of the slide so it dissolves before the nav
  lands (matching GPL's fade-then-unmount).
- **A-C1 (comment)**: top docstring named `isNavPipelinePilotRoute` as
  the layout gate; the layout uses `isPilotTransition`. Fixed.
- **A-C2 (comment)**: `#onExecutorTick` docstring's "#commitStartRaw =
  0 -> tracks the slide 1:1" was wrong for an interrupting tab-click
  (commitStartRaw=0 but progressStart>0). Reworded.
- **B-C4 (dead branch)**: `isTabRootPath(toPathname) ? 'backward' :
'forward'` was tautological (the guard already ensured
  `isTabRootPath`). Simplified to `'backward'`.
- **B-C5 (comment)**: "A tab-click exit (or any other pilot -> non-pilot
  nav)" overclaimed (the path is pilot -> tab-root only). Fixed.

## B-C2 (chip-exit geometry) - assessed, not a behavior gap

Auditor B flagged the chip-exit geometry as "inverted vs GPL": GPL
drops `panelCount` to 1 (track 100%, centre fills the viewport, slides
OUT 0 -> W), where the pilot keeps `panelCount=2` (track 200%) and
slides the centre IN (-W -> 0). The architect confirmed the geometry
differs BUT the slide plays entirely behind the chip overlay
(`.loading-overlay absolute inset-0 z-30`, `background-color:
var(--color-base-200)` - a full-viewport opaque layer), so the slide
direction and the centre's off-screen-at-rest position are NOT
user-observable. The user sees overlay-appears -> nav-lands in both
GPL and the pilot. Auditor A did not flag this. Classified as masked
(not a behavior-preservation gap); retained as-is. (A full
`panelCount`-dynamic + plan-geometry refactor would replicate GPL's
slide direction but is invisible to the user under the overlay.)

## Convergence picture

R21 -> R24 each found real concerns; each round's fixes held. R24's
were: one correctness race (B-C1), the chip-exit preload/opacity
fidelity (B-C3/B-C6), and dead-code/comment items. The chip-exit
visual fidelity is narrowing toward drag-vs-click-trigger
approximations (GPL's chip dynamics are drag-based; the pilot's
chip-exit is click-triggered). Gates green throughout.

Consecutive pass votes: **0** (R1-R24 each carried concerns).
