# RV07 C03 Audit - Round 1

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff 340fa13..HEAD` (commit c462dcc). Plan: `docs/DV07-Plan.md`.
See [[dv04-audit-loop]].

## Verdict

**4/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES** → fix and re-audit.

| Agent | Start file                     | Verdict            |
| ----- | ------------------------------ | ------------------ |
| 1     | offline-prefs.svelte.ts        | UNCONDITIONAL_PASS |
| 2     | pwa-install.svelte.ts + layout | PASS_WITH_NOTES    |
| 3     | +page.svelte + +page.server.ts | UNCONDITIONAL_PASS |
| 4     | integration skeptic            | UNCONDITIONAL_PASS |
| 5     | i18n + sidebar                 | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test` 34/34.

## Findings (all minor; round-2 cleanup)

- **[A2] `pwa-install.svelte.ts` listeners have no HMR cleanup.** `bindListenersOnce`
  attaches `appinstalled`/`beforeinstallprompt`/media-query listeners with no removal.
  The `listenersBound` flag prevents duplicate binding within one module lifetime,
  but a stale module on HMR could double-bind. Fix: add `import.meta.hot?.dispose`
  cleanup matching the `idb.ts` HMR pattern. Low impact (dev-only; SW is prod-only).
- **[A2] dead `section` marker.** `+page.server.ts` returns `{ section:
'offlineReading' }` but the page never reads it. Remove it (return minimal/empty;
  SvelteKit allows `{}`).
- **[A3] dead `'synced'` union member.** `OfflineFormMessageKind` includes `'synced'`
  but nothing sets it. Rather than delete, wire it: show a "cache synced" message on
  successful `triggerSyncIfOnline` (real UX feedback).
- **[A1, informational]** `prefs` getter returns the live `$state` ref (readonly only
  at property level); the page reads via `$derived` only, so safe. Log as carry-over
  **CO-C03-1**; a `readonly()` wrapper could enforce it later.
- **[A4, by-design]** guest on an installed PWA auto-writes `enabled:true` to
  localStorage but the sync API 401s for guests → no-op. Acceptable per decision #1
  (per-device localStorage). No action.

## Confirmed correct (all 5)

- **Decision #5 (guests):** `+page.server.ts` redirects unauthed to signin; no
  client path reaches the form.
- **Reactive stores:** singleton pattern matching `online.svelte.ts`; SSR-safe lazy
  hydration (no localStorage at module load); `update`/`reset` persist + update
  `$state`.
- **Auto-enable:** `onMount` (not a bare `$effect`); idempotent guard flag; fires
  only when `isInstalled && prefs===DEFAULT && guard unset`; never overrides a manual
  choice (non-default prefs seals the window). Race-safe across tabs.
- **PWA detection:** `matchMedia('(display-mode: standalone)')` || iOS
  `navigator.standalone`; SSR/browser-guarded; already-installed-at-first-load works
  (seeds synchronously before layout reads).
- **UI:** all 5 controls; `<fieldset disabled={!enabled}>`; flat design consistent
  with `preferences`/`onlineNow`; bindings via `update()` (no direct localStorage).
- **i18n:** 31/32 keys parity en↔zh-CN under `profile.offlineReading.*`; no collision
  with top-level `offline`; `t` is a required prop, property-path access, no English
  fallbacks ([[i18n-access-convention]]). Sidebar wired.
- **Type rules** (named interfaces incl. `BeforeInstallPromptEvent`,
  `NavigatorStandalone`); no inline typing; no `$effect` loops; INV-4 preserved
  (C03 adds no server writes).

Advancing to round 2 with the 3 cleanups.
