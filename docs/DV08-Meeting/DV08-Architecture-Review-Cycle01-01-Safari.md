# iOS Safari Layout Stability Architecture Review: Refactoring Mobile Navigation and Viewport Layout

## Review Target
Document: DV08 Architecture: Refactoring Mobile Multi-Column Navigation and Viewport Layout ([DV08-Architecture.md](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md))

## Evaluator Role
iOS Safari Layout & Performance Specialist

## Review Opinion
Approve with Conditions

---

## 1. Viewport Heights and Layout Mode (100dvh, svh, lvh, and position: absolute/fixed)

The architecture proposal presents two alternatives. From an iOS Safari layout stability perspective, we strongly support Alternative A (Independent Scrolling Panes / Scrolling Layout Viewport) over Alternative B (Static Underlay Snapshotting). Attempting to manage document-level native scrolls (Alternative B) while animating multi-column layouts horizontally causes significant layout jitter, scroll position sync latency, and graphic-pipeline paint drops. However, Alternative A's layout model has critical assumptions regarding iOS Safari that must be corrected.

### Critique of Assumptions:
The proposal states that absolute positioning boundaries (top and bottom) auto-adjust on iOS when the virtual keyboard pops up, completely bypassing dvh issues. This is incorrect. On iOS Safari (since iOS 15), when the software keyboard appears, the Layout Viewport does not resize. Only the Visual Viewport shrinks. Consequently, elements anchored to bottom: 0 inside a fixed-height layout container (or even fixed to the viewport) will remain at the bottom of the original Layout Viewport, placing them directly underneath the software keyboard. They are rendered invisible and non-interactive.

Furthermore, dynamic viewport units (100dvh) should be avoided entirely for scroll containers. Because dvh dynamically recalculates when browser chrome (address and tab bars) expands or collapses, using it triggers style recalculations and layout reflows on every frame of scrolling. This causes visible stuttering and frame drops (judder) during momentum scrolling.

### Actions and Conditions:
1. Establish a layout tree that uses 100% or 100svh (Small Viewport Height) for the pager viewport and scroll containers instead of 100dvh. This keeps container height stable during scrolling.
2. The height of the active scrolling pane must be dynamically padded at the bottom to account for the software keyboard when inputs are focused. This must be managed programmatically using the Visual Viewport API (described in section 3 below).

---

## 2. Scrolling Containers, Momentum, and Viewport Scroll Locks

Scrolling in nested environments on iOS Safari is highly susceptible to scroll chaining, visual tearing, and double-scrollbar bugs.

### Chaining and Elastic Bounce:
When a user scrolls a pane (such as .scroll-pane) and reaches its scroll boundary (scrollTop = 0 or the maximum scroll bottom), iOS Safari's native scroll-chaining behavior propagates the scroll gesture to the window body. Even if the body has overflow: hidden, Safari will trigger a rubber-band elastic bounce on the entire document layout. This shifts the top header out of place and breaks horizontal swipe stability.

### Actions and Conditions:
1. Force scroll containment: Apply "overscroll-behavior-y: contain" on all scrolling containers. This prevents scroll events from bubbling up to the document body when reaching boundaries.
2. For iOS 15 and below (which lack robust support for overscroll-behavior), attach a non-passive touchmove event listener to the scroll containers. When the container's scrollTop is 0 and the user drags down, or when scrollTop is at the maximum bottom and the user drags up, call event.preventDefault() to block the native scroll engine from initiating a body-level rubber-band bounce.
3. Enable Momentum Scrolling: Ensure "-webkit-overflow-scrolling: touch" is explicitly set on all scroll panes to guarantee fluid 60fps momentum rendering, especially in WebView contexts and older iOS versions.
4. Custom Scroll Memory: Because Alternative A disables window scrolling (window.scrollY remains 0), the existing ListScrollStore and SvelteKit's built-in history scroll restoration (which rely on window.scrollY) will fail. The team must implement a custom pane-level scroll position store (e.g. PanelScrollStore) that:
    - Captures the scrollTop of the active pane before navigation or tab-switching.
    - Manually restores scrollTop on the newly mounted or cached scroll-pane DOM element after the navigation completes.

---

## 3. Safari-Specific Keyboard Behavior (Input Visibility and Viewport Shifts)

The software keyboard behavior in iOS Safari is one of the most common sources of layout degradation.

### Viewport Shifts:
When an input inside a scroll container is focused, Safari's default behavior is to scroll the Visual Viewport upward to center the input. Because the Layout Viewport remains static (top: 0, bottom: 0), this visual shift pushes the top sticky header (header nav) out of the top of the screen and creates empty layout gaps at the bottom.

### Actions and Conditions:
1. Implement a Visual Viewport Resize listener (e.g. inside a keyboard-adjust Svelte action). This listener must track changes to window.visualViewport.
2. On visualViewport resize or scroll events, calculate the active keyboard height:
   keyboardOffset = window.innerHeight - window.visualViewport.height
3. Apply this value as a CSS custom property (e.g. --keyboard-offset) to the layout root.
4. Use this custom property to dynamically increase the padding-bottom of the active .scroll-pane container and translate the bottom composer input upwards:
   padding-bottom: var(--keyboard-offset)
5. Programmatically scroll the focused input into view within the scroll container. By resizing the scrolling container's active height in sync with the visual viewport, Safari's native visual viewport shifting is suppressed, leaving the header nav fixed at the top of the screen while typing.

---

## 4. Layout Stability during Edge-Swipe and Tab-Swipe Transitions

### Edge-Swipe Gesture Collisions:
iOS Safari has a system-level edge-swipe gesture to navigate back and forward in browser history. When a user swipes from the left edge of the screen to go back from a thread to the list, the browser slides the page visually to reveal the previous URL.
If the custom swipe gesture handler ([detectSwipe](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts#L198) in [swipe.ts](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts)) captures this pointer movement, it will simultaneously translate the layout (translateX) via JavaScript. This collision of native page-sliding and JavaScript translation causes severe visual tearing, rendering freezes, and layout desynchronization.

### Actions and Conditions:
1. Integrate an edge-detection safety margin into the pointerdown handler of [detectSwipe](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts#L198) (in [swipe.ts](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts)).
2. Read the initial x-coordinate of the touch (event.clientX).
3. If event.clientX is less than 20px (left edge zone) or greater than (window.innerWidth - 20px) (right edge zone), immediately set the swipe phase to "ignore" and exit. This allows the system to process the edge-swipe back gesture natively without interference from our JavaScript translate animations.
4. Vertical Scroll Locks during Swipes: During a horizontal swipe to switch tabs, a diagonal drag can trigger vertical scroll on the pane, cancelling the horizontal swipe. When the swipe gesture is recognized (phase = swipe), lock vertical scroll by intercepting touchmove events and calling event.preventDefault() using non-passive listeners.

---

## Final Review Decision and Actionable Checklist

### Final Decision: Approve with Conditions

### Checklist of Required Modifications:
1. Confirm the adoption of Alternative A (Independent Scrolling Panes) and discard Alternative B.
2. Avoid dvh units for scrolling viewports. Use 100% or 100svh as a stable height baseline.
3. Modify [swipe.ts](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts) ([detectSwipe](file:///home/losses/Development/janbao/src/lib/actions/swipe.ts#L198)) to ignore touches originating within 20px of the left and right screen edges to prevent native edge-swipe collisions.
4. Implement a Visual Viewport API listener that calculates the software keyboard height and dynamically updates padding-bottom and input offsets using a --keyboard-offset CSS variable.
5. Apply overscroll-behavior-y: contain and -webkit-overflow-scrolling: touch to all scroll containers.
6. Replace window-level scroll restoration with a custom pane-level scrollTop memory store (PanelScrollStore).
