// src/lib/utils/route-data.ts
/**
 * RouteData - the per-route navigation/gesture attribute record.
 *
 * The authoritative source of truth for a route's navigation attributes
 * per `docs/DV20-Plan.md` §3. The record holds exactly two fields:
 *
 *   - `tag`              selects the resolver pair (§4)
 *   - `fab`              whether the FAB is visible on this page
 *
 * Per §3's clarity principle, NO stored field duplicates the tag. The
 * derived queries `isSpatial(r) = r.tag === 'tab'`, `headerMode(r)`,
 * `centerTab(r)`, and the spatial neighbours (positional in the tab
 * order) are NOT stored here; they are computed by their consumers.
 *
 * The companion consumer configs (FAB icon/href, FAB route attributes,
 * tab-bar pill target, preview panel) live in `route-config.ts` and are
 * keyed by route pattern. They are NOT in the core record.
 *
 * Pure (runes-free) and pattern-matched, so it is importable from
 * `bun:test` and from `navigation-logic.ts` without a Svelte runtime.
 */

/** The transition family a route participates in (§3, §14.1). */
export type RouteTag = 'tab' | 'detail' | 'search';

/**
 * The per-route navigation record. The shape is exactly `docs/DV20-Plan.md`
 * §3: two fields, none of them a tag-duplicate or a renamed
 * `gestureOwner`/`headerMode`/`fabFamily` style discriminator. §3 lists
 * those as derived or moved to consumer configs.
 */
export interface RouteData {
	/** Selects the resolver pair (§4). */
	readonly tag: RouteTag;
	/**
	 * Whether the FAB is visible at rest on this page. The FAB layer
	 * (`FloatingActionButtonLayer.svelte`) reads the from/to fab booleans
	 * directly off each transition's `RouteData` as the FROM/TO inputs
	 * to `computeFabScale` (the 5-branch derivation: boundary,
	 * suppressed, enterAnchor lerp, dragAnchor shift, natural); the
	 * resolver does NOT read this field (the plan it returns is
	 * page-track-only, as asserted by `nav-resolvers.test.ts`'s `plan
	 * shape: page-track only`). The FAB atom also stays mounted at
	 * scale 0 on Family B/C routes; that mount decision is a Layer 5
	 * concern that reads the consumer FAB-route-attributes config, not
	 * this boolean.
	 */
	readonly fab: boolean;
}

interface RouteEntry {
	readonly pattern: RegExp;
	readonly tag: RouteTag;
	readonly fab: boolean;
}

/**
 * The route registry. Sourced from each route's `+page.svelte`, its
 * load function, and its current classification.
 *
 * Tag assignments per §3 + §14.1 + the Cycle 1 spec:
 *   - 'tab': `/`, `/activity`, `/messages/inbox` (the three pager
 *     roots), `/discussions/p\d+` (tab-internal pagination),
 *     `/offline`, `/offline/activity` (offline mirrors of the tab roots)
 *   - 'search': `/search`
 *   - 'detail': every other route, including the offline detail mirrors
 *     `/offline/bookmarks` and `/offline/[discussionId]`
 *
 * `fab` is true where the FAB is visible at rest: `/`, `/messages/inbox`,
 * and `/discussions/p\d+` (the FAB is visible on every page of the
 * discussions list, including within-tab pagination); every other route is
 * `false`. The FAB-layer's atom-on-Family-B/C behavior is a
 * consumer-rendering concern.
 */
const ROUTE_ENTRIES: readonly RouteEntry[] = [
	// --- Tab routes (the three pager roots + tab-internal pagination +
	//     the offline tab mirrors) ---
	{
		pattern: /^\/$/,
		tag: 'tab',
		fab: true
	},
	{
		pattern: /^\/activity$/,
		tag: 'tab',
		fab: false
	},
	{
		pattern: /^\/messages\/inbox$/,
		tag: 'tab',
		fab: true
	},
	{
		// Tab-internal pagination of the discussions list. Per §4 this
		// is handled by `{tab, tab}` and is tag 'tab', NOT a tab root.
		// fab: true so the FAB is visible on every page of the list
		// (the user can create a discussion from any page), matching `/`.
		pattern: /^\/discussions\/p\d+$/,
		tag: 'tab',
		fab: true
	},
	{
		// /offline mirrors / (the offline discussions list).
		pattern: /^\/offline$/,
		tag: 'tab',
		fab: false
	},
	{
		// /offline/activity mirrors /activity.
		pattern: /^\/offline\/activity$/,
		tag: 'tab',
		fab: false
	},

	// --- Search ---
	{
		pattern: /^\/search$/,
		tag: 'search',
		fab: false
	},

	// --- Detail: thread / conversation / compose ---
	{
		pattern: /^\/discussion\//,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/messages\/\d/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/messages\/new$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/messages\/add\/\d+/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/post\/discussion$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/post\/editDiscussion\/\d+$/,
		tag: 'detail',
		fab: false
	},

	// --- Detail: standalone global routes ---
	{
		pattern: /^\/bookmarks$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/notifications$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/categories$/,
		tag: 'detail',
		fab: false
	},
	{
		// Category page with optional paginator: /category/<slug> or /category/<slug>/p<N>
		pattern: /^\/category\/[^/]+(\/p\d+)?$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/drafts$/,
		tag: 'detail',
		fab: false
	},

	// --- Detail: profile tree ---
	{
		pattern: /^\/profile$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/profile\/settings$/,
		tag: 'detail',
		fab: false
	},
	{
		// /profile/<userId>/<userSlug>
		pattern: /^\/profile\/\d+\/[^/]+$/,
		tag: 'detail',
		fab: false
	},
	{
		// /profile/comments/<userId>/<userSlug>
		pattern: /^\/profile\/comments\/\d+\/[^/]+$/,
		tag: 'detail',
		fab: false
	},
	{
		// /profile/discussions/<userId>/<userSlug>
		pattern: /^\/profile\/discussions\/\d+\/[^/]+$/,
		tag: 'detail',
		fab: false
	},
	{
		// Sub-settings pages under /profile/settings.
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/profile\/invitations$/,
		tag: 'detail',
		fab: false
	},

	// --- Detail: admin tree ---
	{
		pattern: /^\/admin$/,
		tag: 'detail',
		fab: false
	},
	{
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
		tag: 'detail',
		fab: false
	},

	// --- Detail: offline detail mirrors ---
	{
		// /offline/bookmarks mirrors /bookmarks.
		pattern: /^\/offline\/bookmarks$/,
		tag: 'detail',
		fab: false
	},
	{
		// /offline/<discussionId> mirrors /discussion/<id>.
		pattern: /^\/offline\/\d+/,
		tag: 'detail',
		fab: false
	}
];

/**
 * The default for unmatched pathnames. Routes like `/entry/*`,
 * `/avatar/*`, `/attachment/*`, `/api/*`, `/upload`,
 * `/manifest.webmanifest` fall through to this: none participates in
 * the gesture layer and none shows a FAB.
 */
const DEFAULT_ROUTE_DATA: RouteData = {
	tag: 'detail',
	fab: false
};

/**
 * Lookup the `RouteData` for `pathname`. Returns the matching entry;
 * falls back to `DEFAULT_ROUTE_DATA` when no pattern matches.
 * First-match-wins.
 */
export function getRouteData(pathname: string): RouteData {
	const entry = ROUTE_ENTRIES.find((e) => e.pattern.test(pathname));
	if (!entry) return DEFAULT_ROUTE_DATA;
	return {
		tag: entry.tag,
		fab: entry.fab
	};
}
