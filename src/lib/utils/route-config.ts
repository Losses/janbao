// src/lib/utils/route-config.ts
import type { Component } from 'svelte';
import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';

export type ParentRouteResolver = (path: string) => string;
export type PreviewPropsResolver = (data: Record<string, unknown>) => Record<string, unknown>;

export interface RouteConfig {
	pattern: RegExp;
	getParent: ParentRouteResolver;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	previewPanel?: Component<any, any, any>;
	getPreviewProps?: PreviewPropsResolver;
}

export const DEEP_ROUTES: readonly RouteConfig[] = [
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
	}
];
