# RV06 · Round 2 Audit - Offline Reading Subsystem (C02)

Re-audit of DV06 Cycle 2 after the Round 1 fixes, with the carry-over list (incl. the
deferred offline-disable sweep / bookmark-unavailable-offline as a separate C03).
Method: 5 parallel independent full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 2 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: UNCONDITIONAL_PASS (2 LOW observations)
- Agent D: CONDITIONAL_PASS (M1 first-sync tombstone seed; M2 NULL-ordering claim)
- Agent E: CONDITIONAL_PASS (MAJOR-1 tombstone tie-drop; MAJOR-2 merged-clobber)

3/5 unconditional - not advancing. The Round 1 tombstone split was structurally right
but tombstones still lacked the `id` tiebreaker the delta streams already had, and two
client-side LWW/seed gaps remained.

## MAJOR - fixed this round (round 2 -> round 3)

- **Tombstones dropped rows on a same-second `deletedAt` tie at a page boundary**
  (`db/dao/sync.ts`). Tombstones were ordered by `deletedAt` with strict `gt` and no
  tiebreaker; a moderator bulk-delete landing multiple rows in the same wall-clock
  second could have rows after the LIMIT cut silently dropped. Fixed: tombstone
  streams now use the same compound `(deletedAt, id)` cursor + `or(gt, and(eq, gt))`
  predicate as the delta streams. (Agent E.)
- **First sync fetched all tombstones since epoch** (`sync-orchestrator.ts`). The
  orchestrator seeded the tombstone cursors to `0` and always sent them, so the
  server's `?? lookback` fallback never applied - a fresh install paged tombstones
  back to 1970. Fixed: tombstone cursors are now compound strings sent only when a
  stored value exists, so the first sync lets the server apply the 30-day lookback
  like the delta streams. (Agent D.)
- **Read-state conflict reconciliation clobbered a newer local merged row**
  (`offline/read-state.ts`). On a server-reported conflict the client unconditionally
  overwrote the merged row, which could regress a read recorded between batch-send and
  response. Fixed: last-write-wins guard - only overwrite when the local merged row is
  not newer than the server's conflicting position. (Agent E.)

## Investigated, not a defect

- **Offline list NULL ordering vs live (Agent D M2).** SQLite `ORDER BY x DESC` places
  NULLs last; the offline sort's `?? 0` also sorts no-reply threads last. Consistent
  with the live home page. Not a divergence.

## Carry-overs (accepted with rationale - not re-fixed)

- **Online read path can clobber an unflushed offline read (Agent C LOW-1).** The
  online `/discussion/[id]` mark-as-read upserts `lastReadAt` with no `WHERE` guard, so
  a user who reads a thread offline then opens it online before reconnect could have
  the (older) online write win and the later offline flush rejected by its own guard.
  Narrow scenario; the online route is explicitly out of C02 scope (INV-4: untouched);
  the C02 offline subsystem itself is correct. Candidate for a future online-path
  hardening (add a `WHERE lastReadAt <= …` guard there too).
- **`lastReadPage: 1` in conflict reconciliation (Agent C LOW-2).** `ReadStateConflict`
  doesn't carry the server's page; `1` is the only available value. Cosmetic (display
  field). Could add `serverLastReadPage` to the DTO later.
- `applyReadStateDeltas` N sequential queries (perf); offline reader single-page;
  `applied` counter over-count on no-op upsert (telemetry).
- Offline-aware disable sweep + bookmark-unavailable-offline = separate cycle C03.

## Gate (end of round 2, after fixes)

- `bun run check`: exit 0 (1231 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 3: re-audit with the expanded carry-over list; target 5/5 UNCONDITIONAL_PASS.
The tombstone compound-cursor change is the highest-risk item to re-verify.
