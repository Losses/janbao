# RV20-C05b2 - Audit Round 92

Result: **A FAIL (1 concern + 5 low/very-low); B FAIL (1 concern).** Counter stays
**0/5**. The second OPEN-scoped round. Both auditors independently converged on
one concern (`thread-nav.svelte.ts` is entirely dead); A additionally found five
dead-code and site-name consistency defects cascading from earlier DV20 deletions.
All seven findings were real and are fixed. No false positives this round (every
finding was grep-verifiable dead code or env-consistency drift; no
runtime-visible-behavior claim needed empirical falsification).

## The convergence finding (A + B, FIXED)

**`src/lib/stores/thread-nav.svelte.ts` is entirely dead code (concern, FIXED).**
The module exports two writers (`markEnterFromList`, `setReachedFromList`) and two
readers (`consumeEnterFromList`, `backLandsOnList`). grep across src/e2e/tests/
scripts/docs: the two readers have ZERO callers; the two writers are called only
from `+layout.svelte:137-138` and feed write-only module state nothing reads. The
orchestrator owns swipe-back via `hopForHref`; it does not read these flags. R91
rewrote the module's docstrings to drop `ThreadPager` references but did not
notice the whole module was orphaned by R90's ThreadPager deletion; the rewritten
docstring ("the flag records the navigation's provenance for any consumer that
needs it. Reset on read") is unfalsifiable scaffolding defending dead state. Fix:
deleted the module; removed the import and the dead write block (the
`if (to?.url.pathname.startsWith('/discussion'))` block) from `+layout.svelte`,
keeping the `threadEnter`/`swipeBack` locals and the scroll-chrome block that
follows them; corrected the stale `(NavPipelineHost / thread-nav)` comment in
`history-nav.ts`.

## A's additional findings (all FIXED)

1. **Dead `NavigationStore` members (low, FIXED).** The `activeTab` getter,
   `getTabFromPath`, `getStack`, and `navigateBackward` had zero external callers
   (verified by `navStore\.` grep). The live siblings (`activeStack`, `backTarget`,
   `direction`, `init`, `switchTab`, `handleBeforeNavigate`, `handleAfterNavigate`,
   `navigateForward`) are untouched. `navigateForward` stays (MobileTabBar calls
   it); `navigateBackward` was its dead counterpart. The now-unused
   `getTabFromPath as getTabFromPathLogic` import was removed (the pure
   `getTabFromPath` in `navigation-logic.ts` is still used internally).
   `navigation-logic.test.ts` asserts `s.activeTab` on a plain `NavState`, not the
   store getter, so it stays green.
2. **Dead `BackHandlerDispatcher` (very low, FIXED).** `backHandler.register()`
   had zero callers; `backHandler.dispatch()` was called in `Header.onBack()` but
   `#handlers` was always empty, so dispatch always returned false and `onBack`
   always fell through to the `navStore` logic (an always-no-op indirection).
   Deleted the class, the `backHandler` singleton, and the `BackCallback` type;
   trimmed the Header import and removed the `if (backHandler.dispatch()) return;`
   line. Behavior-preserving (dispatch was a no-op); the back-press e2e paths
   cover the remaining `onBack` logic.
3. **Hardcoded site name in offline page titles (low, FIXED).** `.env` sets
   `PUBLIC_SITE_NAME="火星"`; `getSiteName()` / `formatTitle()` read it, but the
   two offline routes hardcoded "Janbao". `offline/+page.svelte`:
   `<title>Janbao</title>` -> `<title>{getSiteName()}</title>`;
   `offline/[discussionId]/+page.svelte`:
   `<title>{data.discussion?.title ?? 'Janbao'} · Janbao</title>` ->
   `<title>{formatTitle(data.discussion?.title)}</title>` (matches the online
   discussion page's `formatTitle` pattern).
4. **`app.html` apple-mobile-web-app-title (very low, FIXED).** The iOS home-screen
   label meta hardcoded "Janbao". `app.html` cannot read `$env` at build time, so
   `hooks.server.ts` gained `injectSiteName(html)` (exact-string match of the full
   meta attribute with a function replacer, so a site name containing `$` or regex
   metacharacters is inserted verbatim), composed inside `transformPageChunk`
   alongside the existing `injectResolvedTheme`.

## Horizontal check (the site-name sweep)

grep for every "Janbao" literal in title/meta/push surfaces. The manifest
`+server.ts` literal is a correct ultimate fallback after `PUBLIC_SITE_NAME`
(equivalent to `mailer.ts`'s existing pattern); the offline pages, `app.html`,
and the service-worker push fallback are now fixed. The service-worker push
fallback (`payload.title || PUBLIC_SITE_NAME || 'Janbao'`) uses
`$env/static/public` because SvelteKit's Vite plugin forbids
`$env/dynamic/public` in service workers (only `$service-worker`,
`$env/static/public`, `$app/env/public` are permitted); `tsconfig.sw.json` now
includes `.svelte-kit/ambient.d.ts` so the static-env virtual module resolves
under the standalone SW typecheck. `static/offline-fallback.html` (a truly static
last-resort shell with no runtime env) is left as-is. i18n JSON copy ("Welcome to
Janbao" / "欢迎来到 Janbao") embeds "Janbao" as a brand proper noun inside
localized sentences; the i18n loader is property-path access with no interpolation
machinery, so correcting it would require new infrastructure and is a distinct
content/branding concern, not the OS/browser-label defect class. Left as-is and
documented here.

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1456 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.3m)
```

R93 audits this state (open-scoped prompt).
