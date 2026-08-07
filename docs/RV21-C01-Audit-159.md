# RV21-C01 Audit 159 (R159)

**Date:** 2026-08-08. **Votes:** A PASS, B PASS. **Counter: 1/5.**

## Outcome

First double-PASS since R148 (which was 2/5 before R149 reset). Both auditors did exhaustive
sweeps (A 123 tool uses, B 120) and found zero defects. The layer is genuinely clean across
all neighborhoods after R119-R158's ~170 defect fixes.

## A's clean PASS

Re-derived publication rule against every reachable drag shape. Verified all canonical forms:
mechanism attribution (bidi/forward via `#tabIndexFor` directly, non-bidi backward via
`updateBackTarget`), RAW criterion ("not both endpoints resolve to a tab"), null-condition
("non-centerTab tab-to-tab"), icon-value ("route with tabs"), atRestMorph ("target/
destination/source with tabs"), resolver types ("has no tab association"), bidi backward RAW
parentheticals ("deep page, thread/compose, or `/search`"). R137 F1 + R142 F2 correctness
fixes sound at both call sites. Gates green; 552/0.

## B's clean PASS

Verified R137/R142 correctness at both call sites. Full sibling search for every lexical
neighborhood (`tab root`, `tab-root`, `loose`, `strict`, `pill-map`, `tab-to-tab`,
`updateBackTarget`, `#tabIndexFor`, `#gestureToTabIndex`). All "non-tab-root" sites verified
as describing `#tabIndexFor`/`isTabRootPath` directly (correct strict framing). No em-dashes,
no past-state markers, no dead code, no §5 violations. All R158 fixes accurate.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0; prettier clean;
no U+2014 em-dash. No code change this round.

## Disposition

Counter after R159: **1/5**. Four more consecutive double-PASSes needed (R160-R163) to close
at 5/5.

**No git mutation.** No commits, no branches, no pushes.
