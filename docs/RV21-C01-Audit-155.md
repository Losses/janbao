# RV21-C01 Audit 155 (R155)

**Date:** 2026-08-07. **Votes:** A BLOCK (2), B BLOCK (1). **Counter: 0/5.**

A found 2 R154 sibling misses: orchestrator:4846 still "loose pill-map for non-bidi backward" (sed
miss), Header:170 still "tab-root source" (sed miss). Both fixed. B found orchestrator:4774 R154
sed introduced "(both strict via updateBackTarget)" -- wrong for bidi/forward (those use
`#tabIndexFor(to)` directly). Fixed to "strict for bidi/forward (via #tabIndexFor) and for
non-bidi backward (via updateBackTarget's overwrite)." Gates green; 552/0. **No git mutation.**
