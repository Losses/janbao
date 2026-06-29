import type { TranslationDict } from '$lib/types/translation';

/**
 * deep-header-config - the static titles for deep-page routes (routes with no
 * tab highlight, `getCurrentTabIndex(pathname) === -1`). The Header renders
 * these in deep mode (back arrow + title) instead of the tab bar.
 *
 * Each entry maps a pathname (exact, or a `/*` prefix for param routes) to a
 * resolver over the typed TranslationDict, so a wrong i18n key is a
 * compile-time error, not a blank title at runtime. Pure and runes-free (like
 * tab-config.ts) so it is SSR-safe and testable.
 *
 * Dynamic-title pages (`/profile/[userId]/[userSlug]`, `/category/[slug]`,
 * `/profile/discussions/[userId]/[userSlug]`) are NOT here: their titles are
 * runtime values, returned as `headerTitle` from the page's load and read via
 * `page.data.headerTitle`, which wins over this static fallback.
 */

type TitleResolver = (t: TranslationDict) => string;

interface DeepHeaderEntry {
	/** Pathname to match. Exact, unless it ends with `/*` (prefix match). */
	pattern: string;
	title: TitleResolver;
}

const ENTRIES: readonly DeepHeaderEntry[] = [
	{ pattern: '/bookmarks', title: (t) => t.bookmark.myBookmarks },
	{ pattern: '/notifications', title: (t) => t.notification.title },
	{ pattern: '/categories', title: (t) => t.nav.categories },
	{ pattern: '/drafts', title: (t) => t.draft.myDrafts },
	{ pattern: '/admin', title: (t) => t.admin.title },
	{ pattern: '/admin/categories', title: (t) => t.admin.categories },
	{ pattern: '/admin/permissions', title: (t) => t.admin.categoryPermissions },
	{ pattern: '/admin/user-groups', title: (t) => t.admin.userGroups },
	{ pattern: '/admin/stats', title: (t) => t.admin.stats },
	{ pattern: '/admin/backups', title: (t) => t.backup.title },
	{ pattern: '/admin/maintenance', title: (t) => t.maintenance.title },
	{ pattern: '/profile', title: (t) => t.profile.accountSettings },
	{ pattern: '/profile/preferences', title: (t) => t.profile.preferences },
	{ pattern: '/profile/appearance', title: (t) => t.profile.appearanceSettings.title },
	{ pattern: '/profile/settings', title: (t) => t.profile.accountSettings },
	{ pattern: '/profile/edit', title: (t) => t.profile.editAccount },
	{ pattern: '/profile/password', title: (t) => t.profile.changePassword },
	{ pattern: '/profile/picture', title: (t) => t.profile.avatar },
	{ pattern: '/profile/editor', title: (t) => t.profile.editorSettings.title },
	{ pattern: '/profile/onlineNow', title: (t) => t.profile.stealthSettings },
	{ pattern: '/profile/offlineReading', title: (t) => t.profile.offlineReading.title },
	{ pattern: '/profile/invitations', title: (t) => t.profile.invitations },
	{ pattern: '/profile/comments/*', title: (t) => t.profile.comments }
];

function matches(pattern: string, pathname: string): boolean {
	if (pattern.endsWith('/*')) {
		const prefix = pattern.slice(0, -1); // keep the trailing '/'
		return pathname.startsWith(prefix);
	}
	return pathname === pattern;
}

/**
 * Resolve the deep-page header title for a pathname, or null when the route is
 * either not a deep page or a dynamic-title page (which supplies its title via
 * `page.data.headerTitle`). Exact patterns win over `/*` prefixes.
 */
export function resolveDeepHeaderTitle(pathname: string, t: TranslationDict): string | null {
	// Exact matches first so `/profile` does not lose to a hypothetical prefix.
	for (const entry of ENTRIES) {
		if (!entry.pattern.endsWith('/*') && matches(entry.pattern, pathname)) {
			return entry.title(t);
		}
	}
	for (const entry of ENTRIES) {
		if (entry.pattern.endsWith('/*') && matches(entry.pattern, pathname)) {
			return entry.title(t);
		}
	}
	return null;
}
