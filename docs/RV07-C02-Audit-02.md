# RV07 C02 Audit - Round 2

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff 4b03112..HEAD` (commits b03c0f1 + 340fa13). Round 1 was 2/5; fixes
shipped in `340fa13`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → C02 advances.

| Agent | Start file            | Verdict            |
| ----- | --------------------- | ------------------ |
| 1     | evict.ts              | UNCONDITIONAL_PASS |
| 2     | sync-orchestrator.ts  | UNCONDITIONAL_PASS |
| 3     | manifest.ts (skeptic) | UNCONDITIONAL_PASS |
| 4     | integration skeptic   | UNCONDITIONAL_PASS |
| 5     | types.ts + idb.ts     | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test` 34/34 (manifest 12 + carry-over 22).

## Round-1 fixes confirmed correct (all 5 agents)

- **[CRITICAL→fixed] Eviction transaction** (`evict.ts:69-86`) now lists every
  store the body touches — `discussions, replies, readStateMerged,
replyCacheManifest`. The cascade (discussion → replies → readStateMerged →
  manifest) commits atomically; the Dexie _Table not part of transaction_
  rollback is gone. `readStatePending` deliberately omitted (outbox survives).
- **[MAJOR→fixed] front/bookmark prior** (`sync-orchestrator.ts:117-122`):
  `PriorFrontBookmark` captured once at `doSync` start (before the page loop
  overwrites the snapshots) and threaded into `applyReasonSets`; the remove-delta
  now correctly strips `front`/`bookmark` from lapsed rows while preserving other
  reasons (`read`, other curated). First-ever sync (no prior) → empty remove-set,
  no crash. `curated:*` prior-mirror pattern confirmed still correct.
- **[MINOR→fixed] `computeCachedRanges` cap** (`manifest.ts:74`): gates the `all`
  -depth split on real `commentCount` (not `totalPages*pageSize`); phantom split
  near the 1000 boundary eliminated. Boundary tests pin 951/999 → complete,
  1001 → split. All callers updated.
- Journal wording corrected: `!enabled` SERVER REQUEST is DV06 byte-identical, but
  the client does make additive IDB writes (manifest rows, curated/front/bookmark
  reasons) — these don't alter observable DV06 read behavior (new store read only
  by the new `replyGaps` path, which falls back to `EMPTY_GAPS`).

## Carry-overs (informational, non-blocking)

- **CO-C02-1** `populateReplyManifests` covers curated∪front∪bookmark only; a
  `'read'`-only row (C04 passthrough) lacks a manifest until it re-enters a
  curated set. **C04** must write the manifest on passthrough.
- **CO-C02-2** `REPLY_CAP`/`REPLY_CAP_HALF` duplicated client (`manifest.ts`) vs
  server (`db/dao/sync.ts`). Dedupe into a shared `$lib` module when convenient.
- **CO-C02-3** `applyEviction` reads 4 syncMeta keys outside the txn (read-only
  pre-pass; txn only writes the 4 listed stores) — acceptable; flagged for
  awareness.

## Confirmed correct (all 5)

- `!enabled` = DV06 server request; additive writes don't diverge observable state.
- IDB v3→v4 additive; `reasons`/`readUpdatedAt` optional → in-place upgrade.
- Reason union/removal; `read` never touched by orchestrator.
- Manifest math all depths + 1000 boundary; manifest rewritten on depth change;
  dangling manifest cleared on eviction.
- `readStatePending` never deleted; pre-v4 rows fall back to DV06 retention.
- Types (named interfaces); no `$effect`; INV-4 preserved.

C02 complete. Advancing to C03 (settings UI + install gating).
