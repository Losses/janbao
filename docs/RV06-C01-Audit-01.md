# RV06 · Round 1 Audit - Installable PWA Shell (C01)

Scope: full audit of DV06 Cycle 1 (installable PWA shell) - manifest, offline.html,
icons, `src/service-worker.ts`, `app.html` meta, SW registration + offline banner in
`+layout.svelte`, and the `offline.*` i18n keys. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Round 1 verdicts (5 independent full-audit agents)

- Agent A: PASS_WITH_NOTES
- Agent B: UNCONDITIONAL_PASS
- Agent C: UNCONDITIONAL_PASS
- Agent D: UNCONDITIONAL_PASS
- Agent E: PASS_WITH_NOTES

3/5 unconditional - not advancing. Strong consensus on the two MAJOR items below.

## MAJOR - fixed this round

- **`handleNavigate` cached non-OK navigation responses (`src/service-worker.ts`).**
  `withTimeout(fetch(...))` resolves on any HTTP status, then `cache.put` ran
  unconditionally - a transient 404 (deleted discussion) or 500 would be cached and
  served offline forever; a 500 on `/` would poison the app shell. Fixed: guard
  `cache.put` with `if (network.ok && network.type === 'basic')` and `await` it.
  (Agents E, C, D.)
- **Offline banner overlapped the app chrome (`src/routes/+layout.svelte`).** The
  banner was `fixed inset-x-0 top-0 z-50`, but the site header (in
  `DualColumnLayout.svelte`) is `sticky top-0 z-40` - so while offline the banner
  sat on top of the logo/nav/sign-in, making the header unclickable for the whole
  session. Fixed: banner is now in normal document flow (`w-full`, no fixed/z-50),
  so it renders above the header and pushes content down instead of overlaying.
  (Agent A.)
- **Service worker was not type-checked by `bun run check`.** SvelteKit's generated
  `tsconfig.json` intentionally excludes `src/service-worker.*` (the SW uses the
  webworker lib via its own triple-slash refs), so the earlier "check passes for the
  SW" was vacuous - the file was never in the program. Fixed: added a focused
  `tsconfig.sw.json` (webworker lib, SW only) and a `check:sw` step, and chained it
  into `bun run check`. The SW is now genuinely type-gated. (Agents B, E.)

## MINOR - fixed this round

- **`withTimeout` did not cancel the fetch (`src/service-worker.ts`).** On timeout
  the wrapper rejected (navigation correctly fell to cache) but the underlying fetch
  kept running. Replaced with `fetchWithTimeout` using `AbortController` so the
  network request is actually cancelled. (Agent B.)
- **Half-width comma in zh-CN offline hint (`src/lib/i18n/zh-CN.json`).** `不,` ->
  full-width `，`. (Agent C.)
- **`cache.put` was fire-and-forget in `handleNavigate`.** Now awaited inside the
  same guard. (Agent E.)

## Carry-overs (accepted with rationale - not re-fixed)

- **Splash palette is three-toned.** `background_color #ffffff` (white splash) +
  black-bg icons + `theme_color #ffb257`. Icons are valid; the mismatch is a brand
  choice, not a PWA defect. Visual polish for a future pass. (Agent D.)
- **`offline.html` locale uses `navigator.language`, not the app's user preference.**
  The standalone fallback page has no access to the server-resolved locale; it picks
  zh-CN vs en from the browser language. Documented in the page; acceptable for a
  fallback. (Agents C, D.)
- **`handleNavigate` caches authenticated same-origin HTML** (e.g. `/discussion/[id]`
  for a logged-in user). Origin-scoped Cache Storage keeps this private to the user's
  own profile (no cross-user leak); C02's offline-reader routing will refine this.
  (Agents A, C.)
- **`offline.html` `<title>` is "Janbao" in both locales** (not localized to the
  offline state). Cosmetic. (Agent A.)
- **Maskable safe-zone not visually verified** (IconKitchen binary asset, outside
  code scope). Spot-check before launch. (Agent B.)
- **No `id` field in manifest / generic `categories`.** Optional per spec; single-
  domain deployment. (Agents B, D.)
- **Single-valued `theme-color` meta** (no `prefers-color-scheme: dark` variant). The
  `huoxin` theme is light-only today. (Agent E.)

## Gate (end of round 1, after fixes)

- `bun run check`: exit 0 - svelte-check 1208 files 0 errors/0 warnings, plus the
  new `tsc -p tsconfig.sw.json` SW gate (exit 0).
- `bun run lint`: exit 0.
- `bun run build`: exit 0; `.svelte-kit/output/client/service-worker.js` emitted
  (4.50 kB).

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS.
