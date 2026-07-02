# DV15 - Deep→deep gesture-back morph spike (structural fix)

## 1. Goal

Close the whole live-read divergence class in the Header settle state machine,
and subsume the in-tree minimal latch into one unified model.

The VISIBLE spike (arrow→hamburger→arrow + tabs sink/float on a deep→deep
gesture commit) is already eliminated in the working tree by the minimal latch
`latchedTargetTabs` (`Header.svelte:94`/`:272`, read at `:163`), verified at
`maxMorph = 0.000` (`DV15-C00-Journal.md`). That minimal latch is a band-aid: it
closed ONE instance (the morph commit `target`) and left the structural root
intact - the settle state machine and its consumers still read endpoint identity
from LIVE path/`backTarget`-derived values (`currentHasTabs`, `targetHasTabs`,
`isDeepToDeep`) while a settle is in flight across a navigation that mutates
them. The title arm was already latched (`latchedOutgoing`/`latchedIncoming`),
so the Header maintains TWO representations of one transition's endpoints -
latched titles vs live tab-ness - that can diverge. The minimal latch patched
the row that bit; the remaining live reads (morph `current`/`prev`,
`rootLayerStyle`, `layerDownStyle`, `iconProgress`) are the same class, latent
today (benign only because `morph=0` collapses them on the spike path) and ready
for the next sibling.

This plan fixes the cause (`fix-thoroughly-not-band-aid-patches`): ONE latched
transition record is the sole source of endpoint identity for `titleView`, the
morph settle arm, and the layer styles during any settle (gesture commit/cancel
and click). No settling consumer reads a live `currentHasTabs`/`targetHasTabs`/
`backTarget`. The minimal latch is subsumed; the divergence class is eliminated,
not patched.

## 2. Confirmed requirements (owner-locked)

- On a deep→deep gesture-back commit, `morph` never leaves the deep rest band
  (`≤ 0.25`) from drag start through settle end (the minimal latch already
  satisfies this; the structural fix preserves it).
- The deep→tab gesture-back commit still animates the tab descent (morph ramps
  `0 → 1`); `header-tab-descent-cross-tab-exit.spec.ts` stays green.
- The deep→deep title crossfade (`header-title-crossfade-clip.spec.ts`) is
  unaffected.
- The back-button / click / popstate paths still settle correctly.
- The fix is Header-local.
- The fix covers ALL instances of the cause pattern (every live endpoint-identity
  read during a settle), the minimal latch is subsumed, and a source-attributing
  preventive test guards the pattern.

## 3. Architecture context (verified inventory, current tree)

### 3.1 The morph state machine and its consumers

`morph` (`Header.svelte:145-193`) has four arms: drag (`:148-150`, hardcoded 0
when `isDeepToDeep`), search scrub (`:155-158`), settle (`:161-186`), rest
(`:189`). The settle arm currently reads `current = currentHasTabs` (`:162`),
`target = (settling ? latchedTargetTabs : targetHasTabs)` (`:163`, the in-tree
minimal latch), `prev = prevHasTabs` (`:164`).

`targetHasTabs` (`:67-69`) derives from LIVE `navStore.backTarget`. `currentHasTabs`
(`:66`) from LIVE `currentPath`. `prevHasTabs` (`:134`) from `prevPath`.
`iconProgress` (`:202`) reads live `currentHasTabs` (search-gated).

Consumers reading LIVE endpoint identity during a settle:

- morph settle arm `current` (`:162`) and `prev` (`:164`) - `target` (`:163`) is
  already latched (the minimal latch);
- `rootLayerStyle` translateY `!(currentHasTabs || targetHasTabs)` and
  pointer-events `morph > 0.5 && targetHasTabs` (`:550`, `:552`);
- `layerDownStyle` via `isDeepToDeep = !currentHasTabs && !targetHasTabs`
  (`:70`, `:556`);
- `iconProgress` (`:202`, search-scoped, benign).

The title side is already latched: `latchedOutgoing`/`latchedIncoming` are set in
Effect B (`:274-275`/`:280-281`) and Effect C idle, and `titleView` (`:518-542`)
reads them.

### 3.2 Why the live reads diverge on a deep→deep commit

Stack `/ → /profile/settings → /profile/edit` (both `/profile/*` are
`GLOBAL_PREFIXES`, sharing tab 0's stack). On gesture-back from `/profile/edit`,
the reveal target is `/profile/settings` (deep). At release Effect B arms the
settle. The slide `transitionend` → `executePendingNav` → `history.back()` →
`beforeNavigate` → `handleBeforeNavigateNav` popstate branch
(`navigation-logic.ts:152-154`) pops `/profile/edit`, so `backTargetFor`
re-derives to `/` (a TAB). **Live `targetHasTabs` flips false→true** while
`currentPath` is still `/profile/edit` (updates at/after `afterNavigate`).

Pre-minimal-latch that flip made the morph commit arm `0·0 + 1·1 = 1` → the
visible spike. The minimal latch froze `target`, so morph stays 0 today. But the
same live-flip mechanism still reaches `rootLayerStyle`/`layerDownStyle`
(benign only because morph=0) and would reach any future consumer that reads
live endpoint identity mid-settle. Separately, morph `current` (`:162`) is still
live: on a deep→tab commit, `currentPath` flips 0→1 at landing mid-settle, so
`current` mutates under the settle (a latent discontinuity, minor today because
`settleProgress≈1` at landing). The structural fix freezes ALL endpoint identity
for the whole settle.

### 3.3 The full live-read surface (the cause pattern, ALL instances)

| Site                                | Live value read during settle                        | Status                                                                                 |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| morph `target` (`:163`)             | `targetHasTabs`                                      | already mitigated by `latchedTargetTabs` (minimal latch); structural fix subsumes it   |
| morph `current` (`:162`)            | `currentHasTabs` (currentPath)                       | live; mutates source→dest during the settle (latent discontinuity on deep→tab landing) |
| morph `prev` (`:164`)               | `prevHasTabs` (prevPath)                             | live; regular/click arm (stable during a click settle today)                           |
| `rootLayerStyle` (`:550`,`:552`)    | `currentHasTabs`\|\|`targetHasTabs`, `targetHasTabs` | live; benign only because morph=0                                                      |
| `layerDownStyle` (`:556` via `:70`) | `isDeepToDeep`                                       | live; benign only because morph=0                                                      |
| `iconProgress` (`:202`)             | `currentHasTabs`                                     | live; search-gated (`isSearch`/`searchScrubbing`), off the deep→deep path              |

The minimal latch covered only row 1. The structural fix covers the rest by
making the latched record the sole source during settle. `iconProgress` (`:202`)
stays live - it is search-scoped and off every settle path the record owns (§4.6).
`rootLayerStyle`'s `isSearch` term (`:547`) is a further live read, correctly
excluded (stable on every settle path - root↔search owns the scrub arm, not the
settle arm). morph `prev` (`:164`) is a special case: it does not diverge today
(`prevPath` updates once per nav, then holds within a click settle), but the §4.2
collapse folds it into the record anyway as the click arm's `outgoingHasTabs`
(captured from `prevPath` at Effect C idle) - a side effect of unifying the
formula, not a separate fix.

### 3.4 Empirical confirmation (historical)

`window.__headerMorphProbe` captured the spike frame paint-independently BEFORE
the minimal latch, identical across `/profile` and `/admin`: `morph=1 settling=true
settleProgress=1 awaitTitle=true currentHasTabs=false targetHasTabs=true
navInFlight=true pendingNav=null`. After the minimal latch, DEFECT/GENERALIZATION
read `maxMorph = 0.000` (the visible spike is gone). The structural fix is
defense-in-depth + class closure, verified by the source-attributing preventive
test (§7), not by re-surfacing the spike.

## 4. Design

### 4.1 One latched transition record, the sole endpoint source during a settle

```ts
interface HeaderSettleTransition {
	outgoingTitle: string;
	incomingTitle: string;
	outgoingHasTabs: boolean;
	incomingHasTabs: boolean;
}
// null at rest (no settle in flight); consumers fall back to live values then.
let latchedSettle = $state<HeaderSettleTransition | null>(null);
```

Arm it at all THREE settle sources, capturing the real transition endpoints:

- **Effect B (gesture release, `:242-292`)** - outgoing = the current page,
  incoming = the reveal target (`navStore.backTarget`), frozen at release:
  ```ts
  latchedSettle = {
  	outgoingTitle: title,
  	incomingTitle: inc, // resolveDeepHeaderTitle(backTarget)
  	outgoingHasTabs: currentHasTabs,
  	incomingHasTabs: getCurrentTabIndex(navStore.backTarget) >= 0
  };
  ```
- **Effect C idle (click / back-button / popstate, `:327-342`)** - outgoing = the
  page being left, incoming = the page being landed on (`currentPath`, already
  the destination when the title change fires):
  ```ts
  latchedSettle = {
  	outgoingTitle: restTitle,
  	incomingTitle: newTitle,
  	outgoingHasTabs: prevPath ? getCurrentTabIndex(prevPath) >= 0 : currentHasTabs,
  	incomingHasTabs: getCurrentTabIndex(currentPath) >= 0
  };
  ```
  (The `prevPath ? ... : currentHasTabs` fallback matches today's `prevHasTabs`.)
- **Effect C re-arm (rapid back-to-back nav, `:312-323`)** - the old incoming
  becomes the new outgoing; the new title's page (`currentPath`) is the new
  incoming:
  ```ts
  latchedSettle = {
  	outgoingTitle: latchedSettle.incomingTitle,
  	incomingTitle: newTitle,
  	outgoingHasTabs: latchedSettle.incomingHasTabs,
  	incomingHasTabs: getCurrentTabIndex(currentPath) >= 0
  };
  ```

`endSettle()` AND the Effect B CLEAR branch (`:249-261`) set
`latchedSettle = null`. All three arming effects are `$effect.pre`, so the record
is written in the same flush as `settling=true`, visible to `morph` at render.

### 4.2 The morph settle arm collapses to one formula

With endpoint identity frozen in the record, the three sub-arms (awaitTitle /
targetZero / regular) are algebraically one interpolation - they differ only in
the `(outgoing, incoming)` mapping (in the record) and the `settleProgress`
direction (`settleTarget`: 1 for commit/click, 0 for cancel):

```ts
if (latchedSettle) {
	const outgoing = latchedSettle.outgoingHasTabs ? 1 : 0;
	const incoming = latchedSettle.incomingHasTabs ? 1 : 0;
	// Retain today's m-continuity bridge (`progress = settling ? settleProgress
	// : lastGestureMorph`, `:166`). Effect B writes `settleProgress = m` in the
	// same `$effect.pre` flush as the record, so this normally reads
	// `settleProgress`; the `lastGestureMorph` arm is defensive cover for any
	// device/timing path where the sub-flush release window renders (memory
	// `svelte-effect-pre-same-flush-rerun`: `$effect.pre` timing is not always
	// statically predictable).
	const progress = settling ? settleProgress : lastGestureMorph;
	return outgoing * (1 - progress) + incoming * progress;
}
// no else: fall through to the rest branch (currentHasTabs ? 1 : 0) if the
// record is null (safe degradation; cannot render in normal operation).
```

- commit: outgoing=current, incoming=reveal → deep→deep holds 0; deep→tab ramps
  to 1 (descent preserved).
- cancel: same record, `settleTarget=0` → morph→outgoing (retreat).
- click: outgoing=prev, incoming=current → the real click transition.

The `progress = settling ? settleProgress : lastGestureMorph` continuity bridge
(`:166`) is RETAINED (not dropped): Effect B sets `settleProgress = m` (`:285`)
in the same `$effect.pre` flush as the record, so this normally reads
`settleProgress`; the `lastGestureMorph` arm is defensive cover for any
device/timing path where the sub-flush release window renders (memory
`svelte-effect-pre-same-flush-rerun`). The arm collapses the awaitTitle/targetZero/
regular branching in the morph formula; `settleTarget` (direction) and
`settleAwaitTitle` (end timing) are unchanged.

### 4.3 The layer styles read the record during a settle (NOR, not NAND)

```ts
// Hoist these to top-level $derived so rootLayerStyle, layerDownStyle, AND the
// probe (aliased effectiveTabsOut/In) all consume the SAME source.
const tabsOut = $derived(latchedSettle ? latchedSettle.outgoingHasTabs : currentHasTabs);
const tabsIn = $derived(latchedSettle ? latchedSettle.incomingHasTabs : targetHasTabs);
// rootLayerStyle translateY: !(tabsOut || tabsIn) ? -100 : -(1 - morph) * 100
// rootLayerStyle pointer-events: morph > 0.5 && tabsIn ? 'auto' : 'none'
// layerDownStyle: ((!tabsOut && !tabsIn) ? 0 : morph) * 100   (isDeepToDeep = !tabsOut && !tabsIn)
```

At rest (`latchedSettle === null`) this is byte-identical to today (live values).
During a settle it reads the frozen record. NB `layerDownStyle` uses
`(!tabsOut && !tabsIn)` (NOR via De Morgan of `!(tabsOut || tabsIn)`), matching
today's `isDeepToDeep = !currentHasTabs && !targetHasTabs` - NOT `!(tabsOut &&
tabsIn)` (NAND), which would freeze the title layer at 0 and regress the
deep→tab descent.

### 4.4 titleView + the latch-read migrations

`titleView`'s settle branch (`:527-534`) reads
`latchedSettle?.outgoingTitle ?? ''` / `latchedSettle?.incomingTitle ?? ''` (the
settle branch only renders while `latchedSettle !== null`, but the defensive
`?? ''` costs nothing and removes a crash class if the invariant ever desyncs).
The removed `latchedOutgoing`/`latchedIncoming`/`latchedTargetTabs` are also read
in three places that must migrate to the record:

- Effect C absorb check `newTitle === latchedIncoming` (`:302`) →
  `latchedSettle?.incomingTitle`;
- Effect C re-arm guard `newTitle !== latchedIncoming && newTitle !== latchedOutgoing`
  (`:314`) → `latchedSettle?.incomingTitle` / `?.outgoingTitle`;
- `endSettle` fallback `restTitle = title || latchedIncoming` (`:471`) →
  `title || latchedSettle?.incomingTitle || ''`.

### 4.5 Why this is the cause fix

The defect class is "a settling consumer reads a LIVE nav-derived endpoint
identity that mutates mid-settle, diverging from the latched title endpoints."
The structural fix makes the latched record the SOLE endpoint source for every
settling consumer (titleView, morph, both layer styles), for gesture and click
settles, arming at all three sites (gesture, click, re-arm). No live endpoint
read exists on any settle path, so no future sibling can diverge. The morph arm
also becomes simpler (one formula). The minimal latch is subsumed.

### 4.6 What is NOT changed

- `iconProgress` (`:202`): stays on live `currentHasTabs`. It is search-scoped
  (`isSearch || (searchScrubbing && currentHasTabs)`) and off every settle path
  the record owns (a deep→deep gesture has `isSearch=false`; a root↔search scrub
  is not a navigation settle). Including it in the record would couple the record
  to the search path for no divergence risk.
- The drag arm (`:148-150`), search-scrub arm (`:155-158`), rest arm (`:189`):
  not in-flight across a navigation. The top-level `isDeepToDeep` `$derived`
  (`:70`) is PRESERVED - the drag arm (`:149`) still reads it live (correct
  pre-settle); only `layerDownStyle` (`:556`) moves off it to the hoisted
  `tabsOut`/`tabsIn`.
- `settleTarget`, `settleAwaitTitle`, `settleProgress`, `runSettleDriver`,
  Effects A/D/E, `releaseConsumed`, the `!navStore.backTarget` guard: unchanged.

## 5. Files

- `src/lib/components/organisms/Header.svelte`:
  - ADD `HeaderSettleTransition` + `latchedSettle = $state<HeaderSettleTransition | null>(null)`.
  - REMOVE `latchedOutgoing`/`latchedIncoming`/`latchedTargetTabs`.
  - Effect B (`:242-292`): set `latchedSettle` (outgoing=current, incoming=backTarget)
    after the `!navStore.backTarget` guard (`:267-271`); remove the old
    `latchedOutgoing/Incoming/TargetTabs` writes.
  - Effect B CLEAR (`:249-261`): clear `latchedSettle = null` inside the
    `if (settling && !releaseConsumed)` guard (observably equivalent to
    unconditional - at rest `latchedSettle` is already null).
  - Effect C idle (`:327-342`): set `latchedSettle` (outgoing=prev, incoming=current).
  - Effect C re-arm (`:312-323`): set `latchedSettle` (outgoing=old incoming,
    incoming=newTitle/currentPath).
  - Effect C absorb check (`:302`) and re-arm guard (`:314`): migrate to
    `latchedSettle?.incomingTitle` / `?.outgoingTitle`.
  - `endSettle` (`:466-480`): in the same synchronous tick (function body) as
    `settling = false`, assign `restTitle = title || latchedSettle?.incomingTitle || ''`
    FIRST, then `latchedSettle = null` (order matters - the fallback reads the
    record before the clear; same tick as `settling=false` so a re-arm on a later
    flush can't deref null).
  - morph settle arm (`:161-186`): replace `current`/`target`/`prev` + the three
    branches with the single `outgoing*(1-p)+incoming*p` formula from
    `latchedSettle` (no `else`; outer IIFE falls through to rest).
  - `rootLayerStyle`/`layerDownStyle` (`:546-559`): source `tabsOut`/`tabsIn`
    from `latchedSettle ?? live` (NOR for layerDownStyle).
  - `titleView` (`:518-542`): read `latchedSettle.outgoingTitle/incomingTitle`.
  - probe (`:567-592`): KEEP `currentHasTabs`/`targetHasTabs`/`prevHasTabs`
    (still load-bearing); replace `latchedTargetTabs` with the `latchedSettle`
    record; ADD `isSettleMode` (so §7 assertion (a) is writable without
    e2e-side reconstruction), `layerDownStyle`, and `effectiveTabsOut`/
    `effectiveTabsIn` aliased to the hoisted top-level `tabsOut`/`tabsIn`
    `$derived` (NOT a replayed `latchedSettle ?? live` formula - that would be
    identity and vacuous).
- `src/lib/utils/header-probe.ts`: `HeaderStateSnapshot` - replace
  `latchedTargetTabs` with the `latchedSettle` shape (or its four scalars), add
  `isSettleMode: boolean`, `layerDownStyle: string`,
  `effectiveTabsOut`/`effectiveTabsIn: boolean`.
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts`: reshape the `HeaderSnap` mirror
  to match the new probe shape (`latchedSettle` record + `isSettleMode` +
  `layerDownStyle` + `effectiveTabsOut/In`, replacing `latchedTargetTabs`);
  migrate the PRESERVE assertion to
  `commitFrame.latchedSettle.incomingHasTabs === true`; ADD the source-attributing
  preventive test (§7).

## 6. Edge cases & risks

- **deep→tab descent preserved.** `incomingHasTabs=true` (tab) → ramps 0→1.
- **Cancel.** Same record; `settleTarget=0` → morph→outgoing. No nav, no mutation.
- **Click / back-button.** Effect C idle record (outgoing=prev, incoming=current);
  `settleTarget=1`; the live `prevPath`/`currentPath` are the real endpoints,
  stable once latched.
- **Rapid back-to-back / re-arm.** The re-arm rotates the record (old incoming →
  new outgoing); `settleProgress=0` restarts. No stale-record hazard (every arming
  writes it; the record is only read while non-null).
- **CLEAR branch.** Clears `latchedSettle = null` alongside `settling=false`, so
  no stale record survives a CLEAR.
- **`releaseConsumed` same-flush re-run.** The record write sits in the same
  Effect B `untrack` block as `releaseConsumed=true`; the `:244` early return
  fires first on a re-run.
- **Null record during isSettleMode.** Cannot render: the arming effects
  (`$effect.pre`) write `latchedSettle` in the same flush as `settling=true`. If
  a future change broke that, the morph arm's `if (latchedSettle)` falls through
  to the rest branch (safe degradation - deep→deep stays 0). The §7 preventive
  test includes a "for every `isSettleMode` frame, `latchedSettle !== null`"
  assertion that catches such a regression directly.
- **SSR.** `latchedSettle=$state(null)`; writes are `$effect.pre` (client-only);
  consumers fall back to live values, byte-identical to today's SSR.
- **Search path.** `isSearch`/`searchScrubbing` false on deep→deep; `iconProgress`
  stays live (search-scoped, §4.6).

## 7. Testing plan

- `e2e/deep-to-deep-gesture-morph-spike.spec.ts`:
  - DEFECT (`/profile/edit` → `/profile/settings`, gesture) - `maxMorph ≤ 0.25`.
  - GENERALIZATION (`/admin/categories` → `/admin`, gesture) - `maxMorph ≤ 0.25`.
  - CALIBRATION (same path, back button) - `maxMorph ≤ 0.25`.
  - PRESERVE (`/profile/settings` → `/`, gesture deep→tab) - commit arm runs
    (`settling && morph>=0.9`), descent animates; the latch assertion migrates to
    `commitFrame.latchedSettle.incomingHasTabs === true`.
  - **PREVENTIVE (cause pattern, source-attributing, NEW):** the probe exposes
    `effectiveTabsOut`/`effectiveTabsIn` as `$derived` mirrors of the `tabsOut`/
    `tabsIn` locals the layer styles ACTUALLY consumed (not a replayed formula),
    plus `layerDownStyle`. Two assertions: (a) for every `isSettleMode` frame,
    `latchedSettle !== null` (the arming same-flush invariant); (b) for every
    settle frame, `effectiveTabsIn === latchedSettle.incomingHasTabs` AND
    `effectiveTabsOut === latchedSettle.outgoingHasTabs`. On a deep→deep landing
    the live `targetHasTabs=true` but `latchedSettle.incomingHasTabs=false`; if a
    layer style reverts its centralized `tabsIn` resolution to a live read,
    `effectiveTabsIn` becomes `true` (≠ record `false`) and (b) fails. Scope: this
    catches reverts of the shared `tabsOut/tabsIn` derivation; it does NOT catch a
    NEW consumer that bypasses them and reads `targetHasTabs` directly (inherent to
    source-attributing tests). Non-vacuous: a behavioral layer-style-equality check
    is vacuous because morph=0 collapses the output on deep→deep; the
    source-attribution check tests the cause directly.
- Regression sweep: `header-tab-descent-cross-tab-exit`, `header-tabs-replay`,
  `header-title-replay`, `header-title-crossfade-clip` (pre-existing OPEN,
  separate), `search-back-hamburger-flash`, `search-enter-exit-asymmetry`,
  `swipe-back-pill-flicker`, `tab-exit-preview`, `enter-animation`.
- `bun run check` + `bun run lint`. `HeaderSettleTransition` satisfies
  interface-first / zero-inline-typing.
- No unit test (runes code; `bun-test-no-runes-loader`).

## 8. Out of scope

- `header-title-crossfade-clip` OPEN defect (clip-container geometry) - separate.
- The post-refresh track-reveal anomaly (DV14 §4.5) - positional, unrelated.
- Drag / search-scrub / rest arms; `iconProgress` (search-scoped).

## 9. Verified items

- The visible spike is already eliminated by the in-tree minimal latch
  (`latchedTargetTabs`, `maxMorph=0.000`); DV15-structural is class closure +
  subsumption, not a new active-defect fix.
- The three settle sub-arms are algebraically one `outgoing*(1-p)+incoming*p`
  (commit p→1, cancel p→0, click p→1); the collapse is behavior-preserving.
- `getCurrentTabIndex` already imported (`:35`); `prevPath`/`title`/
  `resolveDeepHeaderTitle`/`navStore.backTarget`/`currentPath` in scope at all
  three arming sites.
- Every settling consumer (`titleView`, morph, `rootLayerStyle`, `layerDownStyle`)
  moves to the record; `iconProgress` stays live (search-scoped, §4.6); the
  absorb/re-arm-guard/endSettle latch reads migrate (`:302`, `:314`, `:471`).
- `layerDownStyle` uses NOR `(!tabsOut && !tabsIn)`, matching today's `isDeepToDeep`.
