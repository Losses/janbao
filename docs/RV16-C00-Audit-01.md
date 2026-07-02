# RV16-C00 - Implementation Audit Round 01 (FINAL)

5 role-less open-ended auditors (architecture + code quality) reviewed the DV16 working-tree diff vs `docs/DV16-Plan.md` (5/5 FINAL plan) + `docs/DV16-C00-Journal.md`. Result: **5/5 acceptable (FINAL)**. All high confidence, all organic=clean, zero blocking. Loop-exit condition met on the first implementation round.

## Tally

| Auditor | Verdict    | Blocking | Concerns | Organic | Confidence |
| ------- | ---------- | -------- | -------- | ------- | ---------- |
| 1       | acceptable | 0        | 3        | clean   | high       |
| 2       | acceptable | 0        | 3        | clean   | high       |
| 3       | acceptable | 0        | 2        | clean   | high       |
| 4       | acceptable | 0        | 2        | clean   | high       |
| 5       | acceptable | 0        | 5        | clean   | high       |

## Confirmed product-correctness (all 5)

- **`foregroundFraction` collapse** (`FloatingActionButtonLayer.svelte:375-400`) is exhaustive and TypeScript-safe: `cfg === null` → 0; `chipExitActive` → 0; `cfg.family === 'list'` → the Family A sampler early-return; otherwise an unconditional `return pager.coverProgress ?? 0`. No code path returns a constant 0 for compose. Compose now reads `coverProgress` like overlay.
- **GPL `coverProgress` gating** (`GesturePageLayout.svelte:386, 423, 432`) publishes `swipeNeedsLoadingAtStart ? 0 : <value>` at the centerTab publish point and the two deep publish points (drag + committed). The at-rest sub-branches (centerTab `let cover = 0`, deep `:441`) already publish 0. `fractionalIndex`/`dragging`/`active`/`backMorph`/`targetIndex` are byte-identical to HEAD in all four `pager.set` calls, so the MobileTabBar pill and the Header morph are unaffected. `swipeNeedsLoadingAtStart` maps 1:1 to the `.loading-overlay` render condition (`:1052`), so it is the complete discriminator for "a LoadingChip covers the content".
- **`chipExitActive`** (`FloatingActionButtonLayer.svelte:351-370`) is byte-identical to HEAD and stays list-only. The FAB now hides during a GPL chip-exit via `coverProgress = 0` (the GPL gate), not via a consumer-side extension.
- **No regression**: `coverProgress` has exactly one consumer in `src` (`FloatingActionButtonLayer.svelte:399`, grep-confirmed), so the GPL gating cannot affect the Header, MobileTabBar, scroll-chrome, or any other reader. All five traced scenarios hold: compose back-swipe (flag false → ramps), deep→deep (false → ramps), cross-tab chip-exit (true → 0, preload + post-preload), forward enter (flag never set), SSR (`coverProgress` null → 0).
- **E2E is non-tautological**: the back-swipe tests assert BOTH `maxPreSwapScale > 0.3` AND `preSwapIntermediateCount > 0` (a ramp in (0.1, 0.9), not a pop); the chip-exit test asserts BOTH `overlayFrames.length > 0` (the chip-exit fired, non-vacuous) AND `maxOverlayScale < 0.1`, sampling the resolved `getComputedStyle(fab).transform` matrix scalar keyed to the live `.loading-overlay` DOM (not to `pendingNav`).
- **Organic-clean**: no `fab`/`post`/`messages`/`discussions` code token enters any shared primitive. The only `FAB` string in the GPL diff is a comment consumer reference; `swipeNeedsLoadingAtStart` and `coverProgress` are general GPL/store concepts.
- **Gates**: `bun run check` 0 errors / 0 warnings (1430 files). `bun test src/` 202 pass / 0 fail. eslint 0 errors on the DV16-touched files. similarity-ts type-duplicates 0. `bun run lint` non-zero only on 9 pre-existing doc prettier nits + the GPL import reformat (now clean); all DV16-touched files are prettier-clean. FAB e2e 39 pass / 0 fail.

## Convergent concerns (non-blocking, all resolved in the RV16-C00 revision)

- **Missing overlay chip-exit test variant (auditors 1, 2, 5).** Plan §7 committed a second chip-exit variant for an overlay route (deep branch); the initial diff shipped only the compose (centerTab) variant. Resolved: the overlay `/bookmarks` cross-tab chip-exit test was added to `e2e/fab-compose-backswipe.spec.ts`, covering the deep-branch gating (`GesturePageLayout.svelte:423, 432`). The 5-test compose spec now passes 5/5.
- **Journal inaccuracy about the GPL import (auditors 1, 2, 3, 4, 5).** The journal claimed the `GesturePageLayout.svelte:27` import was "unchanged by DV16"; the diff reformats it from single-line to multi-line (a formatter-driven prettier fix; the single-line form on master exceeded printWidth). Resolved: the journal's Verify section now states the import was reformatted by the formatter and is prettier-clean.
- **Discrete-back timing vs plan §6.3 "Preserved" (auditor 1).** The discrete back now reads `coverProgress = 1` during the committed slide, so the CSS ease runs during the slide (~200ms) rather than only after the swap, matching the overlay family. Resolved: plan §6.3 is aligned (intentional improvement); journal note (d) already stated it.
- **Stale `isComposeRoute` docstring (auditor 4).** `route-config.ts:235` said "(no pager, no track to sample)". Resolved: refreshed to state compose mounts a GesturePageLayout that publishes `coverProgress`.
- **Awkward double-paren in the `coverProgress` docstring (auditor 5).** Resolved: reworded.
- **Journal line-number drift (auditor 2).** Resolved: gate refs corrected to `:386`/`:423`/`:432`/`:441`.

## Carried-to-future (non-blocking)

- **Chip-exit preload window is sub-frame for a warm target.** The chip-exit e2e guards the post-preload window (the preload micro-task resolves between Svelte flushes for a cached target, so it does not paint). The preload window itself is guarded structurally by `swipeNeedsLoadingAtStart` being set alongside `isPendingNavigation` in the same `beforeNavigate` path. A cold-target variant would paint the preload window; tracked as a future hardening if a reliably-cold cross-tab target becomes available in the seed.
- **Process note (parallel-agents-shared-worktree).** Two of the five auditors performed a brief `git stash` during verification and popped it immediately; the working tree was verified intact (all DV16 diffs present, stash list empty) before the revision. Future audit prompts should re-emphasize the no-git-mutation rule (memory `parallel-agents-shared-worktree-no-git-mutation`); consider a dedicated worktree for verification agents.

## Loop-exit

Implementation-audit loop exit: **5/5 acceptable (FINAL)**. DV16 C00 is implementation-complete: plan 5/5 PASS (3 rounds) plus implementation 5/5 acceptable (1 round). Ready for commit/merge.
