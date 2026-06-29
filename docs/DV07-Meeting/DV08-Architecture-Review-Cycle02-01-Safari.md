# iOS Safari Layout Stability Architecture Review: Cycle 2 Evaluation

## Review Target

- Document: [DV08-Architecture.md](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md)

## Evaluator Role

- iOS Safari Layout and Performance Specialist

## Final Review Decision

- Approve with Conditions

---

## 1. Executive Summary of Evaluation

This review evaluates the revised architecture specification for the mobile multi-column navigation refactoring, focusing on iOS Safari viewport stability, layout rendering, scrolling mechanics, and interaction performance.

The updated proposal has correctly adopted Alternative A (Independent Scrolling Panes) and incorporated the vast majority of recommendations from Cycle 1, including avoiding dynamic viewport height (dvh) units, setting edge margins for swipe conflict resolution, and utilizing the Visual Viewport API for software keyboard offsets.

However, final approval is granted subject to resolving critical implementation details concerning the SvelteKit snapshot restore timing and adding explicit legacy/gesture scroll-locking behaviors. These remaining gaps are formulated as conditions below.

---

## 2. Verification of Cycle 1 Conditions

Below is a detailed verification of the status of each condition requested during the Cycle 1 review:

### 2.1 Adoption of Alternative A and Dismissal of Alternative B

- Status: Fully Met.
- Location: Section 1 of the architecture proposal.
- Verification: The specification explicitly commits to Alternative A (Independent Scrolling Panes) and officially discards Alternative B (Static Underlay Snapshotting), avoiding major layout stutters and paint stutters during navigation animations.

### 2.2 Viewport Heights and Layout Mode (Avoiding dvh)

- Status: Fully Met.
- Location: Section 2.2 of the architecture proposal.
- Verification: The layout locks html and body elements using position: fixed and heights of 100%. The pager-viewport uses absolute positioning with top and bottom properties set to 0. Scroll panes use height: 100%. This completely avoids dynamic viewport units (dvh), which would otherwise trigger continuous layout recalculations during browser chrome changes.

### 2.3 Edge-Swipe Safety Zone (20px)

- Status: Fully Met.
- Location: Section 3.1 of the architecture proposal.
- Verification: The proposal incorporates a 20px edge margin safety zone. Any touch starting at clientX < 20px or clientX > (window.innerWidth - 20px) in the pointerdown handler of the [detectSwipe](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts#L198) function in [swipe.ts](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts) will set the swipe phase to ignore and exit. This allows native iOS Safari edge-swipe history navigation to occur without JS interference.

### 2.4 Visual Viewport and Software Keyboard Adjustments

- Status: Fully Met.
- Location: Section 6 of the architecture proposal.
- Verification: The proposal uses the Visual Viewport API to calculate the active software keyboard height (window.innerHeight - window.visualViewport.height) and assigns this to the custom property "--keyboard-offset". Resizing scroll panes and inputs read this variable to dynamically adjust padding-bottom, preventing fixed headers from shifting off-screen.

### 2.5 Scroll Container Momentum and Containment CSS

- Status: Fully Met.
- Location: Section 2.2 of the architecture proposal.
- Verification: The CSS for the scroll-pane class includes overscroll-behavior-y: contain (to prevent scroll chaining to the document body) and -webkit-overflow-scrolling: touch (to guarantee fluid momentum rendering on older WebViews).

### 2.6 Custom Scroll Position Memory (SvelteKit Snapshots)

- Status: Met with Conditions.
- Location: Section 5 of the architecture proposal.
- Verification: The architecture introduces SvelteKit's native snapshot feature to capture and restore the scrollTop positions of the individual panes, which fits history navigation. However, the proposed implementation contains a critical lifecycle timing flaw (see Section 3.1 below).

---

## 3. Remaining Gaps and Detailed Conditions for Final Approval

To secure unconditional approval, the following three conditions must be fully addressed in the implementation phase and updated in the final architecture document:

### 3.1 Condition 1: Correct SvelteKit Snapshot Restore Timing

The proposed implementation of the [snapshot](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md#L174) restore method queries the DOM elements directly using document.getElementById:

restore: (value) => {
const listPane = document.getElementById("list-scroll-pane");
if (listPane) listPane.scrollTop = value.listScrollTop;
}

Why this is incorrect:
In SvelteKit, the snapshot restore function is executed synchronously during the component initialization phase (when the component is instantiated). At this stage, the DOM nodes (such as the list-scroll-pane element) are not yet rendered or mounted in the document. As a result, document.getElementById will return null, causing the restore operation to do nothing.

Required Refactoring:

1. Store the restored scroll values in reactive component variables during the snapshot restore call.
2. Bind these scroll positions to the elements when they are mounted. This can be accomplished using Svelte's onMount lifecycle hook, or via a custom Svelte action (like use:restoreScroll) applied to the scroll-pane nodes.

Example code structure to incorporate (without backticks):
let listScrollTop = 0;
let detailScrollTop = 0;

export const snapshot = {
capture: () => ({
listScrollTop: document.getElementById("list-scroll-pane")?.scrollTop || 0,
detailScrollTop: document.getElementById("detail-scroll-pane")?.scrollTop || 0
}),
restore: (value) => {
listScrollTop = value.listScrollTop;
detailScrollTop = value.detailScrollTop;
}
};

Inside the Svelte template, apply these variables to the scroll pane elements using an action or lifecycle script to ensure the scroll position is restored after the DOM is fully constructed.

### 3.2 Condition 2: Implement Legacy iOS Scroll Boundary Lock

While overscroll-behavior-y: contain is standard CSS, legacy iOS versions (iOS 15 and below) or older WebViews do not robustly support this property. To prevent document-level rubber-band elastic bouncing on these devices, the implementation must include a JavaScript-level boundary lock.

Required Action:
Attach a non-passive touchmove event listener to each scroll pane. If the user scrolls down when scrollTop is at 0, or scrolls up when the pane is at its maximum scroll bottom, call event.preventDefault() to manually intercept the gesture and stop propagation to the window body.

### 3.3 Condition 3: Apply Vertical Scroll Locks during Swipes

During horizontal tab swiping gestures (where the phase is "swipe" in [detectSwipe](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts#L198)), diagonal user movements can trigger vertical scrolling on the underlying pane. This cancels the swipe gesture and degrades the transition experience.

Required Action:
The implementation must lock vertical scrolling while a swipe gesture is active. When the gesture phase transitions to swipe, intercept subsequent touchmove events and programmatically call event.preventDefault() to block vertical scrolling until the horizontal transition settles.
