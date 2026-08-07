# RV21-C01 Audit 154 (R154)

**Date:** 2026-08-07. **Votes:** A BLOCK (4), B BLOCK (5). **Counter: 0/5.**

A found 4 orchestrator docstrings still using the R142 "loose for non-bidi backward" framing that
R153-B contradicted (updateBackTarget overwrites inputs.toTabIndex to strict before any gesture).
Fixed all 4 to "strict (updateBackTarget overwrites inputs.toTabIndex before any gesture)." B found
em dash in journal (fixed) + 4 "tab-root source" sites in targetIsSearch destMorph docstrings
(R152 sibling miss -- atRestMorph uses loose hasTabs). Fixed: "tab-root source" -> "source with
tabs." Gates green; 552/0. **No git mutation.**
