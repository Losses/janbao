// src/lib/utils/route-config.ts
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
import { getListCacheStore } from '$lib/stores/list-cache.svelte';
import type { TabsLayoutData } from '$lib/types/tabs';

export type { MobileTabLabelKey, PathMatcher } from './tab-config';

export type ParentRouteResolver = (path: string) => string;

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

export interface FabRouteConfigMetadata {
	readonly family: 'list' | 'overlay' | 'compose';
	readonly kind: FabListKind | 'dynamic' | 'deep' | null;
}

// Preview panels source their own data from the page store / list-cache store,
// so the slot holds a prop-less Svelte component.
export type SvelteComponentType = Component;

export interface BaseRouteConfig {
	readonly pattern: RegExp;
	readonly getParent?: ParentRouteResolver;
	readonly previewPanel?: SvelteComponentType;
	readonly fab?: FabRouteConfigMetadata;
	/** The module tab this route belongs to, for routes with no FAB of their own
	 *  (the offline readers, the standalone discussions pagination route). FAB
	 *  routes derive their tab from `fab.kind` instead. */
	readonly tab?: MobileTabLabelKey;
}

export interface DeepRouteConfig extends BaseRouteConfig {
	readonly getParent: ParentRouteResolver;
}

export type RouteConfig = BaseRouteConfig;

export const ROUTE_CONFIGS: readonly BaseRouteConfig[] = [
	// --- Deep Routes (Panel routes) ---
	// Non-FAB GesturePageLayout routes carry fab: { family: 'overlay', kind: 'deep' }
	// so the FAB atom stays mounted at scale 0 and the overlay-family sampler drives
	// its scale across the list<->deep boundary. See docs/FAB-Deep-Boundary-Fix-Plan.md.
	{
		pattern: /^\/bookmarks$/,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		pattern: /^\/search$/,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		pattern: /^\/notifications$/,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		pattern: /^\/profile$/,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		pattern: /^\/profile\/settings$/,
		getParent: () => '/',
		previewPanel: SettingsMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// /profile/[userId]/[userSlug]
		pattern: /^\/profile\/\d+\/[^/]+$/,
		getParent: () => '/profile',
		previewPanel: ProfileMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// /profile/comments/[userId]/[userSlug]
		pattern: /^\/profile\/comments\/\d+\/[^/]+$/,
		getParent: (path) => {
			const m = path.match(/^\/profile\/comments\/(\d+)\/([^/]+)/);
			return m ? `/profile/${m[1]}/${m[2]}` : '/profile';
		},
		previewPanel: ProfileMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// /profile/discussions/[userId]/[userSlug]
		pattern: /^\/profile\/discussions\/\d+\/[^/]+$/,
		getParent: (path) => {
			const m = path.match(/^\/profile\/discussions\/(\d+)\/([^/]+)/);
			return m ? `/profile/${m[1]}/${m[2]}` : '/profile';
		},
		previewPanel: ProfileMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// Sub-settings pages
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		getParent: () => '/profile/settings',
		previewPanel: SettingsMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// Invitations page
		pattern: /^\/profile\/invitations$/,
		getParent: () => '/profile',
		previewPanel: ProfileMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// Sub-admin pages
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
		getParent: () => '/admin',
		previewPanel: AdminMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},
	{
		// Admin main menu page
		pattern: /^\/admin$/,
		getParent: () => '/',
		previewPanel: AdminMenuPanel,
		fab: { family: 'overlay', kind: 'deep' }
	},

	// --- FAB Routes ---
	{
		pattern: /^\/discussion\//,
		fab: { family: 'overlay', kind: 'discussions' }
	},
	{
		pattern: /^\/messages\/\d/,
		fab: { family: 'overlay', kind: 'messages' }
	},
	{
		pattern: /^\/post\/discussion$/,
		getParent: () => '/',
		fab: { family: 'compose', kind: 'discussions' }
	},
	{
		pattern: /^\/messages\/new$/,
		getParent: () => '/messages/inbox',
		fab: { family: 'compose', kind: 'messages' }
	},
	{
		pattern: /^\/activity$/,
		fab: { family: 'list', kind: 'dynamic' }
	},
	{
		pattern: /^\/$/,
		fab: { family: 'list', kind: 'discussions' }
	},
	{
		pattern: /^\/messages\/inbox$/,
		fab: { family: 'list', kind: 'messages' }
	},

	// --- Tab-associated routes without a FAB ---
	// These declare their module tab directly (no `fab`), so getRouteFabRule
	// skips them (no FAB shown) but getRouteRule / getCurrentTabIndex resolve
	// them onto their tab. Order matters: /offline/activity before /offline.
	{
		pattern: /^\/discussions\/p\d+$/,
		tab: 'discussions'
	},
	{
		pattern: /^\/offline\/activity/,
		tab: 'activity'
	},
	{
		pattern: /^\/offline/,
		tab: 'discussions'
	}
];

export const DEEP_ROUTES: readonly DeepRouteConfig[] = ROUTE_CONFIGS.filter(
	(r): r is DeepRouteConfig => r.getParent !== undefined
);

export function getRouteFabRule(pathname: string): BaseRouteConfig | null {
	return ROUTE_CONFIGS.find((r) => r.fab !== undefined && r.pattern.test(pathname)) ?? null;
}

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

/** Thread or conversation route (covers the list with an overlay). A `deep`
 *  route reuses the overlay family for the FAB sampler but is not itself a
 *  thread/conversation, so it is excluded here to keep the predicate's meaning. */
export function isOverlayRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'overlay' && rule.fab?.kind !== 'deep' : false;
}

/** Compose route (mounts a GesturePageLayout that publishes coverProgress; the
 *  FAB reads it like the overlay family). */
export function isComposeRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'compose' : false;
}

/**
 * A route whose +page.svelte mounts a GesturePageLayout, so it owns the
 * horizontal gesture and DualColumnLayout's tab-swipe must yield to it. True
 * for overlay routes (thread / conversation) and every deep route in
 * DEEP_ROUTES, which (now that the compose forms carry getParent) includes the
 * compose forms too: compose is a module child like a thread. Pager routes are
 * not GPL-mounted (the MobileTabPager owns their gesture) and are excluded by
 * the consumer's own isPagerRoute check.
 */
export function isGesturePageLayoutRoute(pathname: string): boolean {
	return isOverlayRoute(pathname) || DEEP_ROUTES.some((r) => r.pattern.test(pathname));
}

/**
 * The source-list FAB shown on an overlay or compose route (Family B/C). The
 * thread under `/discussion/*` and the compose form under `/post/discussion`
 * both originate from the discussions list; `/messages/<id>` and `/messages/new`
 * both originate from the messages inbox. Returns null when the route is
 * neither overlay nor compose (the layer resolves the list FAB directly).
 */
export function sourceListKindForOverlayOrCompose(pathname: string): FabListKind | null {
	const rule = getRouteFabRule(pathname);
	if (
		!rule ||
		!rule.fab ||
		rule.fab.family === 'list' ||
		rule.fab.kind === 'dynamic' ||
		rule.fab.kind === 'deep'
	)
		return null;
	return rule.fab.kind;
}

/** Discussions list tab route. */
export function isDiscussionsListRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'list' && rule.fab?.kind === 'discussions' : false;
}

/** Messages inbox tab route. */
export function isMessagesListRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'list' && rule.fab?.kind === 'messages' : false;
}

// ---------------------------------------------------------------------------
// Mobile tabs: the browser-side tier of tab knowledge.
//
// tab-config.ts is the pure source (tab order, hrefs, prefix matchers, data
// keys); navigation-logic imports it for unit tests. Here we layer the
// browser-only bits on top: the list-cache populated check (a $state store),
// the list panel component, and the config-driven route->tab resolver. The
// store is read lazily inside the closures, so importing this module (incl.
// under bun:test) never instantiates it.

/** First ROUTE_CONFIGS entry whose pattern matches, regardless of FAB. */
function getRouteRule(pathname: string): BaseRouteConfig | null {
	return ROUTE_CONFIGS.find((r) => r.pattern.test(pathname)) ?? null;
}

/** A FAB kind names its module tab; `dynamic` is the Activity tab. */
function fabKindToLabelKey(
	kind: FabRouteConfigMetadata['kind'] | undefined
): MobileTabLabelKey | undefined {
	if (kind === 'discussions' || kind === 'messages') return kind;
	if (kind === 'dynamic') return 'activity';
	return undefined;
}

/**
 * Index of the module tab a pathname belongs to, or -1 when on no tab route.
 * Config-driven: a route's explicit `tab` wins, otherwise its FAB kind names
 * the tab, so the compose form /post/discussion (kind 'discussions'), the
 * offline readers, and the standalone /discussions/pN route all resolve the
 * same way as their tab root.
 */
export function getCurrentTabIndex(pathname: string): number {
	const rule = getRouteRule(pathname);
	const labelKey = rule?.tab ?? fabKindToLabelKey(rule?.fab?.kind);
	if (!labelKey) return -1;
	return MOBILE_TAB_DEFS.findIndex((tab) => tab.labelKey === labelKey);
}

/** True for the exact pager routes (where the MobileTabPager owns the swipe). */
export function isPagerRoute(pathname: string): boolean {
	return MOBILE_TAB_DEFS.some((tab) => tab.href === pathname);
}

// Each tab's list panel is a prop-less Component that pulls its data from the
// list-cache store and page data itself.
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
 * via `data` even on a deep page that never populated the list-cache store.
 * Reads the tab's declared dataKey/listKey, so no per-tab switch lives here.
 */
function tabListPopulated(tab: TabDef, data: Partial<TabsLayoutData>): boolean {
	const section = (data as Record<string, unknown>)[tab.dataKey] as
		| Record<string, unknown[]>
		| undefined;
	const list = section?.[tab.listKey];
	return list ? list.length > 0 : false;
}

export const MOBILE_TABS: readonly MobileTab[] = MOBILE_TAB_DEFS.map((tab) => ({
	...tab,
	checkCache: () => getListCacheStore().isPopulated(tab.labelKey),
	hasData: (data) => getListCacheStore().isPopulated(tab.labelKey) || tabListPopulated(tab, data),
	panel: TAB_LIST_PANELS[tab.labelKey]
}));
