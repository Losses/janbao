// src/lib/utils/route-config.ts
import type { Component } from 'svelte';
import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
import { mdiPlus, mdiEmailPlus } from '@mdi/js';
import type { TranslationDict } from '$lib/types/translation';

export type ParentRouteResolver = (path: string) => string;
export type PreviewPropsResolver = (data: Record<string, unknown>) => Record<string, unknown>;

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
	readonly kind: FabListKind | 'dynamic' | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SvelteComponentType = Component<any, any, any>;

export interface BaseRouteConfig {
	readonly pattern: RegExp;
	readonly getParent?: ParentRouteResolver;
	readonly previewPanel?: SvelteComponentType;
	readonly getPreviewProps?: PreviewPropsResolver;
	readonly fab?: FabRouteConfigMetadata;
}

export interface DeepRouteConfig extends BaseRouteConfig {
	readonly getParent: ParentRouteResolver;
}

export type RouteConfig = BaseRouteConfig;

export const ROUTE_CONFIGS: readonly BaseRouteConfig[] = [
	// --- Deep Routes (Panel routes) ---
	{
		pattern: /^\/profile\/settings$/,
		getParent: () => '/',
		previewPanel: SettingsMenuPanel
	},
	{
		// /profile/[userId]/[userSlug]
		pattern: /^\/profile\/\d+\/[^/]+$/,
		getParent: () => '/profile',
		previewPanel: ProfileMenuPanel,
		getPreviewProps: (data) => {
			const payload = data.headerPayload as Record<string, unknown> | undefined;
			return {
				user: payload?.user ?? data.user
			};
		}
	},
	{
		// /profile/comments/[userId]/[userSlug]
		pattern: /^\/profile\/comments\/\d+\/[^/]+$/,
		getParent: (path) => {
			const m = path.match(/^\/profile\/comments\/(\d+)\/([^/]+)/);
			return m ? `/profile/${m[1]}/${m[2]}` : '/profile';
		},
		previewPanel: ProfileMenuPanel,
		getPreviewProps: (data) => ({
			user: data.targetUser ?? data.user
		})
	},
	{
		// /profile/discussions/[userId]/[userSlug]
		pattern: /^\/profile\/discussions\/\d+\/[^/]+$/,
		getParent: (path) => {
			const m = path.match(/^\/profile\/discussions\/(\d+)\/([^/]+)/);
			return m ? `/profile/${m[1]}/${m[2]}` : '/profile';
		},
		previewPanel: ProfileMenuPanel,
		getPreviewProps: (data) => ({
			user: data.targetUser ?? data.user
		})
	},
	{
		// Sub-settings pages
		pattern:
			/^\/profile\/(?:appearance|edit|editor|offlineReading|onlineNow|password|picture|preferences)$/,
		getParent: () => '/profile/settings',
		previewPanel: SettingsMenuPanel
	},
	{
		// Invitations page
		pattern: /^\/profile\/invitations$/,
		getParent: () => '/profile',
		previewPanel: ProfileMenuPanel
	},
	{
		// Sub-admin pages
		pattern: /^\/admin\/(?:backups|categories|maintenance|permissions|stats|user-groups)$/,
		getParent: () => '/admin',
		previewPanel: AdminMenuPanel
	},
	{
		// Admin main menu page
		pattern: /^\/admin$/,
		getParent: () => '/',
		previewPanel: AdminMenuPanel
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
		fab: { family: 'compose', kind: 'discussions' }
	},
	{
		pattern: /^\/messages\/new$/,
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

/** Thread or conversation route (covers the list with an overlay). */
export function isOverlayRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'overlay' : false;
}

/** Compose route (no pager, no track to sample). */
export function isComposeRoute(pathname: string): boolean {
	const rule = getRouteFabRule(pathname);
	return rule ? rule.fab?.family === 'compose' : false;
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
	if (!rule || !rule.fab || rule.fab.family === 'list' || rule.fab.kind === 'dynamic') return null;
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
