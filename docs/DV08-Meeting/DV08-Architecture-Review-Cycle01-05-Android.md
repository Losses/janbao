# DV08 Architecture Review Report: Native Android Navigation Translation

**Prepared by:** Android Systems Architect
**Target Architecture Proposal:** [docs/DV08-Meeting/DV08-Architecture.md](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md)
**Final Decision:** Approve with Conditions

---

## 1. Executive Summary

The architecture proposal in [docs/DV08-Meeting/DV08-Architecture.md](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md) addresses critical regressions in the responsive viewport and navigation system of the Janbao application.

This review evaluates the proposal from the perspective of native Android navigation translation. Translating native Android paradigms such as BackStack, Multiple Back Stacks, SlidingPaneLayout, and back callback dispatchers into a SvelteKit SPA (Single Page Application) provides a solid blueprint to eliminate view transition bugs, layout height collisions, and server-side data loading overheads.

The proposed changes are Approved with Conditions. The conditions focus on the precise details of mapping the virtual stack to browser history, implementing clean synthetic back stack paths for deep links, structuring responsive layout panes using independent scroll viewports (Alternative A), and designing a declarative Svelte 5 BackHandler API.

---

## 2. Mapping Android BackStacks and Multiple Back Stacks onto SvelteKit

In native Android development, Jetpack Navigation manages multiple back stacks, particularly when dealing with bottom navigation. Each tab (e.g., Discussions, Activity, Messages) holds its own navigation history. When a user navigates from tab Discussions to thread Detail, then switches to tab Messages, and subsequently returns to Discussions, they are returned to the active state of Detail (with scroll position preserved). A back gesture on Discussions pops Detail to return to the Discussions list, rather than navigating chronologically back through Messages.

To map this model onto SvelteKit:

1. **Virtual Stack Registry**: Implement a global Navigation Store in a new file, such as [navigation.svelte.ts](file:///home/losses/Development/janbao/src/lib/stores/navigation.svelte.ts). This store maintains reactive arrays of strings/objects for each primary tab stack.
2. **Dynamic Route Interception**:
   * During cross-tab navigations (e.g., clicking on the Messages tab in the bottom bar), the application checks the registry. Instead of unconditionally navigating to the tab's root pathname (/messages/inbox), the click navigates to the topmost saved URL in the Messages stack. This replicates Android's restoreState behavior.
   * During stack-level navigations (moving from list to detail), the registry appends the detail route URL to the active tab's stack array.
3. **Synchronizing URL with Stacks**: SvelteKit remains the ultimate source of truth for the browser's address bar. The virtual stack registry synchronizes itself by listening to SvelteKit's navigation lifecycle events (beforeNavigate and afterNavigate).

---

## 3. Translating SlidingPaneLayout and TwoPaneLayout Concepts

Android's SlidingPaneLayout and TwoPaneLayout components provide responsive structures that display a list and detail pane side-by-side on wide screens (desktop) and show a single sliding pane on narrow screens (mobile).

1. **Adopting Alternative A (Independent Scrolling Viewports)**:
   * The architecture proposal presents two directions. This review strongly recommends Alternative A (Independent Scrolling Viewports). In Android, list and detail panes are separate view containers (e.g., RecyclerView inside fragments), each managing its own scroll state. Translating this to the web via independent overflow containers (overflow-y: auto) isolated from body-level scroll is the most robust way to eliminate scroll height collisions and complex DOM-cloning overhead.
   * Dynamic toolbar behavior on iOS Safari must be mitigated. Using viewport height styles (such as svh or custom height bounds on parent flex containers) combined with touch action definitions on the scrolling containers ensures that viewport heights adapt without double scrollbars.
2. **Server-Side Data Load Trimming**:
   * The server load function for detail routes in [+page.server.ts](file:///home/losses/Development/janbao/src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts) currently eager-loads first-page lists and activity data, tripling database overhead on mobile.
   * Under the TwoPaneLayout translation, we must separate data requirements. When a page is rendered on mobile (single-pane), only the detail data is required. When rendered on desktop (dual-pane), both list and detail are required.
   * The server-side load function should only load the thread detail data. The list preview on the left must read from a client-side reactive cache. If the user deep-links directly on mobile, the left panel can remain empty or display a light client-side skeleton, rather than overloading the database.

---

## 4. Integrating the Back Stack with Browser History

For a web application, standard browser history is linear and cannot be bypassed. The virtual navigation stacks must align with standard browser history entries so that popBackStack corresponds to history.back().

1. **Back Gesture Mapping**:
   * When a user performs an edge-swipe gesture on mobile, the gesture callback must invoke history.back() rather than a manual route change. SvelteKit's router intercepts the popstate event, restores scroll positions, and updates the active route.
2. **Synthetic Back Stack for Deep Links**:
   * In Android, if a user opens a deep link directly to a detail page, the back stack is synthetically populated with parent routes, so pressing back navigates to the list. On the web, if a user deep-links directly to a thread, the browser history has a length of 1. Calling history.back() would navigate the user out of the site or do nothing.
   * We must implement a fallback path. The custom back handler detects if there is no previous internal history entry (by checking the Navigation API entries or a store-level referrer flag). If no internal history exists, the handler performs a programmatic push (goto) to the list page (/).

---

## 5. Declarative Navigation API for Svelte Components

In Svelte 5, the navigation and back handling should be declared reactively using runes and unified interfaces.

1. **BackHandler Component and Dispatcher**:
   * Android utilizes a dispatcher to let composables intercept the system back button. Svelte 5 should implement a central Back Handler Dispatcher that maintains a LIFO (Last-In, First-Out) stack of callbacks.
   * Svelte components register back-interceptors using a Svelte action or a utility. For instance, an open drawer registers a callback to close itself. When a back gesture or swipe is detected, the dispatcher triggers the top handler. If it returns true, the event is consumed (the drawer closes). If no custom handlers are registered, the app falls back to standard back navigation.
2. **Declarative Navigation Controller Store**:
   * Provide a controller store containing reactive state and methods:
     * activeStack: a reactive array of URLs representing the active stack.
     * currentDestination: a reactive property returning the current route.
     * navigate(url, options): triggers SvelteKit goto with custom stack state options.
     * popBackStack(): initiates a back action, delegating to the dispatcher or history.back().

---

## 6. Conditions for Approval

To transition this review to a full approval, the following conditions must be implemented during refactoring:

1. Refactor data loading in [+page.server.ts](file:///home/losses/Development/janbao/src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts) to eliminate list queries, shifting to client-side caching of list views.
2. Implement the virtual navigation stacks in [navigation.svelte.ts](file:///home/losses/Development/janbao/src/lib/stores/navigation.svelte.ts) and sync it with SvelteKit's navigation lifecycle.
3. Replace [ThreadPager.svelte](file:///home/losses/Development/janbao/src/lib/components/templates/ThreadPager.svelte) with a TwoPaneLayout component that aligns with Alternative A (Independent Scrolling Viewports) and manages separate scroll states.
4. Establish the central Back Handler Dispatcher to intercept mobile back gestures for drawers, modals, and detail panes before falling back to browser history.
