# RV20-C05b2 - Audit Round 95

Result: **A FAIL (1 concern + 1 concern + 1 low + 2 very-low); B FAIL (1 concern +
4 very-low).** Counter stays **0/5**. The fifth OPEN-scoped round. Two concerns:
A1 is a user-visible regression the R93 ActivityRow change had exposed (the
recipient display-name projection still used a truthy guard on `recipientId`,
dropping id 0), and B1 is an offline manifest depth mismatch that silently
showed incomplete threads. Both fixed, plus eight low/very-low findings. The id-0
recipient class, which had leaked siblings across R93/R94, is now fully closed
after this round's exhaustive sweep.

## A's findings

1. **Directed-activity recipient display name dropped when recipientId === 0
   (concern, FIXED).** `src/lib/server/db/dao/activities.ts:186-189` and
   `src/routes/profile/[userId]/[userSlug]/+page.server.ts:234-237` projected
   `recipientDisplayName`/`recipientUsername` with `a.recipientId ? ... : null`.
   The truthy guard is falsy for id 0 (the bootstrap admin); `recipientMap` IS
   populated for id 0 (the filter passes it), but the projection discarded it.
   R93 changed `ActivityRow.svelte`'s render guard to `isRealUserId(recipientId)`
   (renders for 0) without fixing this data-side projection, so a wall-post to
   the admin rendered "Unknown user". Fix: `a.recipientId ?` ->
   `isRealUserId(a.recipientId) ?` at all four sites (import added where needed).
   This was a sibling the R93 horizontal sweep missed (the third round to find an
   id-0 sibling); see the process note below.
2. **`manifest-recompute` docstring overstated the eviction check (concern,
   FIXED).** `src/lib/offline/manifest-recompute.ts` step-2 docstring + module
   header claimed "Drop any prior range whose replies are no longer in the cache".
   The code only drops the manifest when EVERY reply for the discussion is gone
   (`if (surviving.length === 0) delete; return`); there is no per-range
   eviction-drop (eviction is cascade-only). Docstring + header rewritten to
   match the code. No code change.
3. **Import script did not normalize vanilla user id 0 (low, FIXED).**
   `scripts/import-data.ts` `extractProfileUser` returned
   `userId: Number(m[1])` without `normalizeVanillaUserId`, so a vanilla deleted
   user (id 0) attached to the bootstrap admin at all 7 call sites. Fixed to
   `normalizeVanillaUserId(Number(m[1]))`. Horizontal sweep also found the
   inviter parse (`import-shared.ts` `parseProfileHtml`) skipped normalization;
   normalized at the consumer. `bunx tsc -p scripts/tsconfig.json` clean.
4. **Recipient-id filter used `!== SYSTEM_USER_ID` instead of `isRealUserId`
   (very low, FIXED).** `activities.ts:98` and `profile/[userId]/[userSlug]/
+page.server.ts:140` only rejected -1 (System), not -2 (Ghost). Changed to
   `isRealUserId`; the now-unused `SYSTEM_USER_ID` import was dropped.
5. **NavPipelineTabHost `runPassthrough` gate read a possibly-stale reactive
   `activeIndex` (very low, FIXED).** `afterNavigate` can fire before the
   `activeIndex` `$effect` flushes, so the `activeIndex === 0` gate could skip or
   redundantly re-run the passthrough write (data always valid; a missed/extra
   IDB write). Robust fix: both `onMount` and `afterNavigate` now gate on
   `getCurrentTabIndex(page.url.pathname) === 0` (route-derived, not reactive).

## B's findings

1. **Offline manifest used the wrong depth (concern, FIXED).**
   `src/lib/offline/sync-orchestrator.ts` computes
   `requestDepth = refreshNow ? depth : 'firstLast'` (line ~126) but passed
   `depth` (the user's preference, e.g. 'all') into `mergeDepthRangesIntoManifests`
   (line ~272). When `refreshNow === false` the server backfills only firstLast
   but the manifest claimed the user's full depth, so the offline reader showed
   an incomplete thread with no gap indicator. Fix: pass `requestDepth`. Comment
   expanded to explain why.
2. **Misleading `lastAuthor*` field names in the messages DAO (very low, FIXED
   via docstring).** `src/lib/server/db/dao/messages.ts:206-209` returns
   `lastAuthorId/Username/DisplayName/AvatarUrl` populated from `displayUser`
   (the first-joined non-self participant), NOT the last message's author (while
   `lastMessageAt`/`lastMessagePreview` ARE last-message-derived). The blast
   radius spans `MessagesPanel.svelte` (outside this round's file set), so a
   docstring was added clarifying these are the conversation peer for the card
   avatar, not the last message's author.
3. **`buildAvatarUrl` called with a `?? 0` sentinel (very low, FIXED via
   comment).** `messages.ts:210` `displayUser?.userId ?? 0` falls back to id 0
   when `displayUser` is undefined. `buildAvatarUrl` requires a non-null number,
   so `null` cannot be passed; the call is harmless (avatarFileId is also null,
   so it returns null/letter-avatar). A one-line comment documents this; no
   functional change.
4. **Past-state marker in a code comment (very low, FIXED).** `src/app.css` the
   `.gpl-card` comment said "replaces the pane's former `p-3`". Rewritten to the
   current state (the desktop pane supplies no padding; the white card and its
   padding live on `.gpl-card`), no "former/old/previously".
5. **FTS index write outside a transaction (very low, FIXED).** Three write
   paths inserted/updated a row then called the FTS indexer outside a
   transaction, so an FTS failure left the row committed but unsearchable.
   Wrapped each in `locals.db.transaction`, mirroring the sibling parent-activity
   path: `api/activities/comments/+server.ts` (insert + `indexActivity`),
   `messages/[id]/[[page=page]]/+page.server.ts` (insert + `indexMessage`,
   update + `reindexMessage`). Exhaustive sweep of every `index*`/`unindex*`
   call site confirms all production write-path indexes are now inside their
   row transaction; the soft-delete unindex directions are documented harmless
   (the `deletedAt` filter hides stale FTS) and left.

## Horizontal check / process note

The id-0 recipient class leaked a sibling for the third round running (R93 fixed
13 sites but missed the recipient display-name projection; R94 fixed two more
offline/sync sites; R95's A1 is the projection sibling R93's ActivityRow change
exposed). This round's exhaustive sweep (every `recipientId ?` / `userId ?` /
truthy guard / `!== SYSTEM_USER_ID` / `> 0` across `src/`, classified) confirms
the class is now fully closed: the only remaining hits are correct `!= null`
checks, `isRealUserId` sites, or non-user-id numerics. The fixer prompt now
BINDS an independent broad-grep class-wide enumeration (not just the cited
sites), and the orchestrator cross-checks it; this round's two parallel fixers
each produced a classified sweep.

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions src/lib/server/utils   407 pass / 0 fail
$ bunx tsc -p scripts/tsconfig.json   EXIT=0
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.2m)
```

R96 audits this state (open-scoped prompt).
