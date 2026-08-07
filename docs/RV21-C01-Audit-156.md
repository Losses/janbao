# RV21-C01 Audit 156 (R156)

**Date:** 2026-08-07. **Votes:** A PASS, B BLOCK (2). **Counter: 0/5.**

B found 2 sites attributing strictness solely to updateBackTarget without distinguishing
bidi/forward (via #tabIndexFor directly) from non-bidi backward: orchestrator:3505 (gesture-
release backMorphIsNull) and orchestrator:4847 (backMorphValue inline). Both fixed to R155-B
canonical two-mechanism form. A PASSed the post-fix state. Gates green; 552/0.
**No git mutation.**
