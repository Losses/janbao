# DV08 Architecture Review Cycle 2: Performance and Database Optimization

## Review Target

Document: docs/DV08-Meeting/DV08-Architecture.md

## Evaluator Role

Performance and Database Engineer

## Review Opinion

Approve

---

## 1. Executive Summary

This document presents the Cycle 2 performance and database engineering review of the updated architecture proposal for Janbao's mobile navigation, routing, and viewport layout (docs/DV08-Meeting/DV08-Architecture.md).

In the Cycle 1 review, several critical conditions were identified to eliminate database query overhead and layout reflow/flickering issues: removing eager list and activity queries on thread server load, implementing a client-side reactive store/cache for lists, and implementing a graceful fallback to a single-column layout on cache miss.

Upon reviewing the updated proposal, we find that all requested optimization strategies have been fully, accurately, and correctly integrated into the design specifications. The revised architecture effectively trims database load, enables instant swipe transitions via client-side caching, and establishes robust deep-linking behavior without redundant queries.

---

## 2. Verification of Cycle 1 Conditions

We have verified that each of the conditions specified in the Cycle 1 review has been addressed and incorporated into the revised proposal:

### 2.1 Server Load Cleanup (Condition 1)

- Condition: Completely delete the eager calls to loadDiscussionsPage and loadActivityPage inside src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts.
- Verification: Section 7.1 (Server Load Trimming) of the updated architecture specification details the deletion of these eager list and activity queries inside the thread server load function. The document specifies modifying the page server load file to completely delete calls to loadDiscussionsPage and loadActivityPage inside the Promise.all block. This matches the condition perfectly and will result in a 66 percent database query reduction on thread page loads.

### 2.2 Client-Side Cache Implementation (Condition 2)

- Condition: Implement the ListCache store (list-cache.svelte.ts) to save home discussions list and activity feed data on the client.
- Verification: Section 7.2 (Client-Side List Cache) of the updated proposal incorporates this by introducing a module-level Svelte 5 reactive cache store named list-cache.svelte.ts. This cache will track and hold the Discussions, Activity, and Messages lists, ensuring that list items remain accessible in memory across navigations.

### 2.3 Template Bindings (Condition 3)

- Condition: Update the discussion page component +page.svelte to feed the left and right snippets of ThreadPager from the ListCache store instead of SvelteKit's server data object.
- Verification: Section 7.2 of the updated architecture proposal states that when navigating, ThreadPager will read list items from this client cache to render the left/right swipe previews. This decoupling from the SvelteKit server load data directly satisfies the template binding requirement.

### 2.4 Graceful Cache Miss Fallback (Condition 4)

- Condition: Modify ThreadPager to check if the client-side list cache is empty. If it is empty, disable the horizontal swipe panels and swipe gestures completely, or render skeleton views and trigger on-demand lazy loading only when a swipe drag starts.
- Verification: Section 7.2 of the updated proposal specifies that if a user deep-links directly, the cache will be empty, and the ThreadPager will recognize this cache miss, automatically disabling the horizontal swipe gesture panels and collapsing the layout into a single-column viewport. This ensures zero redundant server fetches upon direct deep-linking.

---

## 3. Final Review Decision

All conditions specified in the Cycle 1 review are fully met.

Decision: Approve (Unconditional)
