// src/lib/utils/nav-pipeline-gate.ts
/**
 * The 5b1 pilot-route gate. Selects whether a pathname runs the new
 * DV20 navigation pipeline (orchestrator + executor + driver) or the
 * legacy `GesturePageLayout` / `MobileTabPager` gesture mechanism.
 *
 * Per the C05b1 spec's binding "UNIFY, DO NOT BRIDGE" constraint: for
 * the pilot route, the new pipeline is the SOLE transition mechanism
 * for every transition the route makes. Other routes stay on the full
 * legacy mechanism untouched (Cycle 5b2 migrates them).
 *
 * Pure (runes-free) and pattern-matched, so importable from `bun:test`
 * and from any module without a Svelte runtime.
 */

/** True iff `pathname` is the 5b1 pilot conversation-detail route.
 *
 *  Matches `/messages/<numeric id>` with an optional single-segment
 *  suffix (e.g. `/pN` page, or any other single path segment after
 *  stripping a trailing `/pN` page segment). Per the C05b1 spec this
 *  is the SOLE route the new pipeline drives in this cycle. The pilot's
 *  deep-link target and the tab-click exit destination
 *  (`/messages/inbox`) are NOT pilot routes: they stay on the legacy
 *  mechanism in 5b1.
 */
export function isNavPipelinePilotRoute(pathname: string): boolean {
	// Strip any trailing `/pN` page segment so paged conversations
	// (`/messages/123/p2`) are still gated as pilot routes.
	const stripped = pathname.replace(/\/p\d+$/, '');
	return /^\/messages\/\d+(?:\/[^/]*)?$/.test(stripped);
}

/** True iff navigating from `from` to `to` is a transition the pilot
 *  orchestrator must own. The orchestrator takes ownership when EITHER
 *  endpoint is the pilot route: the back-swipe gesture (FROM pilot, TO
 *  `/messages/inbox`), the tab-click exit (FROM pilot, TO a tab root),
 *  and the deep-link landing (TO pilot) all flow through the
 *  orchestrator. */
export function isPilotTransition(from: string | null, to: string | null): boolean {
	if (from !== null && isNavPipelinePilotRoute(from)) return true;
	if (to !== null && isNavPipelinePilotRoute(to)) return true;
	return false;
}
