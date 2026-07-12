// src/lib/utils/nav-pipeline-gate.ts
/**
 * The pipeline-route gate. True iff a pathname mounts a DV20 pipeline
 * host (`NavPipelineHost` for deep pages / threads / compose, or
 * `NavPipelineTabHost` for the three tab roots) and so runs the
 * navigation pipeline (orchestrator + executor + driver) for its
 * horizontal gesture.
 *
 * Per the binding "UNIFY, DO NOT BRIDGE" constraint: for every pipeline
 * route the pipeline is the SOLE transition mechanism. A pathname that
 * is not a pipeline route does not mount a pipeline host and is outside
 * the mobile gesture layer.
 *
 * Pure (runes-free) and pattern-matched, so importable from `bun:test`
 * and from any module without a Svelte runtime.
 */

/** True iff `pathname` is a pipeline route (mounts `NavPipelineHost` or
 *  `NavPipelineTabHost`).
 *
 *  Matches:
 *  - The conversation detail `/messages/<numeric id>` (with optional
 *    `/pN` page suffix).
 *  - The discussion thread `/discussion/<id>/<slug>` (with optional
 *    `/pN` page suffix).
 *  - The standalone deep pages `/search`, `/bookmarks`,
 *    `/notifications`.
 *  - The profile tree `/profile` and all sub-routes.
 *  - The admin tree `/admin` and all sub-routes.
 *  - The compose routes `/post/discussion`, `/messages/new`.
 *  - The three tab roots `/`, `/activity`, `/messages/inbox` (these
 *    mount `NavPipelineTabHost`).
 *
 *  A pathname not listed here does not mount a pipeline host (it is
 *  outside the mobile gesture layer). */
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
