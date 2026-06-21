# DV07 C06 Journal - Full-System Integration Audit

Method: 5 parallel independent full-audit agents (no roles), each auditing the
ENTIRE DV07 change (`git diff 0a2d9cc..HEAD`) with a distinct cross-subsystem
lens. Per [[dv04-audit-loop]] / the DV06 post-complete lesson (per-cycle audits
missed cross-subsystem sync-data-coverage gaps). Plan: `docs/DV07-Plan.md`.

C06 is audit-only (no dev): it gates DV07 completion on a full-system 5/5.

## Round 1

- 5 agents, full-system, lenses: data-coverage/ghost-rows · reason+manifest
  lifecycle · INV-4/auth-guest/offline-UX · invariants/DV06/IDB/reactivity ·
  gates/types/carry-overs/build.
- Verdict: **3/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES, 1/5 CONDITIONAL**.
- **[MAJOR, A3] Decision #5 violation:** `runPassthrough` on the PUBLIC routes `/`
  - `/discussions` gated only on prefs, not the authed session → a guest on an
    installed PWA (auto-enabled) populated the cache from public list pages.
    Exactly the cross-subsystem gap per-cycle audits missed (the list pages were
    audited in C04 for INV-4/$effect, but the guest-leak spans the C03 auto-enable
    ↔ C04 passthrough ↔ public-route boundary).
- **[MINOR, A1]** list-only ghost row (`writeList` caches metadata but no replies
  → `/offline/[id]` generic "empty"); **[MINOR, A1]** `/offline` list sort missing
  `id` tiebreaker.
- Gates green; 14 carry-overs triaged accept/block = 14/0. See
  `RV07-C06-Audit-01.md`.

## Round 2

- 5 agents. Verdict: **5/5 UNCONDITIONAL_PASS**.
- Fixes shipped in `de6d1bc`:
  - **Guest gate** centralized: `passthroughEnabledFor(user)` (the ONE enforcement
    point) gates all 5 passthrough callers + `triggerSync`; guest end-state fully
    inert (stale `enabled:true` in localStorage does nothing - writers skip, sync
    API 401s). Authed passthrough preserved.
  - **Honest list-only state:** `listingOnly` reader branch + `offline.reader.
listingOnly` i18n (en + zh-CN); no-row case keeps `notCached`.
  - **Sort tiebreaker:** `/offline` list ends in `id`.
- Re-hunt found no remaining cross-subsystem defect; all prior round-1 bug classes
  across C01–C05 confirmed closed (computeTotalPages / REASON_ORDER /
  readUpdatedAt-units consistency; no ghost rows; permissions scoped; eviction
  txn integrity; readStatePending safe). See `RV07-C06-Audit-02.md`.

**C06 COMPLETE 5/5. DV07 COMPLETE - all six cycles 5/5.**

## Post-complete notes

- All 6 cycles (C01–C06) closed 5/5 UNCONDITIONAL_PASS; ~11 audit rounds, ~55
  sub-agent audits. The audit loop caught 3 real cross-file/cross-subsystem bugs
  that per-file tests missed: C02 (Dexie txn missing `replyCacheManifest` +
  front/bookmark prior-snapshot), C04 (over-report page 1 + renderer divider
  placement), C05 (`readUpdatedAt` ms/seconds unit → dead TTL), C06 (Decision #5
  guest-cache leak). The unit-mismatch + guest-leak classes in particular would
  have shipped silently without the integration audit.
- 14 carry-overs logged across cycles - all perf/hygiene follow-ups with
  mitigations; none blocks DV07.
