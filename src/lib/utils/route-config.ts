// src/lib/utils/route-config.ts
/**
 * route-config - the consumer-rendering configs that sit on top of the
 * core `RouteData` record (in `route-data.ts`).
 *
 * Per `docs/DV20-Plan.md` §3 the core record holds only `tag`,
 * `snapshotCapture`, and `fab`. Everything that the renderer (Layer 5),
 * the FAB atom, the tab bar, or the deep-page preview reads lives here
 * as a separate consumer config keyed by route pattern.
 *
 * The configs in this file:
 *
 *   - `FAB_KIND_CONFIGS`          the FAB icon / href per
 *                                  concrete list kind (the rendering
 *                                  details for `fab: true` routes).
 *   - `FAB_ROUTE_ATTRIBUTES`      the FAB `kind` per route where the
 *                                  atom mounts (including Family B/C
 *                                  routes that keep the atom at scale
 *                                  0).
 *   - `TAB_BAR_CONFIG`            the pill target per route (§3's
 *                                  tab-bar consumer config).
 *   - `PREVIEW_PANEL_CONFIG`      the back-preview snippet component
 *                                  per route that captures one.
 *
 * The classifier functions below are positional queries over
 * `MOBILE_TAB_DEFS` (`isPagerRoute`), one-line reads of the consumer
 * configs (`getCurrentTabIndex`), or the non-route classifier
 * `backTargetListKind` (which classifies a back-target string).
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
import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
import type { TabsLayoutData } from '$lib/types/tabs';

export type { MobileTabLabelKey, PathMatcher } from './tab-config';

// ---------------------------------------------------------------------------
// FAB icon/href config (§3 consumer config #1).
//
// The FAB's icon, label, and href per concrete list kind. The FAB layer
// reads the core `fab` boolean (off `RouteData`) for its scale plan and
// this config (`FAB_KIND_CONFIGS`) for rendering; the resolver does not
// read either (its plan carries no FAB function).

export type FabListKind = 'discussions' | 'messages';

export type FabLabelResolver = (t: TranslationDict) => string;

export interface FabKindConfig {
	readonly label: FabLabelResolver;
	readonly href: string;
	readonly icon: string;
}

export const FAB_KIND_CONFIGS: Record<FabListKind, FabKindConfig> = {
	discussions: {
		label: (t) => t.nav.discussions,
		href: '/post/discussion',
		icon: mdiPlus
	},
	messages: {
		label: (t) => t.nav.messages,
		icon: mdiEmailPlus,
		href: '/messages/new'
	}
};

// ---------------------------------------------------------------------------
// FAB route attributes (§3 consumer config #2).
//
// `kind` selects the icon/href (or `'dynamic'` for the Activity route's
// spatially-resolved FAB, or `'deep'` for the non-FAB deep routes whose
// atom stays mounted at scale 0 across the list<->deep boundary). It
// preserves the per-route rendering the FAB layer needs; nothing here
// is a concept the core `RouteData` record holds.

/**
 * The dynamic FAB kind. `'dynamic'` is the Activity route's
 * spatially-resolved FAB; `'deep'` is the non-FAB deep route sentinel
 * that keeps the atom mounted at scale 0; `null` covers the static list
 * FAB kinds (`'discussions'` / `'messages'`).
 */
export type FabRouteKind = FabListKind | 'dynamic' | 'deep';

export interface FabRouteAttributes {
	readonly pattern: RegExp;
	readonly kind: FabRouteKind;
}

/**
 * Per-route FAB attributes. The atom mounts on every route in this
 * table (Family A at scale 0 or 1; Family B/C at scale 0). Routes
 * absent from this table never
 * mount the FAB atom directly; the FAB layer's `retainedConfig` keeps
 * the most-recent FAB mounted across no-FAB routes.
 */
const FAB_ROUTE_ATTRIBUTES: readonly FabRouteAttributes[] = [
	// Family A: list routes whose atom is mounted (Family A at scale 0
	// or 1). /, /discussions/pN (every page of the list), and
	// /messages/inbox show a visible FAB at rest (fab: true); the FAB
	// layer scales the atom per route below.
	{ pattern: /^\/$/, kind: 'discussions' },
	{ pattern: /^\/discussions\/p\d+$/, kind: 'discussions' },
	{ pattern: /^\/messages\/inbox$/, kind: 'messages' },
	// Family A, dynamic kind: Activity's FAB atom stays mounted at
	// scale 0 (fab: false); the dynamic kind is used only as a retained
	// icon for transitions across the list boundary.
	{ pattern: /^\/activity$/, kind: 'dynamic' },

	// Family B: thread / conversation (overlay on top of the source list).
	{ pattern: /^\/discussion\//, kind: 'discussions' },
	{ pattern: /^\/messages\/\d/, kind: 'messages' },

	// Family C: compose forms (the FAB scale is fabScale(publication.progress,
	// fromHasFab, toHasFab), driven by the orchestrator's publication.progress
	// and FROM/TO RouteData.fab).
	{ pattern: /^\/post\/discussion$/, kind: 'discussions' },
	{ pattern: /^\/messages\/new$/, kind: 'messages' },
	// /messages/add/[userId] shares MessageCompose with /messages/new; the
	// FAB atom stays mounted at scale 0 (compose family, no visible FAB).
	{ pattern: /^\/messages\/add\//, kind: 'messages' },

	// Family B 'deep': non-FAB deep routes whose atom stays mounted at scale 0
	// so fabScale(publication.progress, fromHasFab, toHasFab) drives the scale
	// across the list<->deep boundary (orchestrator's publication.progress
	// and FROM/TO RouteData.fab).
	{ pattern: /^\/bookmarks$/, kind: 'deep' },
	{ pattern: /^\/search$/, kind: 'deep' },
	{ pattern: /^\/notifications$/, kind: 'deep' },
	{ pattern: /^\/profile$/, kind: 'deep' },
	{ pattern: /^\/profile\/settings$/, kind: 'deep' },
	{ pattern: /^\/profile\/\d+\/[^/]+$/, kind: 'deep' },
	{ pattern: /^\/profile\/comments\/\d+\/[^/]+$/, kind: 'deep' },
	{ pattern: /^\/profile\/discussions\/\d+\/[^/]+$/, kind: 'deep' },
	{
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		kind: 'deep'
	},
	{ pattern: /^\/profile\/invitations$/, kind: 'deep' },
	{ pattern: /^\/admin$/, kind: 'deep' },
	{
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
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
	// /messages/add/[userId] shares MessageCompose with /messages/new and mounts
	// NavPipelineHost centerTab={2}, so the Messages pill highlights at rest on
	// SSR/first-paint (before configure flips pager.active). Mirrors /messages/new.
	{ pattern: /^\/messages\/add\//, pillTarget: 'messages' },

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
// Classifiers.
//
// Most of the classifier surface lives in the core `RouteData` record
// or the consumer configs above. The remaining functions below are
// positional queries (`isPagerRoute`), consumer-config reads
// (`getCurrentTabIndex`), and the non-route classifier
// `backTargetListKind`.

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
