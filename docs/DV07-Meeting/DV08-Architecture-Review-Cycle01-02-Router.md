# DV08 Architecture Review: SvelteKit Router Mechanics and Viewport Layout

## 1. Executive Summary

### Final Decision

Approve with Conditions

### Overview

This review evaluates the architectural proposal in "DV08-Architecture.md" from the perspective of SvelteKit router mechanics. While the core objectives-such as mimicking the Jetpack Navigation BackStack model, eliminating server-side load overhead on detail pages, and stabilizing layout transitions-are sound, the current proposal relies on layout swaps and manual calculations that conflict with SvelteKit's hydration and routing lifecycle. By transitioning to a CSS-driven responsive layout, using SvelteKit's native "snapshot" API for scroll memory, and leveraging Svelte 5 runes for a robust navigation stack store, we can resolve the reported flashing and scroll bugs cleanly.

---

## 2. SvelteKit Navigation Lifecycle Integration (Zero-Flash Transitions)

The current multi-column pager setup suffers from timing-sensitive visual glitches (e.g., detail pages flashing or disappearing) because it attempts to coordinate transitions, DOM restructuring, and scroll offsets after the route has already changed. To solve this, page-level transitions must hook natively into SvelteKit's lifecycle.

### Recommended Lifecycle Hooks

SvelteKit provides three routing hooks that we must utilize:

- "beforeNavigate": Runs before a client-side navigation begins. We use this to detect the navigation direction ("forward" or "back"), store the active pane's scroll position, and set a transitioning state.
- "onNavigate": Runs right before the DOM is updated. This is the optimal place to initiate visual transition animations (such as wrapping the layout in the browser's native View Transitions API via "document.startViewTransition").
- "afterNavigate": Runs after the DOM has updated and scroll coordinates have been resolved by the browser, but before the browser paints. We use this to trigger post-navigation scroll restoration and finalize transition states.

### Architectural Recommendation

Instead of dynamically mounting and unmounting list and detail containers, we should maintain a shared layout shell at the route level. In SvelteKit, the root or layout-level wrappers are preserved across page changes. We can structure our navigation using SvelteKit's native nested layouts:

1. SvelteKit swaps out the leaf page component.
2. The outer layout tracks the active URL route and applies a CSS transition class (such as "slide-forward" or "slide-back") to the track.
3. This guarantees that DOM elements are not torn down and rebuilt mid-transition, eliminating the frame-skip and layout flashes.

---

## 3. Hydration Compatibility (SSR vs. Client State)

The flashing bug on thread entry is rooted in a hydration discrepancy. The server renders the desktop view because "isMobile" defaults to "false" on SSR. When the client page loads:

1. Hydration runs and expects the HTML to match the desktop layout.
2. Once hydration finishes, "onMount" runs, triggering a media query check that flips "isMobile" to "true".
3. This state change forces Svelte to destroy the desktop layout and construct the mobile pager DOM, creating a layout shift and a visual flash.

### Unified DOM Approach (Actionable Proposal)

To ensure perfect hydration compatibility, we must eliminate structural conditional blocks based on JS-detected mobile flags, such as "{#if isMobile}". Instead, we must use a CSS-driven responsive layout:

- The HTML structure sent by the server must be identical for both desktop and mobile viewports.
- Use CSS Media Queries (e.g., "@media (min-width: 768px)") to alter the layout layout. On desktop, columns are rendered side-by-side or styled as fixed sidebars. On mobile, the wrapper uses "display: flex" with "flex-direction: row" and horizontal transforms.
- Progressive Enhancement for Gestures: Interactive features like touch swipe gestures should be attached via a Svelte action (e.g., "use:swipeGesture"). The action mounts only on the client, checks the viewport size, and listens for touch events. This leaves the underlying DOM structure completely intact during server rendering and hydration.

---

## 4. Router State Synchronization & Scroll Management

Synchronizing scroll positions during horizontal swipes is highly fragile when using "translateY(window.scrollY)". It conflicts with SvelteKit's default scroll restoration and lags during inertia scrolls.

### Scroll Restoration under Alternative A vs. Alternative B

- Alternative B (Document Scroll Viewport) scrolls the window natively. This is compatible with Safari's dynamic browser toolbar and SvelteKit's native scroll restoration. However, it requires static overlays to simulate adjacent screens during transitions, which is memory-heavy.
- Alternative A (Independent Scrolling Panes) disables window scrolling and utilizes "overflow-y: auto" on separate panes. To make this work with SvelteKit, we must intercept SvelteKit's default scroll restoration since the window scroll coordinate remains at (0,0).

### Actionable Proposal: SvelteKit Snapshot API

SvelteKit provides a built-in "snapshot" feature specifically designed to capture and restore element-level scroll positions. We should export a snapshot object from our pane layouts:

```typescript
export const snapshot = {
	capture: () => {
		const listPane = document.getElementById('list-scroll-pane');
		const detailPane = document.getElementById('detail-scroll-pane');
		return {
			listScrollTop: listPane ? listPane.scrollTop : 0,
			detailScrollTop: detailPane ? detailPane.scrollTop : 0
		};
	},
	restore: (value) => {
		const listPane = document.getElementById('list-scroll-pane');
		const detailPane = document.getElementById('detail-scroll-pane');
		if (listPane) listPane.scrollTop = value.listScrollTop;
		if (detailPane) detailPane.scrollTop = value.detailScrollTop;
	}
};
```

This ensures that when a user navigates back and forward, SvelteKit handles restoring the scroll offsets of the scrollable divs automatically and matches them to the browser's history entry.

### History State Synchronization

The gesture navigation must be synchronized with the browser history stack:

1. When a swipe-back gesture crosses the threshold, the component calls "history.back()".
2. SvelteKit's "beforeNavigate" hook intercepts this, identifies that the navigation is a "popstate" action, and sets the transition direction to "back".
3. The layout applies the slide-out animation.
4. If a user navigates back using the browser back button or device hardware keys, the same "popstate" flow is triggered, executing the exact same visual transition. This unifies visual swiping and native history events.
5. In the case of direct entry via deep links (where there is no back history in our app), the swipe gesture can fall back to programmatically calling "goto('/', { replaceState: true })" instead of "history.back()".

---

## 5. Global Navigation Store with Svelte 5 Runes

To decouple layout orchestration from routing, we propose a global reactive Navigation Store built using Svelte 5 runes. The store tracks history entries, manages transition states, and exposes reactive signals to coordinate swipe progress.

### Store Architecture

The store tracks the virtual history stack by listening to SvelteKit's navigation hooks.

```typescript
// src/lib/stores/navigation.svelte.ts
import { page } from '$app/state';
import { beforeNavigate, afterNavigate } from '$app/navigation';

class NavigationStore {
	#history = $state<string[]>([]);
	#direction = $state<'forward' | 'backward' | 'none'>('none');
	#swipeProgress = $state(0);
	#isDragging = $state(false);

	get history() {
		return this.#history;
	}
	get direction() {
		return this.#direction;
	}
	get swipeProgress() {
		return this.#swipeProgress;
	}
	get isDragging() {
		return this.#isDragging;
	}

	get canGoBack() {
		return this.#history.length > 1;
	}

	get backTarget() {
		if (this.#history.length > 1) {
			return this.#history[this.#history.length - 2];
		}
		return '/';
	}

	init(initialPath: string) {
		this.#history = [initialPath];
	}

	setSwipe(progress: number, dragging: boolean) {
		this.#swipeProgress = progress;
		this.#isDragging = dragging;
	}

	handleBeforeNavigate(to: string, from: string, type: string) {
		if (type === 'popstate') {
			this.#direction = 'backward';
			if (this.#history.length > 1) {
				this.#history.pop();
			}
		} else {
			this.#direction = 'forward';
			this.#history.push(to);
		}
	}

	handleAfterNavigate() {
		this.#direction = 'none';
		this.#swipeProgress = 0;
		this.#isDragging = false;
	}
}

const NAVIGATION_STORE_KEY = Symbol('navigation-store');
let navigationStoreInstance: NavigationStore;

export function getNavigationStore(): NavigationStore {
	if (!navigationStoreInstance) {
		navigationStoreInstance = new NavigationStore();
	}
	return navigationStoreInstance;
}
```

### Hook Integration

We register this store in the root layout file, "+layout.svelte":

```typescript
import { getNavigationStore } from '$lib/stores/navigation.svelte';
import { page } from '$app/state';
import { onMount } from 'svelte';

const navStore = getNavigationStore();

onMount(() => {
	navStore.init(page.url.pathname);
});

beforeNavigate(({ to, from, type }) => {
	if (to && from) {
		navStore.handleBeforeNavigate(to.url.pathname, from.url.pathname, type);
	}
});

afterNavigate(() => {
	navStore.handleAfterNavigate();
});
```

---

## 6. Addressing Specific Questions in Section 6 of the Proposal

### Question 1: Scroll Memory

What is the most performant way to record and restore scroll states for unmounted panes?

- **Answer**: SvelteKit's native "snapshot" API is the most performant and correct way to manage scroll memory for elements other than "window". Because SvelteKit serializes and associates the captured state directly with the history entries, it survives page refreshes and browser back/forward cache restorations. If elements are kept mounted in the DOM (e.g., Alternative A with hidden visibility), scroll positions are preserved natively by the browser. If we unmount pages, the "snapshot" API will restore positions instantly upon remount.

### Question 2: Safari Keyboard & Views

How does iOS Safari handle virtual keyboard resizing on absolute-positioned elements ("bottom: 0") when multiple panes are aligned in a horizontal flex track?

- **Answer**: In iOS Safari, the virtual keyboard resizes the Visual Viewport, but not necessarily the Layout Viewport. A horizontal flex track wrapping multiple panes (e.g., width "300vw") can trigger horizontal overflows and scroll jumps when the keyboard appears. To resolve this, we must:
  1. Restrict text inputs to only expand the active pane.
  2. Use the Visual Viewport API in Javascript to listen to "window.visualViewport.addEventListener('resize', ...)" and update a CSS custom variable, "--visual-viewport-height".
  3. Style the viewport container's height using "var(--visual-viewport-height, 100vh)" instead of "100dvh". This prevents layout stutters during keyboard resizing and momentum scrolling.

### Question 3: Transition Paint Flash

How can we guarantee zero-frame layout flashes during hydration or route transitions when toggling mobile vs desktop states?

- **Answer**: We must avoid swapping layout structures inside Svelte templates using conditional blocks during hydration. By rendering a single, unified DOM skeleton and using CSS media queries to hide/show columns, the server-rendered HTML matches the client-rendered output exactly. For client-side route transitions, wrapping the DOM modifications inside SvelteKit's "onNavigate" hook and using the Web View Transitions API ensures that the browser captures a static snapshot of the current state, preventing structural updates from rendering as flashes on screen.

### Question 4: State Stack Design

How should we model the navigation state store API in Svelte 5 ("$state" / "$derived") to represent multiple back stacks cleanly?

- **Answer**: The class-based store detailed in Section 5 uses "$state" to track the array of past pathnames and "$derived" to automatically compute "canGoBack" and "backTarget" properties. To represent multiple back stacks (such as separate history stacks for the Discussions tab and the Messages tab), we can structure the navigation store to contain a dictionary of history arrays indexed by the tab index, and swap the active stack dynamically based on the current active tab path.

---

## 7. Summary of Actionable Conditions for Approval

To proceed with this refactoring, the following conditions must be met:

1. **Eliminate Conditional Layout Templates**: The layout structure in "ThreadPager.svelte" and related containers must be refactored to use a single, unified HTML structure. Svelte's conditional blocks (such as checking "isMobile") should not govern layout wrapper swapping. Styling changes between mobile and desktop viewports must be handled by CSS media queries.
2. **Utilize SvelteKit Snapshots**: Instead of custom "translateY" hacks and local window scroll stores, the project must adopt the SvelteKit "snapshot" API for scroll restoration on scrollable panes.
3. **Optimize Server Data Loads**: Remove the eager-fetching database calls for "list" and "activity" from "src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts". These queries should only execute when their respective routes are loaded directly, and the data should be shared via the client-side store when swiping.
4. **Standardize Navigation Store**: Implement the global Navigation Store using Svelte 5 runes as specified in Section 5, and register it within the root "+layout.svelte" file to synchronize with SvelteKit's native navigation lifecycle.
