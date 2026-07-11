// src/lib/utils/nav-pipeline-gate.ts
/**
 * The pipeline-route gate. Selects whether a pathname runs the DV20
 * navigation pipeline (orchestrator + executor + driver) or the legacy
 * `GesturePageLayout` / `MobileTabPager` gesture mechanism.
 *
 * Per the binding "UNIFY, DO NOT BRIDGE" constraint: for every pipeline
 * route, the new pipeline is the SOLE transition mechanism for every
 * transition the route makes. Non-pipeline routes stay on the full
 * legacy mechanism untouched until they are migrated.
 *
 * Pure (runes-free) and pattern-matched, so importable from `bun:test`
 * and from any module without a Svelte runtime.
 */

/** True iff `pathname` is a pipeline route (mounts `NavPipelineHost`).
 *
 *  Matches:
 *  - The conversation-detail pilot `/messages/<numeric id>` (with
 *    optional `/pN` page suffix).
 *  - The discussion thread `/discussion/<id>/<slug>` (with optional
 *    `/pN` page suffix).
 *  - The standalone deep pages `/search`, `/bookmarks`,
 *    `/notifications`.
 *  - The profile tree `/profile` and all sub-routes.
 *  - The admin tree `/admin` and all sub-routes.
 *
 *  Non-pipeline routes stay on the legacy mechanism until their
 *  migration phase. */
export function isNavPipelineRoute(pathname: string): boolean {
	// Strip any trailing `/pN` page segment so paged conversations
	// (`/messages/123/p2`, `/discussion/123/slug/p2`) are still gated
	// as pipeline routes.
	const stripped = pathname.replace(/\/p\d+$/, '');
	if (/^\/messages\/\d+$/.test(stripped)) return true;
	if (/^\/discussion\/\d+\/[^/]+$/.test(stripped)) return true;
	if (pathname === '/search') return true;
	if (pathname === '/bookmarks') return true;
	if (pathname === '/notifications') return true;
	if (pathname === '/profile') return true;
	if (pathname.startsWith('/profile/')) return true;
	if (pathname === '/admin') return true;
	if (pathname.startsWith('/admin/')) return true;
	if (pathname === '/post/discussion') return true;
	if (pathname === '/messages/new') return true;
	if (pathname === '/') return true;
	if (pathname === '/activity') return true;
	if (pathname === '/messages/inbox') return true;
	return false;
}

/** True iff navigating from `from` to `to` is a transition the pipeline
 *  orchestrator must own. The orchestrator takes ownership when the
 *  FROM route is a pipeline route (the back-swipe gesture TO the
 *  back-target and the tab-click exit TO a tab root). The TO-pipeline
 *  branch covers a pipeline-internal SPA nav; a cold deep-link landing
 *  hits this gate before NavPipelineHost mounts, so the orchestrator
 *  singleton is null and the layout hook falls through to plain
 *  SvelteKit nav (no slide). */
export function isPilotTransition(from: string | null, to: string | null): boolean {
	if (from !== null && isNavPipelineRoute(from)) return true;
	if (to !== null && isNavPipelineRoute(to)) return true;
	return false;
}
