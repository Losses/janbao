// src/lib/utils/route-config.ts
/**
 * route-config - the consumer-rendering configs that sit on top of the
 * core `RouteData` record (in `route-data.ts`).
 *
 * Per `docs/DV20-Plan.md` §3 the core record holds only `tag`,
 * `backParent`, `snapshotCapture`, and `fab`. Everything that the
 * renderer (Layer 5), the FAB atom, the tab bar, or the deep-page
 * preview reads lives here as a separate consumer config keyed by route
 * pattern.
 *
 * The configs in this file:
 *
 *   - `FAB_KIND_CONFIGS`          the FAB icon / href / tabIndex per
 *                                  concrete list kind (the rendering
 *                                  details for `fab: true` routes).
 *   - `FAB_ROUTE_ATTRIBUTES`      family + kind per route where the FAB
 *                                  atom mounts (including Family B/C
 *                                  routes that keep the atom at scale
 *                                  0). Family enum is consumed by the
 *                                  FAB layer's family selection; it
 *                                  dissolves in Cycle 4's all-rAF
 *                                  executor.
 *   - `TAB_BAR_CONFIG`            the pill target per route (§3's
 *                                  tab-bar consumer config).
 *   - `PREVIEW_PANEL_CONFIG`      the back-preview snippet component
 *                                  per route that captures one.
 *
 * `isPipelineSwipeDisabledRoute` reads the core `RouteData` registry
 * directly via `getRouteData(p).backParent !== undefined` for its
 * deep-route set, plus `FAB_ROUTE_ATTRIBUTES` for the
 * thread/conversation check. Both the function and DualColumnLayout's
 * detectSwipe dissolve in 5b3.
 *
 * The classifier functions below are either positional queries over
 * `MOBILE_TAB_DEFS` (`isPagerRoute`), one-line reads of the consumer
 * configs (`getCurrentTabIndex`), or non-route classifiers
 * (`backTargetListKind` classifies a back-target string). The
 * `isPipelineSwipeDisabledRoute` classifier reads the consumer
 * registries above.
 */
import type { Component } from 'svelte';
import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
import TabDiscussionsPanel from '$lib/components/panels/TabDiscussionsPanel.svelte';
import TabActivityPanel from '$lib/components/panels/TabActivityPanel.svelte';
import TabMessagesPanel from '$lib/components/panels/TabMessagesPanel.svelte';
import { mdiPlus, mdiEmailPlus } from '@mdi/js';
import type { TranslationDict } from '$lib/types/translation';
import { MOBILE_TAB_DEFS, type TabDef, type MobileTabLabelKey } from './tab-config';
import { getRouteData } from './route-data';
import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
import type { TabsLayoutData } from '$lib/types/tabs';

export type { MobileTabLabelKey, PathMatcher } from './tab-config';

// ---------------------------------------------------------------------------
// FAB icon/href config (§3 consumer config #1).
//
// The FAB's icon, label, href, and tabIndex per concrete list kind. The
// resolver (Layer 3) reads only the core `fab` boolean; the FAB layer
// reads this for rendering.

export type FabListKind = 'discussions' | 'messages';

export type FabLabelResolver = (t: TranslationDict) => string;

export interface FabKindConfig {
	readonly label: FabLabelResolver;
	readonly href: string;
	readonly icon: string;
	readonly tabIndex: number;
}

export const FAB_KIND_CONFIGS: Record<FabListKind, FabKindConfig> = {
	discussions: {
		label: (t) => t.nav.discussions ?? 'New discussion',
		href: '/post/discussion',
		icon: mdiPlus,
		tabIndex: 0
	},
	messages: {
		label: (t) => t.nav.messages ?? 'New message',
		icon: mdiEmailPlus,
		href: '/messages/new',
		tabIndex: 2
	}
};

// ---------------------------------------------------------------------------
// FAB route attributes (§3 consumer config #2; the family enum dissolves
// in Cycle 4's all-rAF executor).
//
// `family` selects the FAB layer's scale driver; `kind` selects the icon/href
// (or `'dynamic'` for the Activity route's spatially-resolved FAB, or
// `'deep'` for the non-FAB deep routes whose atom stays mounted at scale
// 0 across the list<->deep boundary). Together they preserve the
// per-route rendering that the FAB layer needs; nothing here is a
// concept the core `RouteData` record holds.

// `FabFamily` is the canonical FAB family enum, owned by
// `fab-scale.ts` (the FAB layer's pure scale maths). Imported here so
// the consumer registry and the FAB layer share one type; adding a
// family in either module requires updating the other.
import type { FabFamily } from './fab-scale';

/**
 * The dynamic FAB kind. `'dynamic'` is the Activity route's
 * spatially-resolved FAB; `'deep'` is the non-FAB deep route sentinel
 * that keeps the atom mounted at scale 0; `null` covers the static list
 * FAB kinds (`'discussions'` / `'messages'`).
 */
export type FabRouteKind = FabListKind | 'dynamic' | 'deep' | null;

export interface FabRouteAttributes {
	readonly pattern: RegExp;
	readonly family: FabFamily;
	readonly kind: FabRouteKind;
}

/**
 * Per-route FAB attributes. The atom mounts on every route in this
 * table (Family B/C at scale 0). Routes absent from this table never
 * mount the FAB atom directly; the FAB layer's `retainedConfig` keeps
 * the most-recent FAB mounted across no-FAB routes.
 */
const FAB_ROUTE_ATTRIBUTES: readonly FabRouteAttributes[] = [
	// Family A: list routes with a visible FAB at rest.
	{ pattern: /^\/$/, family: 'list', kind: 'discussions' },
	{ pattern: /^\/messages\/inbox$/, family: 'list', kind: 'messages' },
	// Family A, dynamic kind: Activity's FAB resolves from the gesture source tab.
	{ pattern: /^\/activity$/, family: 'list', kind: 'dynamic' },

	// Family B: thread / conversation (overlay on top of the source list).
	{ pattern: /^\/discussion\//, family: 'overlay', kind: 'discussions' },
	{ pattern: /^\/messages\/\d/, family: 'overlay', kind: 'messages' },

	// Family C: compose forms (publish coverProgress for the FAB scale).
	{ pattern: /^\/post\/discussion$/, family: 'compose', kind: 'discussions' },
	{ pattern: /^\/messages\/new$/, family: 'compose', kind: 'messages' },

	// Family B 'deep': non-FAB deep routes whose atom stays mounted at scale 0
	// so coverProgress drives the scale across the list<->deep boundary.
	{ pattern: /^\/bookmarks$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/search$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/notifications$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/profile$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/profile\/settings$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/profile\/\d+\/[^/]+$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/profile\/comments\/\d+\/[^/]+$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/profile\/discussions\/\d+\/[^/]+$/, family: 'overlay', kind: 'deep' },
	{
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		family: 'overlay',
		kind: 'deep'
	},
	{ pattern: /^\/profile\/invitations$/, family: 'overlay', kind: 'deep' },
	{ pattern: /^\/admin$/, family: 'overlay', kind: 'deep' },
	{
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
		family: 'overlay',
		kind: 'deep'
	}
];

/**
 * Lookup the FAB attributes for `pathname`. Returns `null` when the
 * route does not mount the FAB atom directly.
 */
export function getFabRouteAttributes(pathname: string): FabRouteAttributes | null {
	return FAB_ROUTE_ATTRIBUTES.find((r) => r.pattern.test(pathname)) ?? null;
}

// ---------------------------------------------------------------------------
// Tab-bar pill target config (§3 consumer config #3).
//
// Per §3 the tab-bar config assigns each route a pill target
// ('discussions' | 'activity' | 'messages' | 'active' | 'none'). The
// 'active' value is the §3 rename of 'inherit': the route follows the
// currently-active tab (the global routes /admin, /profile, /search,
// /bookmarks, /notifications). For Cycle 1 'active' routes return -1
// from `getCurrentTabIndex`, matching the current codebase; the
// tab-bar consumer resolves 'active' to the live tab in a later cycle.

export type TabBarPillTarget = 'discussions' | 'activity' | 'messages' | 'active' | 'none';

export interface TabBarEntry {
	readonly pattern: RegExp;
	readonly pillTarget: Exclude<TabBarPillTarget, 'none'>;
}

const TAB_BAR_CONFIG: readonly TabBarEntry[] = [
	// Spatial tab roots.
	{ pattern: /^\/$/, pillTarget: 'discussions' },
	{ pattern: /^\/activity$/, pillTarget: 'activity' },
	{ pattern: /^\/messages\/inbox$/, pillTarget: 'messages' },

	// Tab-internal pagination inherits its tab's pill.
	{ pattern: /^\/discussions\/p\d+$/, pillTarget: 'discussions' },

	// Offline tab mirrors. Prefix patterns (no `$`) so /offline/<id> and
	// /offline/bookmarks inherit the discussions pill. Cycle 6 brings the
	// offline detail routes into the gesture layer. Order matters:
	// /offline/activity before /offline.
	{ pattern: /^\/offline\/activity/, pillTarget: 'activity' },
	{ pattern: /^\/offline/, pillTarget: 'discussions' },

	// Thread / conversation / compose routes inherit their source tab's
	// pill (their pill target mirrors the source list they overlay).
	{ pattern: /^\/discussion\//, pillTarget: 'discussions' },
	{ pattern: /^\/messages\/\d/, pillTarget: 'messages' },
	{ pattern: /^\/post\/discussion$/, pillTarget: 'discussions' },
	{ pattern: /^\/messages\/new$/, pillTarget: 'messages' },

	// Global routes follow the active tab (the §3 'active' pill target).
	{ pattern: /^\/admin/, pillTarget: 'active' },
	{ pattern: /^\/profile/, pillTarget: 'active' },
	{ pattern: /^\/search$/, pillTarget: 'active' },
	{ pattern: /^\/bookmarks$/, pillTarget: 'active' },
	{ pattern: /^\/notifications$/, pillTarget: 'active' }
];

/**
 * Resolve the pill target for `pathname`. Routes absent from
 * `TAB_BAR_CONFIG` resolve to `'none'` (no pill, no tab highlight).
 */
export function getTabBarPillTarget(pathname: string): TabBarPillTarget {
	return TAB_BAR_CONFIG.find((e) => e.pattern.test(pathname))?.pillTarget ?? 'none';
}

// ---------------------------------------------------------------------------
// Preview-panel config (§3 consumer config #4).
//
// The component rendered in NavPipelineHost's left-panel preview slot when
// a back-swipe targets a route that captures a snippet. Routes that
// capture a snippet but render the source tab's panel (e.g. compose
// forms) are absent here; the layer's fallback to
// `MOBILE_TABS[activeTab].panel` covers them.
//
// Preview panels source their own data from the page store / page cache,
// so the slot holds a prop-less Svelte component.
export type SvelteComponentType = Component;

export interface PreviewPanelEntry {
	readonly pattern: RegExp;
	readonly panel: SvelteComponentType;
}

const PREVIEW_PANEL_CONFIG: readonly PreviewPanelEntry[] = [
	{ pattern: /^\/profile\/settings$/, panel: SettingsMenuPanel },
	{ pattern: /^\/profile\/\d+\/[^/]+$/, panel: ProfileMenuPanel },
	{ pattern: /^\/profile\/comments\/\d+\/[^/]+$/, panel: ProfileMenuPanel },
	{ pattern: /^\/profile\/discussions\/\d+\/[^/]+$/, panel: ProfileMenuPanel },
	{
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		panel: SettingsMenuPanel
	},
	{ pattern: /^\/profile\/invitations$/, panel: ProfileMenuPanel },
	{ pattern: /^\/admin$/, panel: AdminMenuPanel },
	{
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
		panel: AdminMenuPanel
	}
];

/**
 * Lookup the back-preview snippet component for `pathname`. Returns
 * `null` when the route has no dedicated preview panel; the FAB layer
 * falls back to the active tab's panel.
 */
export function getPreviewPanel(pathname: string): SvelteComponentType | null {
	return PREVIEW_PANEL_CONFIG.find((e) => e.pattern.test(pathname))?.panel ?? null;
}

// ---------------------------------------------------------------------------
// `isPipelineSwipeDisabledRoute` reads the deep-route-parent set directly
// from the core `RouteData` registry (`backParent !== undefined`) rather
// than maintaining a separate pattern list. This keeps the function's
// answer set byte-stable without a duplication hazard: the set of routes
// that declare a structural parent lives in one place (`route-data.ts`).

// ---------------------------------------------------------------------------
// Classifiers.
//
// Most of the classifier surface lives in the core `RouteData` record
// or the consumer configs above. The remaining functions below are
// positional queries (`isPagerRoute`), consumer-config reads
// (`getCurrentTabIndex`), non-route classifiers (`backTargetListKind`),
// and `isPipelineSwipeDisabledRoute` whose body reads the consumer
// registries above.

/**
 * Resolve the source-list kind for a `deep` route from its back target. The back
 * target decides which list the FAB scales back toward: `/` -> discussions,
 * `/messages/inbox` -> messages, anything else defaults to discussions. The back
 * target string may carry a `?search` part (navigation-logic.ts returns pathname
 * + search), so the comparison uses the pathname only.
 */
export function backTargetListKind(backTargetHref: string | null): FabListKind {
	if (!backTargetHref) return 'discussions';
	const queryIdx = backTargetHref.indexOf('?');
	const pathname = queryIdx >= 0 ? backTargetHref.slice(0, queryIdx) : backTargetHref;
	return pathname === '/messages/inbox' ? 'messages' : 'discussions';
}

/**
 * A route whose +page.svelte mounts a pipeline-owning layout
 * (`NavPipelineHost`), so `DualColumnLayout`'s own detectSwipe tab-
 * swipe must yield to it (the pipeline owns the horizontal drag on
 * these routes). TRUE for routes in Family-B `overlay` whose kind is
 * not `'deep'` (threads and conversations) OR routes whose structural
 * parent is declared in the core record.
 *
 * Masked latent bug: `/search`, `/bookmarks`, `/notifications`, and
 * `/profile` mount a NavPipelineHost but this function returns FALSE
 * for them (they carry `kind: 'deep'`, failing the overlay branch, and
 * have no declared `backParent`, failing the deep-route branch). Sub-
 * pages of `/profile` and the entire `/admin/*` tree declare
 * `backParent`, so they return TRUE; the latent-bug set is the four
 * leaf routes only. The race does not manifest because NavPipelineHost
 * wins the pointer capture consistently; the function and the bug
 * dissolve in 5b3 when `DualColumnLayout`'s detectSwipe is removed.
 */
export function isPipelineSwipeDisabledRoute(pathname: string): boolean {
	const attrs = getFabRouteAttributes(pathname);
	if (attrs && attrs.family === 'overlay' && attrs.kind !== 'deep') return true;
	return getRouteData(pathname).backParent !== undefined;
}

/** True for the exact pager routes (the three tab roots, where
 *  `NavPipelineTabHost` owns the tab swipe). A positional query over
 *  `MOBILE_TAB_DEFS` (the spatial tab metadata), not a per-route
 *  `RouteData` field. */
export function isPagerRoute(pathname: string): boolean {
	return MOBILE_TAB_DEFS.some((tab) => tab.href === pathname);
}

/**
 * Index of the module tab a pathname belongs to, or -1 when on no tab route.
 * Reads the tab-bar consumer config: a `'discussions'` / `'activity'` /
 * `'messages'` pill target resolves to the matching tab index; any
 * other pill target (`'active'`, `'none'`, or unmatched) returns -1.
 */
export function getCurrentTabIndex(pathname: string): number {
	const pillTarget = getTabBarPillTarget(pathname);
	if (pillTarget === 'active' || pillTarget === 'none') return -1;
	return MOBILE_TAB_DEFS.findIndex((tab) => tab.labelKey === pillTarget);
}

// ---------------------------------------------------------------------------
// Mobile tabs: the browser-side tier of tab knowledge.
//
// tab-config.ts is the pure source (tab order, hrefs, prefix matchers, data
// keys); navigation-logic imports it for unit tests. Here we layer the
// browser-only bits on top: the page-cache populated check (a $state store),
// the list panel component. The store is read lazily inside the closures, so
// importing this module (incl. under bun:test) never instantiates it.

// Each tab's list panel is a prop-less Component that pulls its data from the
// page cache and page data itself.
const TAB_LIST_PANELS: Record<MobileTabLabelKey, Component> = {
	discussions: TabDiscussionsPanel,
	activity: TabActivityPanel,
	messages: TabMessagesPanel
};

type CacheCheckFn = () => boolean;
type TabDataCheck = (data: Partial<TabsLayoutData>) => boolean;

export interface MobileTab extends TabDef {
	checkCache: CacheCheckFn;
	/** A tab's list is available when the cache OR the root-layout data has items. */
	hasData: TabDataCheck;
	panel: Component;
}

/**
 * Whether a tab's list is present in the root layout data. The root load
 * eager-loads page 1 of every tab on every route, so a tab's list is available
 * via `data` even on a deep page that never captured into the page cache.
 * Reads the tab's declared dataKey/listKey, so no per-tab switch lives here.
 */
function tabListPopulated(tab: TabDef, data: Partial<TabsLayoutData>): boolean {
	const section = (data as Record<string, unknown>)[tab.dataKey] as
		| Record<string, unknown[]>
		| undefined;
	const list = section?.[tab.listKey];
	return list ? list.length > 0 : false;
}

/**
 * Whether the page cache holds a populated list entry for `tab`. Reads
 * the entry keyed by the tab's root href and inspects the same list
 * field declared on the tab definition. The cache entry's `data` is
 * opaque to the store; this consumer narrows via the tab's `listKey`
 * (the route-keyed lookup guarantees the shape).
 */
function tabListCached(tab: TabDef): boolean {
	const entry = getPageCacheStore().get(tab.href);
	if (!entry?.data) return false;
	// The cache entry's data is opaque (`unknown`); narrow it to a
	// record of arrays so the tab's `listKey` field reads as a list.
	const data = entry.data as Record<string, unknown[] | undefined> | null;
	if (!data) return false;
	const list = data[tab.listKey];
	return list ? list.length > 0 : false;
}

export const MOBILE_TABS: readonly MobileTab[] = MOBILE_TAB_DEFS.map((tab) => ({
	...tab,
	checkCache: () => tabListCached(tab),
	hasData: (data) => tabListCached(tab) || tabListPopulated(tab, data),
	panel: TAB_LIST_PANELS[tab.labelKey]
}));
