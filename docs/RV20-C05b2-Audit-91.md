# RV20-C05b2 - Audit Round 91

Result: **A FAIL (1 concern); B FAIL (1 concern + 4 low/very-low).** Counter stays
**0/5**. This was the FIRST round with the OPEN-scoped audit prompt (no
file/trajectory/defect-type/invariant list). It found SIX defects in one round,
ALL outside the orchestrator/animation layer that the prior scoped prompt had been
excluding. This validated the user's feedback that the scoped prompt manufactured
false confidence by excluding other bug spaces.

## A's finding (FIXED)

**`<title>` missing on mobile for every primary tab route (concern, FIXED).** The
(tabs) layout's mobile branch renders `NavPipelineTabHost` (not `{@render
children()}`), so the child route's `<svelte:head><title>` never applies on mobile
and `NavPipelineTabHost` had none of its own. Verified by curl: mobile UA on `/`,
`/activity`, `/messages/inbox`, `/discussions/pN` returned no `<title>` (browser
tab, PWA install, bookmarks/history, and the screen-reader accessibility tree all
lost the document identity). Same bug class as R90's passthrough (the mobile
branch skips children, dropping side-effects); R90 restored the IDB write but not
the title. Fix: `NavPipelineTabHost` now publishes `activeTitle` (a `$derived` of
`activeIndex`: 0 -> `t.nav.home`, 1 -> `t.nav.activity`, 2 -> `t.message.inbox`;
`/discussions/pN` resolves to tab 0) via `<svelte:head><title>`. curl-verified:
mobile now returns the title for all four; desktop unchanged.

## B's findings (all FIXED)

1. **Dead `target` field + unreachable template in `notifications/+page.svelte`
   (low, FIXED).** `target` was declared/returned/template'd but never assigned
   non-null. Removed the field, the local, the return, and the unreachable block.
2. **Dead `inbox` field + wasted `getConversations` query on every message-thread
   load (concern, FIXED).** `messages/[id]/+page.server.ts` eagerly fetched the
   inbox and returned `inbox`, read nowhere (it was for the deleted ThreadPager).
   Removed the fetch + the return field.
3. **Dead `totalRepliesCount` return in the discussion-thread page server (very
   low, FIXED).** Computed internally (needed for `totalPages`) but returned and
   unread. Removed the return field; kept the internal computation.
4. **Stale `ThreadPager` comment references (low, FIXED).** Five comments across
   `thread-nav.svelte.ts`, `messages/[id]/+page.server.ts`, and the discussion
   page referenced the deleted `ThreadPager`. Rewritten to the current
   `NavPipelineHost` / `.detail-scroll-pane`. grep confirms zero `ThreadPager`
   references remain in `src/`.
5. **`/messages/add/[userId]` tab-bar pill flash (low, FIXED).** `TAB_BAR_CONFIG`
   omitted `/messages/add/`, so SSR/first-paint showed no pill highlight, then
   flashed to the Messages pill after `configure`. `/messages/new` (sibling) had
   it from SSR. Fix: added `/messages/add/` to `TAB_BAR_CONFIG`
   (`pillTarget: 'messages'`); updated `route-config.test.ts` (which had LOCKED
   the defect) to assert `'messages'` / index 2.

## Horizontal check (the (tabs) mobile-branch side-effect sweep)

Every side-effect the four (tabs) child routes' `+page.svelte` files perform was
enumerated. Each is either restored on mobile (runPassthrough by R90; `<title>`
by this round's A1) or explicitly acknowledged desktop-only (the activity
offline-fallback onMount, with a standing comment). No silently-dropped
side-effect remains.

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1457 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    210 passed / 0 flaky (exit 0)
```

R92 audits this state (open-scoped prompt).
