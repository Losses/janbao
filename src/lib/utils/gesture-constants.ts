// Designer Parameters for Gesture Animations
// Put here to avoid circular dependency chains between components and tabs configuration.
// First 20% of the drag distance. Two uses:
//   1. Track slide deadzone on non-bidirectional hosts
//      (`NavPipelineOrchestrator.#thresholdAbsorbedProgress`): the track
//      does not move for the first 20% of a drag so a gesture beginning
//      mid-transition does not snap back.
//   2. Search tab-bar clip-collapse (`Header.svelte` `tabProgress`):
//      `1 - min(1, morph / THRESHOLD)` so the SearchTabBar row collapses
//      within the first 20% of a root<->search scrub.
// The Header back-arrow morph is NOT threshold-absorbed: it ramps 0..1
// across the full drag via `pager.backMorph`.
export const HEADER_MORPH_THRESHOLD = 0.2;
export const PILL_EXPANSION_THRESHOLD = 0.5; // 50% drag distance to begin active tab pill expansion
// Minimum horizontal drag (px) for a swipe to commit (navigate to the
// target). Below this the gesture cancels (snaps back to rest).
// Consumer: the orchestrator's release gate.
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
// The pipeline's cross-route FAB family-swap ease duration (in
// `FloatingActionButtonLayer`). Equals the title crossfade so a discrete
// family-swap and the Header title crossfade play as one handoff.
export const TRACK_TRANSITION_MS = TITLE_CROSSFADE_MS;
// morph progress at or below this is "no meaningful gesture" (cancelled near the
// origin, or no preceding drag). Effect B treats it as a non-settle release.
export const GESTURE_MORPH_EPSILON = 0.001;
// Boundary void-swipe rubber-band factor. On the first/last tab a swipe toward
// the absent neighbour moves the track at this fraction of the drag distance,
// then snaps back on release. The orchestrator publishes trackFractionalIndex
// so the FAB dips along with the pill.
export const BOUNDARY_RUBBER_BAND_FACTOR = 0.4;
