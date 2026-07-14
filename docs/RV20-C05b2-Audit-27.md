# RV20-C05b2 - Audit Round 27

Result: **A PASS-WITH-CONCERNS (2 CONCERN + 1 observation); B PASS-WITH-CONCERNS
(2 CONCERN).** Counter stays **0/5**. No logic bug this round: the R26
non-pipeline-landing fixes hold, and no new functional defect was found. Five
comment / dead-code concerns remain (four `.ts`/`.svelte.ts`/`.svelte` files,
one atom rewrite).

## Findings

- **A1 (CONCERN)** - `nav-pipeline-orchestrator.svelte.ts:793` `playEnterAnimation`
  docstring said the enter slide runs "over ~200ms". The function passes 0
  release velocity, so the velocity-matched solver returns `COMMIT_T_DEFAULT_MS`
  (300); the inline comment 65 lines below already cited the constant. Fixed:
  "over ~300ms (COMMIT_T_DEFAULT_MS)".
- **A2 (CONCERN)** - `nav-executor-logic.ts:166-172` `CommitInput.durationOverrideMs`
  docstring referenced the deleted `TAB_CLICK_COMMIT_MS` / the 200ms
  `duration-200` match. The override is now set by exactly one caller,
  `#accelerateInFlight`. Fixed: rewritten to describe that sole use (shortening
  the remainder of an in-flight commit a discrete nav interrupted), and to state
  it is undefined for gesture / tab-click / forward-enter / enter-animation
  commits.
- **A3 (CONCERN; A flagged it "observation" but a `.svelte` file is a code
  file)** - `(tabs)/+layout.svelte:66-72` comment mis-described the mobile->desktop
  flip: `NavPipelineTabHost`'s own `matchMedia` handler (registered first via
  child `onMount`) recovers the in-flight transition and tears the host down
  before the layout handler runs, so the layout's `recoverDesktopFlipNav()` is a
  fallback no-op, not a "before torn down" landing. Fixed: rewritten to describe
  the host-fires-first flow; the cheap fallback call is kept (defense in depth).
- **B1 (CONCERN)** - `AppShell.svelte:5` docstring claimed the MobileTabBar
  carries "CSS transitions"; the tab bar is rAF-driven (no transitions). Fixed:
  the phrase is removed.
- **B2 (CONCERN, dead code)** - `LoadingChip.svelte` carried dead gesture code
  from the removed cross-tab overlay: the `dragging`, `scale`, `maxWidth`, and
  `textMaxWidth` props, the `.loading-chip.dragging` CSS rules, the now-dead
  `transition` declarations, and their docstrings. Verified no caller passes any
  of them (`SearchScopePager`, `DiscussionsPanel`, `ActivityPanel` all render
  `<LoadingChip>` with only `icon` / `label`). Fixed: the atom is rewritten as a
  static loading pill (icon / label / expanded / pulsing / opacity; scale
  hardcoded to the 1.15 default; no transitions).

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

e2e identical to the pre-fix state. No behavioral regression.

R28 audits the post-R27-fix state.
