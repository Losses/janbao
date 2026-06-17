# RV06 · Round 2 Audit - Installable PWA Shell (C01)

Re-audit of DV06 Cycle 1 after the Round 1 fixes, with the accepted carry-over list.
Method: 5 parallel independent full-audit agents (no roles), per [[dv04-audit-loop]].
Plan: DV06-Plan.md. Round 1 report: RV06-C01-Audit-01.md.

## Round 2 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: UNCONDITIONAL_PASS
- Agent D: UNCONDITIONAL_PASS
- Agent E: UNCONDITIONAL_PASS

**5/5 UNCONDITIONAL_PASS.**

## Round 1 fixes - verified by all agents

- `handleNavigate` cache guard (`network.ok && network.type === 'basic'`, awaited) -
  non-OK / opaque navigations no longer poison the cache. Confirmed correct,
  body-safe (`clone()` before put).
- Offline banner now in normal document flow (`w-full`, no `fixed`/`z-50`) - sits
  above the per-page `DualColumnLayout` header and pushes content down instead of
  overlaying; header stays clickable. Verified consistent across all 31 page routes
  (every page renders into a column layout).
- SW type-gate: `tsconfig.sw.json` (webworker lib, SW-only) + `check:sw` chained into
  `bun run check`. One agent empirically deleted `declare const self:
ServiceWorkerGlobalScope` and confirmed `tsc -p tsconfig.sw.json` exits 2 with five
  errors - the gate is load-bearing, not decorative. The `declare` is doubly necessary:
  it also covers svelte-check's DOM-lib view of the SW.
- `fetchWithTimeout` with `AbortController` - the fetch is actually cancelled on
  timeout; `clearTimeout` in `finally` is idempotent; the abort propagates to
  `handleNavigate`'s catch (cache fallback) correctly.
- zh-CN full-width comma confirmed.

## New findings

None. No regressions, no new CRITICAL/MAJOR/MINOR.

## Carry-overs - unchanged from Round 1

Splash palette; `offline.html` `navigator.language` vs server locale; authenticated
same-origin HTML caching (C02 refines); offline title not localized; maskable
safe-zone (asset, visual check); no manifest `id`; generic `categories`; single
theme-color. All accepted with rationale in RV06-C01-Audit-01.md; not re-reported.

## Gate (end of round 2)

- `bun run check`: exit 0 (svelte-check 1208 files 0/0 + `tsc -p tsconfig.sw.json` 0).
- `bun run lint`: exit 0.
- `bun run build`: exit 0; service-worker.js emitted.

## Outcome

**DV06 C01 COMPLETE 2026-06-17** - closed in 2 rounds (~10 sub-agent audits).
Installable shell is release-ready: manifest, icons, SW app-shell, offline fallback,
SW type-gate, i18n offline banner - all working on both Cloudflare (adapter-auto) and
Bun/adapter-node. Advances to C02 (offline reading subsystem).
