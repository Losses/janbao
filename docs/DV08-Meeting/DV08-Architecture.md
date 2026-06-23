# DV08 Architecture: Refactoring Mobile Multi-Column Navigation and Viewport Layout

## Status: Final Proposal (Approved Cycle 2 Draft)

## 1. Executive Summary & Design Decision

This document details the finalized technical specification for refactoring the mobile multi-column navigation, SvelteKit routing, and viewport scrolling layout of the Janbao application.

Following a comprehensive architecture review (Cycle 02) by five independent review roles, all conditions have been addressed. The layout architecture adopts **Alternative A (Independent Scrolling Panes)**. The global document-level scroll is locked, and scroll columns are isolated.

This document serves as the final specification for the refactoring.

---

## 2. Structural & Layout Specifications (Zero-Flash Hydration)

### 2.1 Hydration Flashes and Media Queries

To eliminate the 1-frame paint flash caused by Svelte executing DOM restructuring on client-side mount (switching `isMobile` from its default `false` to `true` inside `onMount`), we will completely remove conditional JS layout-swapping blocks like `{#if isMobile}`.

- **Unified DOM Structure**: The server will render a single, identical DOM tree containing both columns.
- **CSS Breakpoint Govern**: Layout styling and visibility will be governed by CSS Media Queries. On screens wider than 767px, columns are positioned side-by-side. On screens 767px or narrower, columns are styled as a horizontal flex layout, where inactive columns are hidden off-screen or translated horizontally.
- **Progressive Enhancement**: Gestural listeners will be progressively attached on the client side using a Svelte action (e.g. `use:swipeGesture`). The action checks the viewport and attaches touch event listeners only on mobile screens, leaving the underlying DOM completely unaffected during server-side pre-rendering and hydration.

### 2.2 Independent Scrolling Panes CSS Specs

The document viewport will be locked, and scroll areas will be isolated to individual pane elements.

```css
/* Lock main document from scrolling and rubber-banding */
html,
body {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	overflow: hidden;
	width: 100%;
	height: 100%;
}

/* Pager viewport wrapper */
.pager-viewport {
	position: absolute;
	top: var(--header-height, 62px);
	bottom: 0;
	left: 0;
	right: 0;
	overflow: hidden;
}

/* Individual scrolling panels */
.scroll-pane {
	width: 100vw;
	height: 100%;
	overflow-y: auto;
	overscroll-behavior-y: contain; /* Stop scroll chaining to body */
	-webkit-overflow-scrolling: touch; /* Momentum scroll on older WebViews */
}
```

---

## 3. Gestural Mechanics & Intent Detection

### 3.1 OS Edge-Swipe Conflict Resolution

To prevent custom JavaScript translation animations from colliding with system edge-swipe navigation gestures (like iOS Safari's left edge-swipe back navigation):

- We will modify the pointerdown handler of `detectSwipe` in `swipe.ts` to implement a 20px edge margin safety zone.
- If a touch begins at `clientX < 20px` (left edge margin) or `clientX > (window.innerWidth - 20px)` (right edge margin), the swipe phase will immediately change to `ignore` and exit.
- This allows the browser OS to handle the edge-swipe back gesture natively.

### 3.2 Dynamic Transition Heights

To prevent content clipping when swiping from a shorter active pane to a taller incoming neighbor:

- During active drags or swipe animations, the height of the viewport container will be dynamically set to the maximum height of the active and adjacent panels:
  `viewportHeight = Math.max(activePanelHeight, incomingPanelHeight)`
- The height will only snap to the active panel's height once the transition has completely finished and settled.

### 3.3 Touchmove Scroll Locking

- **Vertical Scroll Lock during Swipes**: In `swipe.ts`, when a horizontal swipe gesture is active (`phase === 'swipe'`), we will intercept `touchmove` events using non-passive listeners and call `event.preventDefault()` to lock vertical scrolling, preventing diagonal jitter.
- **Overscroll Boundary Lock (iOS 15 / WebView Fallback)**: On scrollable panes, if `scrollTop === 0` and the user drags down, or if `scrollTop === scrollHeight - clientHeight` and the user drags up, we will intercept `touchmove` and call `event.preventDefault()` to block Safari's elastic document bounce.

---

## 4. Navigation BackStack & History Synchronization

We will map Android Jetpack Navigation concepts (LIFO BackStack and Tab-level Multiple Back Stacks) to SvelteKit routing.

### 4.1 Global Navigation Store (`navigation.svelte.ts`)

The Navigation Store maintains virtual back stacks, supports synthetic stack initialization for deep links, handles hook registrations, and exposes public API getters:

```typescript
// src/lib/stores/navigation.svelte.ts
import { page } from '$app/state';
import { beforeNavigate, afterNavigate } from '$app/navigation';

class NavigationStore {
	// Virtual stacks for each of the 3 tabs: 0 (Discussions), 1 (Activity), 2 (Messages)
	#stacks = $state<Record<number, string[]>>({
		0: ['/'],
		1: ['/activity'],
		2: ['/messages/inbox']
	});
	#activeTab = $derived(this.getTabFromPath(page.url.pathname));
	#direction = $state<'forward' | 'backward' | 'none'>('none');

	getTabFromPath(path: string): number {
		if (path.startsWith('/activity')) return 1;
		if (path.startsWith('/messages')) return 2;
		return 0;
	}

	get activeStack() {
		return this.#stacks[this.#activeTab];
	}

	getStack(tabIdx: number): string[] {
		return this.#stacks[tabIdx];
	}

	get backTarget() {
		const currentStack = this.activeStack;
		if (currentStack.length > 1) {
			return currentStack[currentStack.length - 2];
		}
		return '/';
	}

	get direction() {
		return this.#direction;
	}

	// Synthetic stack initialization on startup to support deep linking
	init(initialPath: string) {
		const tabIdx = this.getTabFromPath(initialPath);
		if (initialPath === '/' || initialPath === '/activity' || initialPath === '/messages/inbox') {
			this.#stacks[tabIdx] = [initialPath];
		} else {
			// Synthetically construct root parent history
			const rootPath = tabIdx === 1 ? '/activity' : tabIdx === 2 ? '/messages/inbox' : '/';
			this.#stacks[tabIdx] = [rootPath, initialPath];
		}
	}

	handleBeforeNavigate(to: string, from: string, type: string) {
		const toTab = this.getTabFromPath(to);
		const fromTab = this.getTabFromPath(from);

		if (toTab !== fromTab) {
			// Tab switch - does not modify the vertical stack
			return;
		}

		if (type === 'popstate') {
			this.#direction = 'backward';
			if (this.#stacks[toTab].length > 1) {
				this.#stacks[toTab].pop();
			}
		} else {
			this.#direction = 'forward';
			this.#stacks[toTab].push(to);
		}
	}

	handleAfterNavigate() {
		this.#direction = 'none';
	}
}

let navStoreInstance: NavigationStore;

export function getNavigationStore(): NavigationStore {
	if (!navStoreInstance) {
		navStoreInstance = new NavigationStore();
	}
	return navStoreInstance;
}
```

### 4.2 Lifecycle Event Hook Registrations

The navigation store must be registered in the root layout file, `+layout.svelte`, to listen to SvelteKit routing events:

```typescript
// src/routes/+layout.svelte
import { getNavigationStore } from '$lib/stores/navigation.svelte';
import { beforeNavigate, afterNavigate } from '$app/navigation';
import { onMount } from 'svelte';

const navStore = getNavigationStore();

onMount(() => {
	navStore.init(window.location.pathname);
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

### 4.3 LIFO BackHandler Dispatcher

To support custom intercepts (closing open drawers, panels, or modals) before executing route pops:

```typescript
// src/lib/utils/back-handler.ts
export type BackCallback = () => boolean; // returns true if gesture was consumed

class BackHandlerDispatcher {
	#handlers = $state<BackCallback[]>([]);

	register(callback: BackCallback) {
		this.#handlers.push(callback);
		return () => {
			this.#handlers = this.#handlers.filter((h) => h !== callback);
		};
	}

	dispatch(): boolean {
		if (this.#handlers.length > 0) {
			const handler = this.#handlers[this.#handlers.length - 1];
			const consumed = handler();
			if (consumed) return true;
		}
		return false;
	}
}

export const backHandler = new BackHandlerDispatcher();
```

---

## 5. Unified Subpage Gesture Page Layout (`GesturePageLayout.svelte`)

To ensure that subpages (settings, profile, admin) have a consistent edge-swipe gesture layout:

```svelte
<!-- src/lib/components/templates/GesturePageLayout.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { backHandler } from '$lib/utils/back-handler';
	import { detectSwipe } from '$lib/actions/swipe';

	interface Props {
		children: Snippet;
		fallbackRoute?: string;
	}

	let { children, fallbackRoute = '/' }: Props = $props();
	const navStore = getNavigationStore();

	let dragOffset = $state(0);

	function onSwipeMove(deltaX: number) {
		if (deltaX > 0) {
			dragOffset = deltaX;
		}
	}

	function onSwipeEnd(deltaX: number) {
		if (deltaX > 80) {
			// Trigger LIFO callbacks first
			const consumed = backHandler.dispatch();
			if (!consumed) {
				// Fallback to history pop
				if (navStore.activeStack.length > 1) {
					history.back();
				} else {
					// Deep-linked direct entry fallback
					goto(fallbackRoute, { replaceState: true });
				}
			}
		}
		dragOffset = 0;
	}

	const contentStyle = $derived(
		dragOffset > 0 ? `transform: translateX(${dragOffset}px); transition: none;` : ''
	);
</script>

<div
	class="w-full h-full scroll-pane transition-transform duration-200"
	style={contentStyle}
	use:detectSwipe={{ onMove: onSwipeMove, onEnd: onSwipeEnd }}
>
	{@render children()}
</div>
```

---

## 6. Coordinated Navigation Chrome Transitions

- **Bottom Tab Bar Animation**: The bottom tab bar translation is bound to the edge-swipe progress:
  `transform: translateY(Math.max(0, 100 * (1 - progress))%)`
- **Header cross-fade**: The header transition is bound to the horizontal swipe offset, translating the detail header to the right proportionally to the swipe while cross-fading the list header in.

---

## 7. Scroll Position Memory (Hydration Timing Fix)

To resolve the timing bug where `document.getElementById` runs inside SvelteKit's `snapshot.restore` before Svelte finishes mounting the new page's DOM elements, scroll positions will be bound to Svelte 5 reactive variables:

```typescript
// src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte
import { onMount } from 'svelte';

let listScrollTop = $state(0);
let detailScrollTop = $state(0);

export const snapshot = {
	capture: () => ({ listScrollTop, detailScrollTop }),
	restore: (value) => {
		listScrollTop = value.listScrollTop;
		detailScrollTop = value.detailScrollTop;
	}
};

let listEl = $state<HTMLElement | null>(null);
let detailEl = $state<HTMLElement | null>(null);

// Apply restored scroll values reactively once DOM elements are instantiated
$effect(() => {
	if (listEl && listScrollTop > 0) {
		listEl.scrollTop = listScrollTop;
	}
});

$effect(() => {
	if (detailEl && detailScrollTop > 0) {
		detailEl.scrollTop = detailScrollTop;
	}
});
```

In the markup, we bind the pane elements and track their scrolling:

```svelte
<div
	bind:this={listEl}
	class="scroll-pane"
	onscroll={(e) => (listScrollTop = e.currentTarget.scrollTop)}
>
	<!-- List contents -->
</div>

<div
	bind:this={detailEl}
	class="scroll-pane"
	onscroll={(e) => (detailScrollTop = e.currentTarget.scrollTop)}
>
	<!-- Detail contents -->
</div>
```

---

## 8. iOS Safari Keyboard Shift Fix

To resolve the Visual Viewport shift on iOS Safari which forces fixed headers off-screen when inputs are focused:

- We will attach a Visual Viewport Resize listener.
- On keyboard resizing, calculate the keyboard height:
  `keyboardHeight = window.innerHeight - window.visualViewport.height`
- Update a CSS custom property `--keyboard-offset` on the root node.
- Resizing scroll panes and inputs will read this variable to pad themselves:
  `padding-bottom: var(--keyboard-offset);`
  This dynamically shortens the scrollable container and shifts the input above the software keyboard, preventing Safari from scrolling the header off-screen.

---

## 9. Performance & Caching Specifications

### 9.1 Server Load Trimming

We will delete the eager list and activity queries inside the thread server load function:

- Modify `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts` to completely delete calls to `loadDiscussionsPage` and `loadActivityPage` inside the `Promise.all` block.
- This reduces server database hits by 66% on thread loads.

### 9.2 Client-Side List Cache

- A module-level Svelte 5 reactive cache store (`list-cache.svelte.ts`) will track and hold Discussions, Activity, and Messages lists.
- When navigating, `ThreadPager` will read list items from this client cache to render the left/right swipe previews.
- If a user deep-links directly, the cache will be empty. The `ThreadPager` will recognize this cache miss and automatically disable the horizontal swipe gesture panels, collapsing into a single-column viewport.
