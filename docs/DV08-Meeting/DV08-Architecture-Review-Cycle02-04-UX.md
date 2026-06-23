# DV08 Architecture Review Cycle 02-04: UX and Mobile Gesture Design

## Metadata

- Review Type: UX Fluidness and Gesture Accuracy (Cycle 2)
- Reviewer Role: UX and Mobile Gesture Designer
- Date: June 2026
- Subject Document: docs/DV08-Meeting/DV08-Architecture.md
- Status: Request Changes

---

## Executive Summary

This review evaluates the Cycle 2 draft of the DV08 Architecture proposal (docs/DV08-Meeting/DV08-Architecture.md) for refactoring Janbao's mobile multi-column navigation, routing, and viewport gesture interaction. The purpose is to verify if the 5 conditions specified during the Cycle 1 UX review have been correctly and fully integrated.

Out of the 5 conditions requested in Cycle 1, 3 have been successfully incorporated: the 20px edge margin safety zone in swipe.ts, CSS-based responsive layouts to prevent hydration flashes, and dynamic layout heights during transitions. However, 2 crucial conditions remain completely omitted: the introduction of GesturePageLayout for non-tab subpages, and the coordination of header/tab bar transitions during gestures.

Because key architectural elements required to deliver a cohesive, high-fidelity native-like gesture experience are missing, the final decision is to Request Changes. The missing specifications must be added to the proposal before it can be approved.

---

## 1. Verification of Cycle 1 Conditions

### 1.1 Condition 1: OS Edge-Swipe Conflict Resolution (20px Margin)

- Requirement: Implement an edge dead-zone of 20px in swipe.ts to allow native browser back/forward swipe gestures without JS animation conflicts.
- Verification: Section 3.1 (OS Edge-Swipe Conflict Resolution) correctly details this behavior. It states that the pointerdown handler of detectSwipe will implement a 20px edge margin safety zone. Any touch starting at clientX less than 20px or greater than window.innerWidth minus 20px will transition the swipe phase to ignore immediately.
- Verdict: Incorporated correctly.

### 1.2 Condition 2: Zero-Flash Hydration via CSS Media Queries

- Requirement: Eliminate the 1-frame layout mount flash by replacing JS-based isMobile conditional rendering with CSS Media Queries.
- Verification: Section 2.1 (Hydration Flashes and Media Queries) addresses this. It specifies a unified DOM structure rendered by the server containing both columns, governed by CSS Media Queries for viewport sizing. It also details the progressive enhancement of gestural listeners via the use:swipeGesture action on the client side only.
- Verdict: Incorporated correctly.

### 1.3 Condition 3: Dynamic Transition Heights

- Requirement: Set the viewport height to the maximum of the active and incoming panels during transitions to avoid content clipping.
- Verification: Section 3.2 (Dynamic Transition Heights) specifies this constraint. The viewport height will be set to Math.max(activePanelHeight, incomingPanelHeight) during active drags and transitions, snapping to the new active panel's height only after the transition completes.
- Verdict: Incorporated correctly.

### 1.4 Condition 4: Gesture Consistency for Non-Tab Subpages

- Requirement: Extract edge-swipe behavior into a reusable layout component (GesturePageLayout.svelte) and wrap non-tab subpages (profile, settings, admin) to participate in the swipe-to-go-back gesture framework.
- Verification: This requirement is completely missing from the updated document. While Section 4.2 describes edge-swipe back actions calling history.back(), there is no mention of the GesturePageLayout.svelte component, nor does it specify wrapping the profile, settings, or admin subpages to ensure gesture consistency.
- Verdict: Missing.

### 1.5 Condition 5: Coordinated Header and Bottom Tab Bar Transitions

- Requirement: Synchronize header translations (cross-fade and translation based on dragOffset) and bottom tab bar translations (translateY going from 100% to 0%) during edge-swipe gestures.
- Verification: This requirement is completely missing from the updated document. Section 2.2 defines the basic scroll pane CSS, and Section 4.2 defines the Svelte back-action handlers, but there is no mention of visual synchronization or animations for the header and the bottom tab bar.
- Verdict: Missing.

---

## 2. Action Items for Cycle 3 Revision

To achieve unconditional approval in the next review cycle, the architecture document must be updated to incorporate the following missing details:

### 2.1 Reusable Gesture Page Wrapper Specification

The architecture proposal must explicitly document the introduction of GesturePageLayout.svelte under the routing or layout section. The specification should state:

- Target Pages: Settings, Profile, and Admin subpages must be wrapped in this layout.
- Gesture Handling: The wrapper will attach the detectSwipe gesture listener.
- Navigation Fallbacks: When a swipe-back gesture is committed, the wrapper checks if a local history entry exists and invokes history.back(). If the page was accessed via a direct deep link, the gesture must trigger a fallback navigation to its defined parent route (e.g., navigating from settings back to profile, or from profile back to the primary home route).

### 2.2 Visual Transition Synchronization for Chrome

The architecture proposal must define the coordinated styling transformations of navigation bars and tab bars during active swipe-back transitions:

- Header Synchronization: The thread-specific or subpage-specific header must translate horizontally in tandem with the content pane. As the user swipes the child page to the right (dragOffset greater than 0), the child header translates rightward, while the parent header fades in and translates from a negative offset (e.g., translating from -15% to 0% with opacity fading from 0 to 1).
- Bottom Tab Bar Synchronization: For transitions between flat tab views and child subpages, the bottom tab bar must slide vertically. During a back gesture, the tab bar must translate vertically from translateY(100%) to translateY(0%) in proportion to the swipe progress (drag progress transitioning from 0 to 1).

---

## 3. Final Review Decision

- Decision: Request Changes
- Rationale: While the structural foundation and touch dead-zones are correctly defined, the exclusion of the GesturePageLayout component and chrome transition synchronization compromises the consistency and premium feel of the mobile gesture system. These specifications must be explicitly added to docs/DV08-Meeting/DV08-Architecture.md in the next draft.
