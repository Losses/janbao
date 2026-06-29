// Designer Parameters for Gesture Animations
// Put here to avoid circular dependency chains between components and tabs configuration.
export const HEADER_MORPH_THRESHOLD = 0.2; // 20% drag distance to complete Header morph / Tab collapse
export const PILL_EXPANSION_THRESHOLD = 0.5; // 50% drag distance to begin active tab pill expansion

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
