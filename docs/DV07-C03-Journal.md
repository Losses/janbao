# DV07 C03 Journal - Settings UI + Install Gating

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: `docs/DV07-Plan.md`. Built on
C02 (`docs/DV07-C02-Journal.md`, client sync + reasons + eviction COMPLETE
5/5). **C03 base commit: `340fa13ab4823c21a0fd141041e63b9d2a12f080`.**

## Pre-audit dev notes

- **Reactive prefs store** `src/lib/stores/offline-prefs.svelte.ts`: singleton
  wrapper over the pure `src/lib/offline/prefs.ts` layer, matching the
  `online.svelte.ts` pattern (module-level `$state`, getter-based API).
  - `state` held as `OfflinePrefs | undefined` and hydrated lazily on first
    `prefs` read via `ensureHydrated()`, NOT at module load - SSR imports pay
    no localStorage cost.
  - API: `{ readonly prefs, update(partial: Partial<OfflinePrefs>), reset() }`.
    `update` shallow-merges top-level fields with a deep merge for the
    `categories` sub-object (so the page can flip one category without
    restating the others), persists to localStorage, and updates `$state` in
    the same call.
- **PWA install store** `src/lib/stores/pwa-install.svelte.ts`: singleton
  matching `online.svelte.ts`. `isInstalled` computed from
  `window.matchMedia('(display-mode: standalone)').matches` OR iOS Safari's
  `navigator.standalone` (read via a structural cast `Navigator &
NavigatorStandalone` - NOT `as any`, which is banned). Listeners
  (`appinstalled`, `beforeinstallprompt`, the `display-mode` media query) bind
  on first `getPwaInstallStore()` call from a browser, seeded from the live
  environment so an already-installed launch reports `true` immediately.
  - `canPrompt` / `promptInstall()` expose the stashed `beforeinstallprompt`
    event for a future "Add to Home Screen" button (not rendered in C03). The
    Chromium-only event is structurally typed
    (`BeforeInstallPromptEvent`) and validated at attach time
    (`typeof evt.prompt === 'function' && evt.userChoice instanceof Promise`)
    so a non-Chromium browser simply leaves `canPrompt` false.
- **Settings route** `src/routes/profile/offlineReading/`:
  - `+page.server.ts`: auth-gated load (decision #5). Guests are redirected to
    `/entry/signin?redirectTo=/profile/offlineReading`. Returns a minimal
    `{ section: 'offlineReading' }` marker - the prefs themselves are
    client-side (decision #1), and `t` / `user` / `lang` flow in from the root
    layout server load like every other `/profile/*` route.
  - `+page.svelte`: flat-design form (`space-y-*`, `bg-base-200/50
rounded-box`, DaisyUI checkboxes/toggles/radios/select). Master **enable**
    toggle wraps the rest in `<fieldset disabled={!enabled}>`. Three category
    checkboxes (latest / mostViewed / mostReplied), reply-depth radio
    (first / firstLast / all), refresh-interval select (1/2/3/5/7 days),
    read-passthrough toggle (default on). Shows a per-device note when not
    installed and an "installed" hint when `pwa.isInstalled`.
- **Sidebar** `src/lib/components/molecules/SettingsSidebar.svelte`: new entry
  `activeItem="offlineReading"` linking to `/profile/offlineReading`, using the
  `profileT.offlineReadingNav` i18n key (kept separate from the
  `profile.offlineReading` object so the sidebar nav string and the nested
  page-string bundle do not collide at the same JSON path).
- **Auto-enable-on-install** in `src/routes/+layout.svelte` `onMount`
  (`maybeAutoEnableOnInstall()`):
  - Fires only when `pwa.isInstalled` is true AND a one-time guard flag
    (`janbao:offline-autoenabled`) is unset AND the stored prefs are
    byte-for-byte equal to `DEFAULT_OFFLINE_PREFS` (compared field-by-field
    including each category toggle). Only then does it `update({ enabled:
true })` and set the guard.
  - **Idempotent**: the guard is written on the same pass as the pref update,
    so subsequent launches short-circuit on the guard before the prefs
    comparison runs.
  - **Respects manual choice**: a user who has ever toggled any field has a
    non-default prefs object; the hook sets the guard and bails without
    enabling, permanently sealing the auto-enable window for that device.
  - **No `$effect` loop** ([[svelte-effect-fetch-loop]]): the hook runs in
    `onMount`, not a reactive effect, so it never re-fires on tracked-state
    changes.
- **Optional nicety** (deliverable #6): the page calls `runSync()` (dynamic
  import from `$lib/offline/sync-orchestrator`) after any pref change that
  could add cache content (enable toggle, category toggle, depth change), and
  on `onMount` when landing on the page with caching already on. Guarded by
  `prefs.enabled && typeof navigator !== 'undefined' && navigator.onLine`.
  The orchestrator's core logic is untouched - only the public `runSync()`
  entry is called.
- **i18n** ([[i18n-duplicate-key-check]]): grepped first - the top-level
  `offline` key (reader messages) exists but does NOT collide with
  `profile.offlineReading.*`. Added `profile.offlineReadingNav` (sidebar
  string) + `profile.offlineReading` (nested object: title, description,
  per-device note, installed hint, enable labels, category labels+descs,
  depth labels, refresh labels, passthrough label+desc, reset label+done
  message) to BOTH `en.json` and `zh-CN.json`. `TranslationDict` is inferred
  from `en.json` via `typeof en`, so the nested object is typed end-to-end
  without a manual interface.

## Invariants preserved

- **Decision #1 (prefs local)**: no DB columns, no API writes for prefs. The
  store reads/writes localStorage only.
- **Decision #5 (auth-only)**: guests redirect at the server load; the page
  is unreachable without a session.
- **INV-4 (no false read)**: C03 adds no server write paths. The optional
  nicety calls the existing pure-read `runSync()` (which itself issues only
  `GET /api/sync/content` + the existing read-state outbox flush).
- **No `$effect` loops** ([[svelte-effect-fetch-loop]]): auto-enable lives in
  `onMount`; the page's sync nicety is fired from explicit user-event
  handlers and a one-shot `onMount`, never a bare reactive effect.
- **Type rules (zero tolerance)**: all component props and store APIs are
  named interfaces; `interface` over `type` for object shapes; no inline
  object/function type literals (extracted `OfflineFormMessage`,
  `PromptInstallFn`, `PromptFn`, `InstallPromptOutcome`,
  `InstallPromptUserChoice`, `BeforeInstallPromptEvent`,
  `NavigatorStandalone`, `DeferredPrompt`).
- **Svelte 5 runes only**: `$state` / `$derived` / `$props` throughout; no
  stores / `getContext` for the new state.

## Gates

- `bun run check`: 0 errors / 0 warnings / 1269 files.
- `bun run lint`: exit 0 (prettier clean, eslint clean, similarity-ts
  type-dupes 0 - 25 informational pairs, all pre-existing).
- `bun test`: 34/34 pass (no behavior change; manifest pure-function tests
  unaffected).

Round 1 pending.
