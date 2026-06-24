# DV08 Architecture Review: Performance and Database Optimization

## 1. Executive Summary

This document presents a performance and database engineering review of the proposed refactoring for Janbao's mobile navigation, routing, and viewport layout (DV08-Architecture.md). The core architecture proposal-decoupling viewport layout from routing using a Jetpack Navigation-inspired back stack and resolving Safari viewport layout issues-is conceptually sound and addresses significant user experience issues.

However, the current implementation contains a critical database performance bottleneck on discussion thread page loads. Every time a thread detail page is loaded, the server eagerly queries the first page of discussions and the activity feed. This eagerly fetched data is redundant for desktop users and unnecessarily eager for mobile users. We propose resolving this redundant load by introducing a client-side reactive store/cache for lists, optimizing deep-linking behaviors, and minimizing database queries during transitions.

## 2. Review Decision

Decision: Approve with Conditions

The architectural proposal is approved for implementation, subject to satisfying the conditions outlined in Section 5 of this report.

## 3. Analysis & Actionable Proposals

### 3.1 Redundant Server-Load Call Optimization

In the current codebase, the load function in the thread detail page server-side file "+page.server.ts" (located under "src/routes/discussion/[discussionId]/[slug]/[[page=page]]/") contains an eager-loading mechanism (lines 280 to 302). It invokes:

1. "loadDiscussionsPage" to retrieve the first page of the general discussions list.
2. "loadActivityPage" to retrieve the first page of the activity feed.

This is done so that the mobile "ThreadPager" component can mount the left and right neighbor panels immediately to support swipe reveals.

**Performance Impact:**

- Database Overhead: This eager loading triplifies the database query load for every thread detail page visit. Instead of running a single discussion detail query and replies pagination query, SvelteKit must run heavy joins across categories, users, discussions, and activity tables.
- Redundant Actions: For desktop users, the "ThreadPager" is bypassed completely (rendering children directly), meaning these database queries are completely wasted. For mobile users, the data is only used if the user actually decides to swipe sideways.

**Actionable Proposal:**

- Remove lines 280 to 302 (the eager Promise.all block fetching "list" and "activity") from the thread detail page "+page.server.ts".
- Do not return the "list" or "activity" properties from the thread page's server load function.

### 3.2 Client-Side Reactive Store/Cache Design

To replace the server-side preloading of the neighboring lists on mobile, we propose implementing a client-side reactive store/cache.

**Store Architecture:**
We will define a new store file "list-cache.svelte.ts" inside "src/lib/stores/". Using Svelte 5's reactive state syntax, this store will capture and hold the latest state of lists as they are viewed:

- Class Name: ListCache
- Reactive Fields:
  - discussions: the discussions list data (page 1)
  - activity: the activity feed data (page 1)
  - messages: the messages list data (page 1)
- Setter Methods:
  - setDiscussions(data)
  - setActivity(data)
  - setMessages(data)

**Populating the Cache:**
In the tabs layout component "+layout.svelte" (located under "src/routes/(tabs)/"), which wraps the main lists, we will execute a Svelte 5 reactive effect ($effect) that watches data.home, data.activity, and data.messages. Whenever SvelteKit updates these properties from server navigation, the effect will write the fresh lists into the global "listCache" store. Because this store is instantiated at the module level on the client, it survives SvelteKit page unmounts and route transitions.

### 3.3 Deep-Linking and Navigation Behavior

We must distinguish between two navigation flows for mobile users:

**Flow 1: Cache Hit (Navigation from List to Thread)**
When a user starts on the discussions list and clicks a thread, SvelteKit navigates to the thread detail page.

- Behavior: The "ThreadPager" component checks the "listCache" store. Since the cache has been populated, it renders the left and right swipe panels ("DiscussionsPanel" and "ActivityPanel") instantly using the cached data.
- Transition: The swipe transitions work smoothly without any layout flashes or database hits. Returning to the list restores the scroll position perfectly using the "listScroll" store.

**Flow 2: Cache Miss (Deep-Linking directly to a Thread)**
When a user lands on a thread page directly via a deep link (e.g. from an external link, a browser bookmark, or a hard browser refresh), the client-side "listCache" is empty.

To protect the server from redundant database queries, we specify the following behaviors:

1. Collapse to Single Column (Recommended Default): If "listCache" is empty, "ThreadPager" should disable the left and right neighbor panels. In the Svelte template, the left and right snippets should evaluate to null. This naturally collapses "ThreadPager" into a single-pane viewport. The user cannot swipe horizontally, and the horizontal swipe indicator is hidden. Left edge-swiping will fallback to executing "history.back()" (if referring pages exist) or returning to "/" via SvelteKit "goto".
2. On-Demand Lazy Fetching (Alternative): If horizontal swipe behavior must be preserved on deep-linked entries, the client should not fetch list data during initial page load. Instead, the fetch must be deferred. The "ThreadPager" will listen for drag gestures. Only when the swipe action is initiated (e.g. horizontal drag distance exceeds 10px), the client-side component will run a "fetch" call to API endpoints (such as "/api/discussions" and "/api/activities") to retrieve page 1 data. The neighbor panel will display a skeleton loading state until the client-side fetch resolves.

### 3.4 Minimizing Database Queries and Eliminating Transition Round-Trips

- Query Reduction: Removing the eager list fetching from the thread page server-load cuts database query density from 3x to 1x per thread load.
- Scroll Restoration: When the user swipes back to the discussions list, SvelteKit will restore the page layout. To prevent redundant database queries during this return navigation, the browser's "history.scrollRestoration" together with Janbao's "list-scroll" store should position the window without prompting a fresh page reload.
- HTTP Caching: We propose adding short-term HTTP Cache-Control headers (e.g., max-age=60) or SvelteKit setHeaders configuration for backend list API routes and layout loads. This ensures that even if SvelteKit triggers a server load call during browser history back-and-forth actions, the request is intercepted and served from the browser's disk/memory cache rather than hitting the database.

## 4. Responses to Questions for Reviewers

### 4.1 Scroll Memory

What is the most performant way to record and restore scroll states for unmounted panes?

- Proposal: Use a global reactive Svelte store ("list-scroll.svelte.ts") mapping pathnames/pane keys to vertical scroll offsets. During "beforeNavigate" and on component destroy, capture the active container's "window.scrollY" (or element "scrollTop") and write it to the store. When mounting the pane, read the store and restore the scroll position via a synchronous "window.scrollTo" (or direct assignment) within "afterNavigate", preceding the first paint.

### 4.2 Safari Keyboard & Views

How does iOS Safari handle virtual keyboard resizing on absolute-positioned elements (bottom: 0) when multiple panes are aligned in a horizontal flex track?

- Proposal: iOS Safari dynamically adjusts the visual viewport size when the software keyboard opens, but it does not always trigger a layout viewport resize. Using absolute positioning ("top: 0; bottom: 0") inside a fixed parent causes elements to shrink correctly to fit the visible area. To prevent horizontal tracking issues in a multi-pane flex layout, ensure the parent has "overflow: hidden" and the active pane has "flex-shrink: 0" and "width: 100%".

### 4.3 Transition Paint Flash

How can we guarantee zero-frame layout flashes during hydration or route transitions when toggling mobile vs desktop states?

- Proposal: Avoid runtime breakpoint toggling inside "onMount" to switch layouts (e.g. changing "isMobile" from default false to true). Instead, leverage CSS media queries to control visibility of desktop and mobile layouts. The DOM structure for both should be identical or styled conditionally using display rules (e.g., hidden class toggles on Tailwind-like breakpoints or desktop-only display rules). If Svelte structure switches are necessary, the Svelte compiler must receive the server-side user-agent state during SSR (which Janbao already loads in "+layout.server.ts" as "isMobile") so that hydration matches the server-rendered DOM.

### 4.4 State Stack Design

How should we model the navigation state store API in Svelte 5 to represent multiple back stacks cleanly?

- Proposal: Model the navigation stack as a reactive class containing an array of route objects representing the stack entries. The array should be updated in a custom "push", "pop", or "replace" routine. We can maintain a separate array for each stack (e.g., discussions tab stack vs messages tab stack) and use a reactive property to track the active stack index.

## 5. Conditions for Approval

To complete this architectural change, the following conditions must be met during implementation:

1. **Server Load Cleanup**: Completely delete the eager calls to "loadDiscussionsPage" and "loadActivityPage" inside "src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts".
2. **Client-Side Cache Implementation**: Implement the "ListCache" store ("list-cache.svelte.ts") to save home discussions list and activity feed data on the client.
3. **Template Bindings**: Update the discussion page component "+page.svelte" to feed the left and right snippets of "ThreadPager" from the "ListCache" store instead of SvelteKit's server "data" object.
4. **Graceful Cache Miss Fallback**: Modify "ThreadPager" to check if the client-side list cache is empty. If it is empty, disable the horizontal swipe panels and swipe gestures completely, or render skeleton views and trigger on-demand lazy loading only when a swipe drag starts.
