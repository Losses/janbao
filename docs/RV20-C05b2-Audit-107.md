# DV20 Cycle 5b2 - Audit 107 (R107)

**Date:** 2026-07-21. **Round:** R107, the fifth spec-scoped round. **Counter after:** 0/5 (auditor A BLOCK; auditor B 429'd and did not complete). **Gate:** green (comment-only fix).

Auditor A voted BLOCK on 1 concern. Auditor B hit an HTTP 429 (account 5-hour cap) and did not return.

## Finding and fix

- **A1 (orchestrator:2606-2608, concern).** The `#cancelAllAnimationEases` docstring claimed "`notifyHeaderState` ... does not end the settle." Inaccurate: `notifyHeaderState` calls `#endSettleEase()` at lines 2741 (awaitTitle-clear) and 2795 (mid-settle revert). The `#armSettleEase` docstring at line 2268 already correctly attributes the awaitTitle-clear to "the title-change watcher" (= `notifyHeaderState`), making the file internally contradictory. Also the supersede branch at line 1905 (`#endSettleEase`) was missing from the enumeration. Fixed: added the supersede branch + `notifyHeaderState`'s two `#endSettleEase` call sites to the enumeration; reworded the parenthetical to "`notifyHeaderState` also finishes an in-flight tap-scrub."

check + lint green.
