# Bug: edge dead-zone touch permanently strands `detectSwipe` in `ignore` (all horizontal swipes die until reload)

## Summary

A single touch that begins inside the 40 px edge dead zone logs
`[detectSwipe] ignored due to edge dead zone: <x>` and then sets the action's
internal `phase` to `'ignore'` **without ever recording the pointer**. Because the
pointer id is never stored, the matching `pointerup` cannot identify the gesture and
never resets `phase` back to `'idle'`. The state machine is then stranded in
`'ignore'` for the lifetime of the element, so **every subsequent horizontal swipe is
silently dropped** - tab switching, swipe-back, drawer open/close, and inner-page
tab-slide all stop working until a full page reload.

## Severity

High. The affected element is the persistent `MobileTabPager` viewport (the surface
for swiping between Home / Activity / Messages), which by design never remounts
across tab navigation. One accidental edge touch therefore disables swipe navigation
across the whole main tab surface until the user reloads.

## Affected code

`src/lib/actions/swipe.ts` → `detectSwipe.onDown` (the dead-zone branch, ~L249-255).
All three `detectSwipe` consumers share this action, so the bug is global to mobile
gestures:

- `src/lib/components/templates/MobileTabPager.svelte` (tab pager)
- `src/lib/components/templates/GesturePageLayout.svelte` (thread / overlay pages)
- `src/lib/components/templates/DualColumnLayout.svelte` (inner-page tab slide)

## Reproduction (MCP, mobile touch emulation, 390x844)

Captured via `console.log` override on the live dev server at `http://localhost:5173/`
with a 390x844 touch viewport (`innerWidth=390`, right dead zone = `x > 350`).
Synthetic `PointerEvent`s with `pointerType: 'touch'` were dispatched on the pager
viewport; `detectSwipe` does not check `isTrusted`, so its state machine runs
identically to a real touch.

### Control (fresh state) - gestures work

Middle pointerdown then a clear horizontal drag:

```
[detectSwipe] down start: {"startX":195,"startY":400,"phase":"deciding"}
[detectSwipe] deciding progress: {"dx":-45,"dy":0,"absDx":45,"absDy":0,"horizontal":true,...}
[detectSwipe] swipe activated!
[detectSwipe] up/cancel event: {"phase":"swipe","deltaX":-145}
```

The committed swipe navigated Home → Activity. Harness is valid.

### Bug (after one edge-dead-zone touch) - gestures dead

1. `pointerdown` at `clientX=370` (right dead zone) + `pointerup`:
   ```
   [detectSwipe] ignored due to edge dead zone: 370
   ```
2. A follow-up middle `pointerdown` (would normally log `down start`) produces
   **no log at all** → `phase` never returned to `'idle'`.
3. A clear horizontal swipe (pointerdown 200 → 50) produces **no log at all** →
   `"swipe activated!"` never fires; the gesture is dropped. No navigation.

### Clicks are NOT blocked by this path (verified)

To check the reported "page stops responding to clicks" claim, a synthetic touch-tap
(pointerdown + pointerup + click) was dispatched on a real discussion link at its
centre `(174, 137)` - outside the dead zone:

- Fresh state (Test A): tap navigated to the discussion URL. ✓
- After the dead-zone touch (Test B): the tap **still navigated** to the same URL. ✓

Post-dead-zone diagnostics also showed: no stuck pointer capture, no capture-phase
`click` listener swallowing events, and no full-screen blocking overlay. So the
dead-zone branch itself does not intercept taps. The real, demonstrable failure is
**dead horizontal swipe gestures**, which on this swipe-centric mobile UI is very
likely what is perceived as "the page stopped responding".

## Data flow / event trace (single-touch dead-zone case)

State on init: `phase = 'idle'`, `primaryPointerId = -1` (`NO_POINTER`).

1. `pointerdown` @ `clientX=370`:
   - not mouse, not disabled → continue
   - dead-zone test: `370 > innerWidth - 40 (350)` → true
   - `console.log('[detectSwipe] ignored due to edge dead zone: 370')`
   - **`phase = 'ignore'`** ← the stranded write
   - `return` - note `primaryPointerId` is **still `-1`** (it is only ever assigned
     inside the later `if (phase === 'idle')` block, which this branch skips)

2. `pointerup` @ `370` → `onUp`:
   - `releaseIfHeld(...)`: pointer was never captured → no-op
   - `if (event.pointerId !== primaryPointerId) return` → `1 !== -1` is true →
     **return early**, so `reset()` (the only writer of `phase = 'idle'` outside
     `finish`) is never reached
   - `phase` stays `'ignore'` indefinitely

3. Any later `pointerdown` (e.g. centre of screen):
   - dead-zone test passes (centre), then `if (phase === 'idle')` → **false**
     (it is `'ignore'`) → the entire tracking block is skipped, no `preventDefault`,
     no state change

4. Any later horizontal swipe:
   - `pointerdown` skipped (step 3); `pointermove` hits
     `if (event.pointerId !== primaryPointerId) return` (`primaryPointerId` is still
     `-1`) → returns → `"swipe activated!"` never logs

The machine only ever leaves `'ignore'` via `reset()` (called in `onUp` only when the
pointer id matches) or `finish()` (only from `'swipe'`). The dead-zone path satisfies
neither precondition, so `'ignore'` is absorbing. No other `'ignore'` writer is broken:
the ones in `onMove` (long-press, vertical, interactive-target, ambiguous) all run while
`primaryPointerId` is already set, so their `pointerup` matches and resets. Only the
dead-zone branch writes `'ignore'` before `primaryPointerId` is assigned.

## Secondary, related bug: multi-touch clobber

The dead-zone check runs **before** the `if (phase === 'idle')` guard, so a second
finger landing in the dead zone during an in-flight recognised swipe also strands
`phase` to `'ignore'`. Reproduced:

```
[detectSwipe] swipe activated!                              ← finger 1, tracked
[detectSwipe] ignored due to edge dead zone: 370            ← finger 2, clobbers phase
[detectSwipe] up/cancel event: {"phase":"ignore","deltaX":-100}  ← finger 1 lifts: phase is 'ignore', not 'swipe'
```

Because the lift reports `phase: 'ignore'`, `finish()` does not fire, so the
consumer's `onEnd` (`swipeEnd` / `onSwipeEnd` / `tabSwipeEnd`) is **skipped** and its
`dragOffset` is left non-null - the track stays translated mid-gesture until the next
completed swipe. This is the leading candidate if a device genuinely shows a
half-broken (shifted) surface after an edge touch; a clean reload is the only full
recovery today.

## Root cause

`detectSwipe.onDown` treats the edge dead zone as a permanent state transition
(`phase = 'ignore'`) instead of as a per-pointer rejection. The branch sets the
absorbing `'ignore'` state without first recording the pointer id, so the terminal
`pointerup` cannot match and reset it.

## Proposed fix

Reject the dead-zone pointer **without mutating `phase`**, and reject any extra finger
while a gesture is already in flight. Move the "only a fresh gesture can start"
guard above the dead-zone check:

```ts
function onDown(event: PointerEvent): void {
	if (event.pointerType === 'mouse' || params.disabled?.()) {
		return;
	}
	// Only a gesture starting from idle can begin tracking. A second finger while
	// one is already in flight, or an edge-dead-zone reject, must NOT touch phase -
	// otherwise phase gets stranded in 'ignore' and no later gesture ever runs
	// (the dead-zone pointer is never assigned primaryPointerId, so its pointerup
	// cannot match and reset).
	if (phase !== 'idle') {
		return;
	}

	// OS edge-swipe gesture collision guard
	const edgeDeadZone = 40;
	if (event.clientX < edgeDeadZone || event.clientX > window.innerWidth - edgeDeadZone) {
		console.log('[detectSwipe] ignored due to edge dead zone:', event.clientX);
		return; // phase stays 'idle'; this pointer is simply not tracked
	}

	primaryPointerId = event.pointerId;
	startX = event.clientX;
	startY = event.clientY;
	startTime = event.timeStamp;
	target = event.target;
	// ... targetWasFocused computation unchanged ...
	phase = 'deciding';
	console.log('[detectSwipe] down start:', { startX, startY, phase });
}
```

This fixes both failure modes:

- Single-touch dead zone: `phase` stays `'idle'`; the dead-zone `pointerup` is a
  no-op (id mismatch) and the next gesture tracks normally.
- Multi-touch clobber: a second finger returns at the top guard, so an in-flight
  swipe keeps `phase: 'swipe'` and its `pointerup` correctly calls `finish()` /
  `onEnd`, resetting `dragOffset`.

The reported log line still prints for the original trigger (an idle → dead-zone
touch), so observability is preserved.

## Verification (performed)

Fix applied in `src/lib/actions/swipe.ts`. `bun run check` (svelte-check + tsc) 0
errors / 0 warnings; prettier + eslint clean on the file. Behaviour re-checked on the
live dev server with the same MCP mobile-touch harness:

1. Single-touch dead-zone recovery - PASS. After a dead-zone touch (`ignored due to
edge dead zone: 370`), a centre `pointerdown` logs `down start` (was empty before
   the fix), and a clear horizontal swipe logs `deciding progress` + `swipe activated!`
   and commits the tab switch (track → `translateX(-33.3333%)`, Home → Activity).
2. Multi-touch clobber - PASS. While a swipe is recognised, a second dead-zone
   `pointerdown` adds no log (top guard returns, phase stays `swipe`). The first
   finger's `pointerup` reports `phase: 'swipe'` (was `'ignore'`), so `finish()` /
   `onEnd` runs and the track returns to `translateX(0%)` with no spurious navigation.
3. Real touch device - TODO (owner): confirm swiping between Home / Activity / Messages
   still works after deliberately starting a drag from the screen's right/left 40 px,
   and that an accidental edge touch no longer disables swipe nav for the session.
