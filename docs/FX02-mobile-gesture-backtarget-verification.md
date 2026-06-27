# Mobile Gesture Back Target Verification Matrix

Verification Target: When navigating back from global routes (`/bookmarks`, `/notifications`, `/profile`, `/search`, `/admin`), does it return to the user's **source tab**, instead of incorrectly returning to `/` (Discussions)?

Related Bugs:

- **Bug 1**: `NavigationStore.init()` omitted `#activeTab` (`src/lib/stores/navigation.svelte.ts:81-99`), causing `backTarget` to be incorrectly calculated as `/` when entering the global route after directly loading a non-Discussions tab.

- **Bug 2**: The panel component `!data` fallback still displays `Loading...` text (`DiscussionsPanel.svelte:102-106`, etc.), which is inconsistent with the gesture `loading-chip` for scaling cards.

## Criteria (oracle)

Each scenario uses three lines of evidence, with the conclusion being consistent:

1. **Code Simulation (Deterministic Primary Criterion)**: Using the app's actual `navigation.svelte.ts`, replicate the `init()` + navigation sequence for each scenario to calculate `backTarget`. The store is purely logical; identical inputs result in identical outputs.

2. **Gesture Landing URL (Ground Truth)**: Trigger a back gesture (drag to the right to reveal the left preview) on the real app, wait for asynchronous submission to complete, and read `location.pathname`.

3. **Left Preview Panel + Cache (Side Evidence / Bug2 Record)**: The panel type rendered in the left preview = `navStore.activeTab`; when the cache is empty, the panel displays `Loading...` (Bug2 remnant).

PASS = Landing URL == Source tab; FAIL = Landing URL == `/` (or other non-source).

## Dimensions

| Dimension | Values ​​|

| ------------ | ---------------------------------------------------------------------------------------------- |

| Entry Method | `hard` (hard URL navigation) / `reload` (refresh) / `tab` (click the bottom tab bar, navigate to switchTab) / `sidebar` (sidebar link) |

| Source Tab | `discussion` (`/`) / `activity` (`/activity`) / `messages` (`/messages/inbox`) |

| Target Global Route | `/bookmarks` / `/notifications` / `/profile` / `/search` / `/admin` |

| Cache Status | Target tab cache: Empty / Full (affects Bug2 presentation and gesture commit branch) |

| Device | Mobile 390×844 + touch (This bug only affects mobile) |

> Note: When the source tab is `discussion`, `init()` fails to set `activeTab`. Harmless (default is 0), expected PASS. This dimension is used as a control group.

## Result Matrix

Inputting during execution. `oracle` = code simulation backTarget; `landed` = gesture landing URL; `preview` = left preview panel (discussion/activity/messages/loading-text); `B2` = whether to display `loading...` text residue.

> `oracle` = `backTarget` calculated using the real `navigation.svelte.ts` replica sequence (deterministic, run in all scenarios).

> `landed` = `location.pathname` after triggering the back gesture in the real app (ground truth, representing that the scenario has been run).

> `preview` = left preview panel content; `B2` = whether to display `loading...` text residue.

> Actual testing shows that the landing is consistent with oracle in all calibration scenarios → oracle is reliable, equivalent scenarios are filled with oracle.

### Group A: Entry Method × Source Tab (Target Fixed `/bookmarks`)

| # | Entry Method | Source Tab | Expected | oracle | landed | preview | B2 | Conclusion |

| --- | -------- | ---------- | --------------- | --------------- | ----------------- | ------------ | --- | -------- |

| A1 | hard | messages | /messages/inbox | `/` | `/` | Loading... | Yes | **FAIL** |

| A2 | hard | activity | /activity | `/` | ≈A1 | ≈ Loading | Yes | **FAIL** |

| A3 | reload | messages | /messages/inbox | `/` | ≈A1 | ≈ Loading | Yes | **FAIL** |

| A4 | tab | messages | /messages/inbox | /messages/inbox | `/messages/inbox` | Real Message List | No | PASS |

| A5 | tab | activity | /activity | /activity | ≈A4 | - | No | PASS |

| A6 | sidebar | messages | /messages/inbox | /messages/inbox | ≈A4 | - | No | PASS |

| A7 | hard | discussion | / (Correct) | `/` | `/` | Real Discussion List | No | PASS |

### Group B: Target Global Route × Source messages (Entry method fixed `hard`)

| # | Target Route | Expected | oracle | landed | preview | B2 | Conclusion |

| --- | -------------- | --------------- | ------ | ------ | --------- | --- | -------- |

| B1 | /bookmarks | /messages/inbox | `/` | =A1 | Loading... | Yes | **FAIL** |

| B2 | /notifications | /messages/inbox | `/` | `/` | Loading... | Yes | **FAIL** |

| B3 | /profile | /messages/inbox | `/` | ≈B2 | ≈Loading | Yes | **FAIL** |

| B4 | /search | /messages/inbox | `/` | ≈B2 | ≈Loading | Yes | **FAIL** |

| B5 | /admin | /messages/inbox | `/` | ≈B2 | ≈Loading | Yes | **FAIL** |

## Summary

> **Status: Fixed and regression passed (2026-06-24).** Bug1/Bug2 fixed; Bun unit test 15/15, Playwright E2E 14/14 all green.

### Regression Results After Fixes

- **Bug 1 Fix**: `#activeTab = tabIdx` is set at the end of `init()` (the logic has been extracted to `initNav` in `src/lib/stores/navigation-logic.ts`, a store delegate). All 8 FAIL scenarios are now PASS (falling back to the source tab).

- **Bug 2 Fix**: The `!data` fallback of `DiscussionsPanel`/`ActivityPanel` has been changed from spinner + `Loading...` text to shared `LoadingChip` (target page icon + text, zoom + pulse). This means the gesture version's `loading-chip` has been extracted to `src/lib/components/atoms/LoadingChip.svelte`, allowing gestures and panels to share the same component.

- **Automation Suite**:

- Unit Test: `bun test src/lib/stores/navigation-logic.test.ts` (11 scenarios + 3 invariants = 15 items).

- E2E: `bun run test:e2e` (= `npx playwright test`, 14 items: calibration self-check + 11 matrices + Bug2 LoadingChip assertion). Uses system chromium (`executablePath`) + CDP real touch gestures; each gesture assertion `[detectSwipe] swipe activated!` is accepted only for landing URLs.

### Count (Before/After Fix)

- Before Fix: **8 FAIL** (A1, A2, A3, B1–B5); **4 PASS** (A4, A5, A6, A7).

- After Fix: **All PASS**.

### Bug 1 Scope of Impact (Confirmed)

- **Triggering Condition**: The source tab (`/activity`, `/messages/inbox`) is accessed via **direct loading** (hard URL navigation / refresh / deep external link) → `init()` omits setting `#activeTab` (keeping the default 0).

- **Affected Routes**: All 5 global routes of `getTabFromPath` (`/bookmarks`, `/notifications`, `/profile`, `/search`, `/admin`) -- they return the current `#activeTab`, thus being misinterpreted as cross-tab navigation from the discussion tab, and `backTarget` degenerates to `/`.

- **Unaffected**: Accessing tab routes via the bottom tab bar or sidebar (using non-global routes like `switchTab` or `handleBeforeNavigate`).Branching, correctly setting activeTab); discussion as the source (default 0 is correct).

### Bug 2 Residual Cells (Confirmed)

- The left preview of the FAIL cell displays `Loading...` (spinner + text) when the target tab cache is empty, which is inconsistent with the gesture `loading-chip` for zooming the card.

- Condition for occurrence: The tab cache pointed to by `backTarget` is not hit (e.g., after directly loading messages, the home has never been accessed → the left preview of the home cache is empty when first going to /bookmarks).

- Code location: `!data` fallback in `DiscussionsPanel.svelte:102-106` and `ActivityPanel.svelte:156/168`.

### Root Cause (Recap)

`NavigationStore.init()` (`src/lib/stores/navigation.svelte.ts:81-99`) only includes `this.#stacks[tabIdx]`, omitting `this.#activeTab = tabIdx`. When directly loading tabs not in this discussion, `#activeTab` retains the default value of 0. Subsequently, when entering the global route, `getTabFromPath` returns this outdated 0, causing `handleBeforeNavigate` to misinterpret it as a tab switch, resulting in `backTarget = activeStack = stack[0] = ["/"]`.

### Fix Suggestions

1. **Bug 1 (Minimum Fix)**: Add `this.#activeTab = tabIdx;` to the end of `init()`. 2. **Bug 1 (Reinforcement, Recommendation)**: Review the semantics of `getTabFromPath` for "sticking to the old activeTab" in global routes-a more reliable approach would be to base the backTarget of global routes directly on the "real source page" (the previous entry in the Navigation API), rather than relying on activeTab for inference.

2. **Bug 2**: Reuse the `!data` fallback of `DiscussionsPanel`/`ActivityPanel` with `loading-chip` (extracting it into a shared `LoadingChip` component, shared by gestures and panels).

### Verification Methodology

- The oracle (code simulation) and the live gesture landing URL are completely consistent in the four calibration scenarios (A1/A4/B2/A7), indicating the oracle is reliable.

- In equivalent scenarios (A2/A3/A5/A6/B1/B3/B4/B5), the same code path is followed, filled with the oracle result, marked with `≈`.
