// Designer Parameters for Gesture Animations
// Put here to avoid circular dependency chains between components and tabs configuration.
export const HEADER_MORPH_THRESHOLD = 0.2; // 20% drag distance to complete Header morph / Tab collapse
export const PILL_EXPANSION_THRESHOLD = 0.5; // 50% drag distance to begin active tab pill expansion

// Deep-title crossfade (Header.svelte unified title state machine). The vertical
// slide between outgoing/incoming titles on a drag-release or non-gesture nav.
export const TITLE_CROSSFADE_MS = 200;
// A commit settle ends when the navigation lands (title === latchedIncoming);
// this timeout is only a safety net for a dropped transitionend or a navigation
// that never lands. Cancel / non-gesture settles end on the span transitionend.
export const SETTLE_SAFETY_MS = 1000;
// morph progress at or below this is "no meaningful gesture" (cancelled near the
// origin, or no preceding drag). Effect B treats it as a non-settle release.
export const GESTURE_MORPH_EPSILON = 0.001;
