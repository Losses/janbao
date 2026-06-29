# DV08 Architecture Review Cycle 01-04: UX and Mobile Gesture Design

## Metadata

- Review Type: UX Fluidness & Gesture Accuracy
- Reviewer Role: UX and Mobile Gesture Designer
- Date: June 2026
- Subject Document: docs/DV08-Meeting/DV08-Architecture.md
- Status: Approve with Conditions

---

## Executive Summary

This review evaluates the proposed refactoring of Janbao's mobile multi-column navigation and viewport layout. The review focuses on ensuring high-quality mobile physics, gesture precision, transition fluidity, and architectural robustness.

We recommend adopting Alternative A (Independent Scrolling Panes with Scroll-Pane Viewport) as the primary layout model. While Alternative B (Static Underlay Snapshotting) preserves iOS Safari's native toolbar collapsing, it introduces severe complexity, paint flashing, and mechanical fragility during DOM cloning and scroll position synchronization. Alternative A provides a deterministic, high-performance foundation for multi-pane swipe gestures, native inertia scrolling, and stable scroll memory.

However, Alternative A is Approved with Conditions. The conditions outlined below must be implemented to resolve swipe intent conflicts, coordinate navigation chrome, ensure gesture consistency across subpages, and eliminate layout flashes.

---

## 1. Swipe Detection, Intent Recognition, and Browser Edge Conflicts

The current gesture system in src/lib/actions/swipe.ts utilizes detectSwipe and captureSwipe to capture horizontal drags. However, it lacks edge-awareness, which causes critical conflicts with native mobile OS navigation.

### 1.1 OS Edge-Swipe Conflict Resolution (Actionable Proposal)

On modern mobile platforms (iOS Safari and Android Chrome), swiping from the left or right edges triggers native system-level back/forward navigation. If the application's JS gesture handler detects the same swipe, it initiates its own translation animations and history pops, resulting in double-triggering or visual stutter.

- Action: Add an edgeDeadZone parameter (defaulting to 20 pixels) to the detectSwipe configuration.
- Implementation: In the onDown handler of detectSwipe, if the starting coordinate pointerId's startX is less than edgeDeadZone (for left-edge) or greater than window.innerWidth minus edgeDeadZone (for right-edge), transition the phase immediately to ignore.
- Result: This allows the browser or mobile OS to handle edge-swipe navigation natively without competition from JS touch capture, preventing double-back transitions.

### 1.2 Intent Recognition and Pointer Takeover

- Issue: Horizontal swipes can be accidentally triggered during vertical scrolls, leading to diagonal jitter.
- Action: Maintain a strict dead-zone (currently 10px in swipe.ts) and a high horizontal-to-vertical ratio (currently 1.4). We propose increasing the ratio to 1.6 to ensure that vertical scrolling is prioritized on touch devices, preventing accidental tab switches.
- Touch-Action styling: The pager containers must continue to use touch-action: pan-y pinch-zoom to allow native vertical scrolling. This must be applied directly via CSS rather than inline styles to prevent Svelte hydration updates from resetting it.

---

## 2. Coordinated Transition Animations (Headers, Tab Bars, and Chrome)

During horizontal swipes, the user experience suffers if the navigation bars (headers, tab bars) remain static or snap abruptly.

### 2.1 Header and Navigation Bar Coordination (Actionable Proposal)

- Issue: A thread page features a header with back navigation and a thread title, whereas the parent list page features a global search header. A static header during a swipe creates a disjointed transition where content slides but headers snap.
- Action: Coordinate header transitions using a sliding cross-fade. The thread-specific header should translate horizontally in sync with the thread content pane.
- Implementation:
  1. Bind the header translation transform directly to the fractionalIndex or dragOffset of the pager.
  2. As the user slides the thread pane to the right (dragOffset > 0), translate the thread header to the right at the same rate, while fading in the global layout header from a slight negative translation (e.g., -15% horizontal translation with an opacity fade from 0 to 1).

### 2.2 Bottom Tab Bar Transition

- Issue: On flat tab pages, the bottom TabBar is present. On stacked child pages, it is hidden. Swiping back from a thread to the list causes the TabBar to pop into existence abruptly.
- Action: Synchronize the entry of the TabBar. During a back swipe from a thread, translate the TabBar upward into view from the bottom screen edge (e.g., translateY going from 100% to 0) proportionally to the drag progress.

---

## 3. Design Consistency Across Non-Tab Subpages

To establish a coherent UX gesture language, non-tab subpages (such as settings, user profiles, and administrative consoles) must not feel like isolated web pages; they must participate in the same gesture framework.

### 3.1 Reusable Gesture Page Wrapper (Actionable Proposal)

- Issue: Currently, edge-swipe navigation is hardcoded to specific routes in ThreadPager.svelte. Settings, Profile, and Admin pages are excluded, violating navigation consistency.
- Action: Extract the swipe-back behavior into a reusable layout component named GesturePageLayout.svelte.
- Implementation:
  1. Wrap Settings, Profile, and Admin pages in GesturePageLayout.
  2. The wrapper should listen for edge-swipe gestures using the optimized detectSwipe action.
  3. When an edge-swipe is committed, the wrapper checks the application navigation history. If a local history entry exists, it calls history.back(). If the user entered via a direct deep link, it falls back to navigating to the defined parent route (e.g., /settings falls back to /profile or the primary home route).

---

## 4. Seamless Transitions: Eliminating Paint Flashes, Jumps, and Clipping

The post-mortem of the mobile navigation system highlights that flashing and scroll jumps are primary obstacles.

### 4.1 Eliminating the Hydration and Mount Flash (Actionable Proposal)

- Issue: The white flash on thread entry is caused by the JS-based isMobile flag initially defaulting to false. This forces Svelte to render the desktop layout first, then switch to mobile layout after mounting, leading to DOM restructuring and layout recalculation.
- Action: Implement CSS-based responsive layouts for layout shells.
- Implementation: Rather than using Svelte's conditional if-isMobile statements in +layout.svelte and ThreadPager.svelte, render a single DOM tree where structural columns are displayed or hidden purely via CSS Media Queries (using classes like block md:hidden and hidden md:block). This ensures that the browser paints the correct mobile layout structure on the first frame of hydration, eliminating the remount paint gap.

### 4.2 Eliminating Height Clipping During Swipes (Actionable Proposal)

- Issue: In MobileTabPager.svelte, the viewport height snaps instantly to the active pane's height to prevent vertical scrolling issues. During a transition, this clips the taller incoming pane, leading to abrupt visual cutoffs.
- Action: Use dynamic height tracking during transitions.
- Implementation:
  1. During active drags (dragOffset is not null) or transitioning phases, set the pager viewport height to the maximum height of the active pane and the adjacent previewed pane.
  2. Only snap the viewport height to the new active pane's height after the transition has fully completed and settled.

### 4.3 Hardware Acceleration and Performance

- Action: Apply will-change: transform to the sliding flex track during active drag and translation states. This prompts the mobile browser to composite the layer on the GPU, avoiding CPU reflow paints and maintaining a solid 60fps on mobile viewports.

---

## Conclusion and Review Decision

### Final Decision: Approve with Conditions

### Summary of Conditions for Approval:

1. Implement edge-detection dead-zones (20px) in swipe.ts to hand over edge gestures to the native browser, preventing double-navigation.
2. Replace JS-based isMobile layout rendering with CSS Media Queries to eliminate hydration paint flashes.
3. Apply dynamic transition heights (maximum of active and incoming panels) during swipes to prevent content clipping.
4. Establish gesture consistency by introducing GesturePageLayout for non-tab subpages (profile, settings, admin).
5. Synchronize header and tab bar translations during edge-swipes to ensure cohesive visual movement.
