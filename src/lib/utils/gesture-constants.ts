// Designer Parameters for Gesture Animations
// Put here to avoid circular dependency chains between components and tabs configuration.
// First 20% of the drag distance. Two uses:
//   1. Track slide deadzone on non-bidirectional hosts
//      (`NavPipelineOrchestrator.#thresholdAbsorbedProgress`): the track
//      does not move for the first 20% of a drag so a gesture beginning
//      mid-transition does not snap back.
//   2. SearchTabBar clip-expand (`Header.svelte` `tabProgress`):
//      `tabProgress = max(0, (searchProgress - (1 - HMT)) / HMT)` so the
//      SearchTabBar row expands over `searchProgress` in [0.8, 1.0] (the
//      last 20% of an ENTER scrub, slide-then-expand) and collapses over
//      `searchProgress` in [1.0, 0.8] (the first 20% of an EXIT scrub,
//      collapse-then-slide).
// The Header back-arrow morph is NOT threshold-absorbed: it ramps 0..1
// across the full drag via `pager.backMorph`.
export const HEADER_MORPH_THRESHOLD = 0.2;
export const PILL_EXPANSION_THRESHOLD = 0.5; // 50% drag distance to begin active tab pill expansion
// Minimum horizontal drag (px) for a swipe to commit (navigate to the
// target). Below this the gesture cancels (snaps back to rest).
// Consumer: the orchestrator's release gate.
export const SWIPE_COMMIT = 60;
// OS edge-swipe collision guard (px margin matching modern iOS/Android
// bezel-less native triggers). `detectSwipe` and the pipeline
// pointer-bridge capture listener (mounted by both mobile hosts)
// import this; the classifier's `isEdgeReserve` uses
// `DEFAULT_EDGE_DEAD_ZONE` ({left:40,right:40}) defined in
// `nav-intent.ts` - same value, separately defined. All three agree at
// the boundary with strict `<` / `>` (an inclusive `<=` would kill a
// gesture `detectSwipe` claims at x = EDGE_DEAD_ZONE).
export const EDGE_DEAD_ZONE = 40;

// Deep-title crossfade duration, owned by the orchestrator's settle / tap-scrub
// rAF eases. The vertical slide between the outgoing and incoming titles on a
// drag-release or a non-gesture nav; the Header reads the published progress
// and owns no rAF itself.
export const TITLE_CROSSFADE_MS = 200;
// Boundary void-swipe rubber-band factor. On the first tab a backward swipe
// with no previous history entry moves the track at this fraction of the drag
// distance, then snaps back on release. (The forward direction resolves every
// tab to a target via `#nextTabTarget`, with the last tab resolving to
// `/search`, so no forward boundary path remains.)
export const BOUNDARY_RUBBER_BAND_FACTOR = 0.4;
