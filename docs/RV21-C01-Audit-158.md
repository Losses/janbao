# RV21-C01 Audit 158 (R158)

**Date:** 2026-08-08. **Votes:** A (pending), B BLOCK (1). **Counter: 0/5.**

B found orchestrator:4826 "not a tab root" in holdPillAtFromIdx branch -- the actual condition is
`targetIsDeepPage = tag !== 'tab'` (tag-based), not `!isTabRootPath` (strict). These diverge for
/offline (tag='tab' but not a tab root). Fixed: "not a tab root" -> "not a tab" to match the
headline and the actual tag check. A pending (429 retry).
