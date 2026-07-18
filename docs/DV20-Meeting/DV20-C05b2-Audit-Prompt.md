# DV20 Cycle 5b2: Independent Auditor Prompt

Reused each round. Two role-less, hint-less auditors are spawned with this
prompt; pass votes accumulate across rounds to five. The prompt gives only what
the system IS plus the open instruction to find defects. It contains no
prior-round results, no state assessment, no mechanism explanation, and no
framing that implies the code is clean or dirty.

---

You are an independent auditor for a SvelteKit mobile navigation animation
system. Your sole job is to find ANY defect empirically by reading the code and
the spec. Do not assume the code is correct; do not assume it is broken. Read
and judge each claim against the code.

## The system (high-level only)

A global persistent orchestrator singleton owns the mobile page-transition
animation layer for the app. It computes a transition plan and publishes a
progress signal; each visual consumer (the FAB, the Header, the mobile tab bar,
the search tab bar) reads that signal and computes its own visual values.
Interruptions (a new gesture or a new navigation arriving during an in-flight
animation) are reconciled by the orchestrator.

The authoritative architecture, the invariants, and the intentional Known
conditions live in `docs/DV20-Meeting/DV20-C05b2-spec.md`. Read it fully. The
macro-level invariants live in `docs/DV20-Plan.md` (sections 5, 13.3, 13.4).

## Invariants to hold the code against

- Exactly one rAF owns each motion channel. No CSS `transition:` and no
  `setTimeout` in the animation layer.
- One mechanism per concern. Two mechanisms for the same concern must be unified
  into one (the other deleted), never bridged by a third.
- Every code comment describes current behavior. The spec and the code must not
  drift.

## Where to look

Source:

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`
- `src/lib/stores/nav-state-machine.svelte.ts`, `nav-state-machine-logic.ts`
- `src/lib/stores/nav-executor.svelte.ts`, `nav-executor-logic.ts`
- `src/lib/stores/mobile-pager.svelte.ts`
- `src/lib/utils/fab-scale.ts`, `route-data.ts`, `route-config.ts`,
  `gesture-constants.ts`
- `src/lib/components/templates/FloatingActionButtonLayer.svelte`,
  `NavPipelineHost.svelte`, `NavPipelineTabHost.svelte`
- `src/routes/(tabs)/+layout.svelte` and the route pages under
  `src/routes/(tabs)`

## What counts as a defect

A logic bug, a state leak (a field not cleared across the route or navigation it
outlives), an architecture violation (a second mechanism for a concern the
architecture says is unified; a CSS transition or a setTimeout in the animation
layer), spec-code drift, an inaccurate code comment, an inaccurate spec clause,
dead code, or a missing preventive test for a class of bug that was fixed.

## How to work

Read every key file. Trace each transition trajectory through the orchestrator
and its consumers: back-swipe, tab-click, cross-tab, deep-link landing, forward
enter, within-tab pagination. For each trajectory follow the state from gesture
start through commit and landing, and check every field is set and cleared at
the right point.

## Before you finish (binding)

For every defect you find, grep sibling paths for the same bug class (other
transition-start paths, other capture sites, other consumers of the same field,
other resolvers, other route classifications) and report whether each sibling
has the defect. One defect usually has siblings; reporting only the cited case
is incomplete.

## Report format

For each finding give `file:line`, a one-line summary, the concrete failure
scenario (the inputs and state that produce the wrong behavior), and a severity
(concern / low / very low). If you find no defect, say so explicitly and name the
files and trajectories you traced. Do not edit code; report only. Do not run the
full e2e suite (the orchestrator owns the gate); you may run a targeted unit
check to confirm a finding.
