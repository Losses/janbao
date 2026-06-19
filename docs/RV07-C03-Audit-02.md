# RV07 C03 Audit - Round 2

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff 340fa13..HEAD` (commits c462dcc + e5faa25). Round 1 was 4/5; cleanups
shipped in `e5faa25`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → C03 advances.

| Agent | Start file                       | Verdict            |
| ----- | -------------------------------- | ------------------ |
| 1     | pwa-install.svelte.ts            | UNCONDITIONAL_PASS |
| 2     | +page.server.ts + +page.svelte   | UNCONDITIONAL_PASS |
| 3     | i18n (skeptic)                   | UNCONDITIONAL_PASS |
| 4     | integration skeptic              | UNCONDITIONAL_PASS |
| 5     | offline-prefs.svelte.ts + layout | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test` 34/34. Working tree clean (an unrelated `search/+page.svelte` stray,
reverted pre-audit).

## Round-1 cleanups confirmed correct (all 5 agents)

- **HMR dispose** (`pwa-install.svelte.ts:138-147`): `BoundListeners` stores the
  exact handler refs passed to `addEventListener`; `import.meta.hot?.dispose`
  removes them via the same refs (no "fresh arrow" no-op) and resets
  `listenersBound`. `import.meta.hot` guarded → prod no-op. Matches `idb.ts`.
- **Dead marker removed:** `+page.server.ts` returns `{}`; page reads inherited
  `data.t`/`data.user` from root layout (SvelteKit merges, doesn't shadow).
- **`'synced'` wired:** `triggerSyncIfOnline` `.then` sets `{kind:'synced'}` only
  on success; skipped-sync (offline/disabled) early-returns silently; `.catch`
  surfaces errors (no silent swallow, no unhandled rejection). New
  `profile.offlineReading.synced` key in en + zh-CN.

## Carry-overs (informational, non-blocking)

- **CO-C03-1** `prefs` getter returns the live `$state` ref (readonly at property
  level only). Page reads via `$derived` only → safe; a `readonly()` wrapper could
  enforce it later.
- **CO-C03-2** `beforeinstallprompt` event dismissed-without-prompt stays stashed
  until consumed. No install button rendered yet (C03); revisit when an affordance
  surfaces.

## Confirmed correct (all 5)

- **Decision #5 (guests):** `+page.server.ts` redirects unauthed to signin; no
  client path reaches the form.
- **Auto-enable:** `onMount` (not `$effect`); idempotent guard
  `janbao:offline-autoenabled`; fires only when `isInstalled && prefs===DEFAULT &&
guard unset`; never overrides a manual choice; race-safe across tabs.
- **PWA detection:** `matchMedia('(display-mode: standalone)')` || iOS
  `navigator.standalone`; SSR/browser-guarded; seeds synchronously before layout
  reads (already-installed-at-first-load works).
- **Reactive stores:** singleton pattern; SSR-safe lazy hydration; `update`/`reset`
  persist + update `$state`.
- **UI:** all 5 controls; `<fieldset disabled={!enabled}>`; flat design; bindings
  via `update()` (no direct localStorage).
- **i18n:** 32-key parity en↔zh-CN under `profile.offlineReading.*`; no collision
  with top-level `offline`; `t` required prop, property-path access, no English
  fallbacks ([[i18n-access-convention]]).
- **Types** (named interfaces incl. `BoundListeners`, handler aliases); no inline
  typing; no `$effect` loops; INV-4 preserved (C03 adds no server writes).

C03 complete. Advancing to C04 (read passthrough + gap rendering).
