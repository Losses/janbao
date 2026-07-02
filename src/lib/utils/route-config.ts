// src/lib/utils/route-config.ts
import type { Component } from 'svelte';
import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
import { mdiPlus, mdiEmailPlus } from '@mdi/js';
import type { TranslationDict } from '$lib/types/translation';

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

/** Compose route (no pager, no track to sample). */
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
