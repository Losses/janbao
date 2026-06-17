# DV06 C01 Journal - Installable PWA Shell Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Pre-audit dev notes

Built the installable shell:

- `static/manifest.webmanifest` (name/short_name, standalone, `theme_color #ffb257`,
  `background_color #ffffff`, 192/512 `any` + `maskable` icons, scope/start_url `/`).
- `static/icons/*` sourced from IconKitchen (`web/` set) - NOT generated. Favicon
  kept as the existing `src/lib/assets/favicon.svg`.
- `static/offline.html` - bilingual (en + zh-CN) via an inline dictionary picked at
  runtime from `navigator.language`; auto-reloads on `online`.
- `src/service-worker.ts` - SvelteKit `$service-worker` convention: precache
  `build` + `files` (per-asset puts so one missing file can't reject install),
  network-first navigation (~3s, aborted) -> cached doc -> cached shell `/` ->
  `/offline.html`, cache-first assets, `/api/*` and cross-origin never cached.
- `src/app.html` - manifest link, theme-color, apple-touch-icon + iOS meta.
- `src/routes/+layout.svelte` - prod-only SW registration + reactive online/offline
  banner (i18n `offline.*`).

Dev-time catches before the audit:

- The first `build` failed: `$service-worker` in this SvelteKit version does not
  export `skipWaiting`/`clientsClaim` (removed in Kit 2). Switched to `self.skipWaiting()`
  / `self.clients.claim()`.
- The SW needed explicit typing: under the project's DOM-lib tsconfig the global
  `self` is `Window`, so `declare const self: ServiceWorkerGlobalScope` (module-scope
  shadow) pins the SW scope for both the editor and the build. No banned casts.

## Round 1

- 5 agents. Verdict: 3/5 UNCONDITIONAL_PASS (B, C, D), 2/5 PASS_WITH_NOTES (A, E).
  Unanimous that two MAJORs blocked unconditional pass.
- MAJOR (fixed): `handleNavigate` cached non-OK (4xx/5xx) responses, which could
  poison the offline cache (a transient 500 on `/` especially) - now guarded with
  `network.ok && network.type === 'basic'` and awaited.
- MAJOR (fixed): offline banner was `fixed top-0 z-50`, overlaying the `z-40` sticky
  header and making nav unclickable while offline - now in normal document flow.
- MAJOR (fixed): the service worker was excluded from `bun run check` by SvelteKit's
  generated tsconfig, so the "check passes" claim was vacuous for the SW. Added
  `tsconfig.sw.json` (webworker lib, SW-only) + `check:sw`, chained into `check`.
- MINOR (fixed): `withTimeout` -> `fetchWithTimeout` with `AbortController` (actually
  cancels the fetch on timeout); half-width comma in zh-CN hint; `cache.put` awaited.
- Carry-overs documented: splash palette, `navigator.language` vs user-pref locale,
  authenticated-HTML caching (C02 refines), title localization, maskable safe-zone,
  no manifest `id`, generic categories, single theme-color.
- Gate: check 0/0 (now incl. SW gate), lint exit 0, build exit 0. See
  RV06-C01-Audit-01.md.
- Advancing to round 2 targeting 5/5 UNCONDITIONAL_PASS.

## Round 2

- 5 agents with the carry-over list. Verdict: **5/5 UNCONDITIONAL_PASS**.
- All round-1 fixes verified. One agent proved the SW type-gate is load-bearing by
  deleting `declare const self: ServiceWorkerGlobalScope` and confirming
  `tsc -p tsconfig.sw.json` exits 2 (five errors) - and that the same declare also
  protects svelte-check's DOM-lib view of the SW.
- No new findings, no regressions. Carry-overs respected (none upgraded).
- Gate: check 0/0 (incl. SW gate), lint exit 0, build exit 0. See RV06-C01-Audit-02.md.
- **DV06 C01 COMPLETE 2026-06-17** - closed in 2 rounds (~10 sub-agent audits).
  Advances to C02 (offline reading subsystem).
