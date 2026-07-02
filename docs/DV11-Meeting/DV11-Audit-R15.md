# DV11 - Audit Round 15 (FINAL)

5 independent role-less auditors examined `docs/DV11-Plan.md` (v15) under a clean open-ended prompt. Result: **5/5 PASS**. The plan is approved for implementation.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 2     | 4     | has-special-cases |
| 2       | PASS    | 0        | 0     | 3     | clean             |
| 3       | PASS    | 0        | 0     | 3     | clean             |
| 4       | PASS    | 0        | 1     | 2     | has-special-cases |
| 5       | PASS    | 0        | 0     | 3     | clean             |

Result line: **5/5 PASS → plan approved for implementation.**

## Approval summary

The plan unifies `MobileTabPager` onto the single height/scroll abstraction `GesturePageLayout` defines: pager panels become `.scroll-pane[data-preview-tab={labelKey}]` (NOT `.detail-scroll-pane`) under a refcounted `html.fixed-viewport`; per-panel `pageScrollStore` keyed by each panel's own tab href; `scrollChrome.setScrollContainer`/`releaseContainer` for hide-on-scroll; the private `panelHeights`/`neighborOffset`/`viewportHeight` model + a scoped-CSS mirror are deleted; `list-scroll.svelte.ts` is deleted. A `viewport-lock` refcount + `scrollChrome.releaseContainer` coordinate the two route-layouts across the `/`↔`/discussion` SPA swap. The root-layout `beforeNavigate` capture is gated on `!isPagerRoute`.

## Non-blocking items carried to implementation (the auditors' reservations)

- **Auditor 4 MAJOR (mobile reload scroll regression):** the `(tabs)` SvelteKit snapshot is mobile-dead under `fixed-viewport` and `pageScrollStore` is in-memory (no sessionStorage), so a hard reload of `/`, `/activity`, or `/messages/inbox` on mobile lands at top instead of restoring the last scroll. Bounded (mobile-only, tab-route-only, reload-only - NOT SPA nav). The implementation should note this as a known limitation; a follow-up could persist `pageScrollStore` to `sessionStorage`.
- **§5 `releaseContainer` consistency:** the main §5 GPL bullet says `releaseContainer(centerEl)`; the last §5 bullet corrects to `releaseContainer(override ?? centerEl captured at effect-run time)`. The latter is authoritative; the implementer should apply it to BOTH the GPL and the pager cleanups.
- **§4 viewport `flex`:** the plan drops `flex: 1 0 auto` (kept by GPL). The height chain resolves via `app.css:272-279` forcing `height:100%` on the ancestor chain under `fixed-viewport`, so it is safe, but the implementer may keep `flex` for GPL parity.
- **§6.1 forward-case reachability probe** is a no-op on a short dest panel (messages); scope it to the back/tall case (activity).
- **§6.4(a) refcount swap flicker** is empirically arbitrated (the sampler decides; microtask-deferred 1→0 removal if observed). The implementation must RUN §6.4(a) before declaring done.
- **`/`↔`/discussions/pN` boundary** (locked vs window-scroll) is a new discontinuity the plan discloses as out-of-scope.
- **Activity composer `RichTextToolbar` dropdown clipping** by the now-`overflow-y:auto` panel - the same exposure exists on every GPL route's reply editor (the editor lives in `.detail-scroll-pane`), so it is likely not a new regression, but worth an empirical check.

## Convergence trajectory

15 rounds (R1-R15). R1-R3 were steered (§8 audit-points + leading prompts; voided). R4 was the first clean round (caught the deep-path viewport leak). R7 added the shared ownership layer. R9 fixed the per-panel keying (`MOBILE_TABS[N].href`, not `page.url.pathname`). R14 eliminated the `.detail-scroll-pane` marker reuse (the root of the collision tail). R15 fixed the last selector slip. The architecture was endorsed from R7 onward; the remaining rounds were concrete-edit precision.
