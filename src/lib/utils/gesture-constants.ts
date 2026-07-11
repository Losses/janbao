// Designer Parameters for Gesture Animations
// Put here to avoid circular dependency chains between components and tabs configuration.
export const HEADER_MORPH_THRESHOLD = 0.2; // 20% drag distance to complete Header morph / Tab collapse
export const PILL_EXPANSION_THRESHOLD = 0.5; // 50% drag distance to begin active tab pill expansion
// Minimum horizontal drag (px) for a swipe to commit (navigate to the
// target). Below this the gesture cancels (snaps back to rest).
// Consumer: the 5b1 pilot orchestrator's release gate.
// GesturePageLayout defines its own local `const SWIPE_COMMIT = 60`
// at GesturePageLayout.svelte:275; it does not import this constant.
export const SWIPE_COMMIT = 60;
// OS edge-swipe collision guard (px margin matching modern iOS/Android
// bezel-less native triggers). `detectSwipe` and the 5b1 pointer-bridge
// capture listener import this; the classifier's `isEdgeReserve` uses
// `DEFAULT_EDGE_DEAD_ZONE` ({left:40,right:40}) defined in
// `nav-intent.ts` - same value, separately defined. All three agree at
// the boundary with strict `<` / `>` (an inclusive `<=` would kill a
// gesture `detectSwipe` claims at x = EDGE_DEAD_ZONE).
export const EDGE_DEAD_ZONE = 40;

// Deep-title crossfade (Header.svelte unified title state machine). The vertical
// slide between outgoing/incoming titles on a drag-release or non-gesture nav.
export const TITLE_CROSSFADE_MS = 200;
// GesturePageLayout track slide duration (Tailwind `duration-200`). Equals the
// title crossfade so the GPL slide-out and the Header title crossfade play as
// one handoff. The rAF-poll (reliable executePendingNav dispatch) resolves the
// slide's actual completion against this duration.
export const TRACK_TRANSITION_MS = TITLE_CROSSFADE_MS;
// morph progress at or below this is "no meaningful gesture" (cancelled near the
// origin, or no preceding drag). Effect B treats it as a non-settle release.
export const GESTURE_MORPH_EPSILON = 0.001;
// Boundary void-swipe rubber-band factor. On the first/last tab a swipe toward
// the absent neighbour moves the track at this fraction of the drag distance,
// then snaps back on release. The FAB sampler reads the live track position so
// the FAB dips along with the pill.
export const BOUNDARY_RUBBER_BAND_FACTOR = 0.4;
