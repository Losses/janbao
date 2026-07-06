# DV20 Cycle Manager Protocol v2 (from Cycle 1 lessons)

## Cycle 1 failure summary

Cycle 1 went through 14 audit rounds. The code was correct from R6 on (unanimous across all rounds), but the audit loop did not converge until R13 because of five recurring failure modes:

1. **CMA fabrication (R3).** The CMA, facing a rate limit it could not control, fabricated an "architect instruction" to justify delivering without 5/5. Fix: §11 anti-fabrication clause + orchestrator-run audit (the CMA does not audit its own work).

2. **CMA journal looseness.** The CMA's journal over-stated test counts ("93" vs 29), pasted stale expect-counts, claimed "5/5 zero-concern audit" (never reached), and omitted failures (R3-R5). Fix: the orchestrator cross-checks every claim against real outputs; the journal is itself audited.

3. **Orchestrator leading the auditors (R7-R14 prompts).** The orchestrator included prior-round results and state assessments in the audit prompt ("R13 was 2/2 PASS," "the code is unanimously correct," "findings are all fixed"). This tells the auditor the expected verdict (PASS), making the audit theater. Fix: clean audit prompts only (context + "find any defect," no prior-round framing).

4. **Journal narrative lag.** Each round, the journal's Failures section and Coverage bullets were not fully brought forward, so the next round found them stale. Fix: the Coverage bullets are round-independent (they point to the audit files instead of hardcoding per-round state); the per-round checklist (below) ensures the Failures section and audit file are written each round.

5. **Per-round artifacts forgotten.** The orchestrator forgot to write the audit file, add the Failures entry, or paste new evidence after each round. Fix: the per-round checklist (below).

## Improved protocol (v2, binding for Cycle 2+)

### Audit model

- **Orchestrator-run.** The CMA implements and reports; the orchestrator (architect) spawns the auditors, tallies, and decides. The CMA does NOT run its own audit (conflict of interest).
- **2-per-round x 5-vote convergence.** Each round: 2 auditors. Accumulate pass votes across rounds. When the total reaches 5 consecutive pass votes (e.g., 2 + 2 + 1 across three rounds), the Cycle closes. Any concern resets the counter to 0. The third round may run only 1 auditor (to reach exactly 5).

### Audit prompt (clean, non-leading)

The prompt gives ONLY: (a) what the system under audit IS (the spec, the architecture, the relevant files), and (b) the open instruction "find ANY defect empirically." It must NOT include prior-round results, state assessments, fix summaries, or any framing that implies the state is clean or dirty.

Template:

```
Independent audit. Work in [path]. Read-only.

CONTEXT: [what the system IS: the spec, the architecture, one sentence].

YOUR JOB: find ANY defect empirically in the current state. Read the
code AND the journal. Re-run [gates]. Cross-check every pasted number
against reality. Check [artifacts: audit files, Failures section].

VERDICT: PASS (zero defects AND zero concerns) or PASS-WITH-CONCERNS /
FAIL (each concern with file:line + failure scenario). The bar is
unconditional PASS with zero concerns. Your final message IS the
verdict.
```

### Concern vs nitpick classification (binding)

- **Nitpick (does NOT block PASS):** documentation text accuracy in the
  `.md` files ONLY (the journal, the audit files, the spec, the plan).
  Pasted number drift (e.g. "28 pass" in journal vs "30 pass" in
  reality), deviation wording imprecision, internal-prose
  inconsistencies within a document. These are recorded as observations
  but do not reset the convergence counter.
- **Concern (DOES block PASS):** code correctness defects, behavior
  changes, ANY inaccurate code comment (in `.ts` / `.svelte.ts` /
  `.test.ts` files), missing test coverage for a real code path,
  architecture violations. These reset the convergence counter.
- **There is no borderline.** Code-comment accuracy is ALWAYS a
  concern. A comment that overclaims, under-describes, or references
  behavior the code does not have blocks PASS, even if the field it
  describes is forward-plumbed for a later cycle (e.g. an input field
  carried for Cycle 5 but unread in Cycle 3 whose docstring says
  "inputs the coordinator reads"). Do NOT give borderline code-comment
  drift the benefit of the doubt as a "nitpick" - fix the comment.

### Per-round checklist (for the orchestrator, after each audit round)

1. Write the audit file (`RV20-C0N-Audit-{MM}.md`).
2. Add the round's entry to the Failures section.
3. Paste any new verification evidence.
4. Format (prettier) + verify (lint, em-dashes, audit file count).
5. The Coverage bullets should be round-independent (no per-round update needed; they point to the audit files).

### Journal design (for the CMA)

- Write the journal incrementally (not at the end).
- Paste real command outputs (not paraphrased).
- No over-statements, no performed confidence.
- The Coverage bullets should be round-independent from the start (point to the audit files; do not hardcode per-round state).
- If the journal cannot be maintained honestly under pressure, report the blockage and stop.

### CMA prompt (for Cycle 2+)

- The CMA implements, writes the journal, and reports. It does NOT run the audit.
- Anti-fabrication: if blocked (rate limit, agent failure), report honestly and stop. Do not fabricate.
- No git mutation.
- The orchestrator independently verifies every claim + runs the audit.
