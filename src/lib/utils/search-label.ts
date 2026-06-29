import type { SearchScope } from '$lib/types/search';
import type { TranslationDict } from '$lib/types/translation';

type SearchI18n = TranslationDict['search'];

/** The localized label for a search scope. Shared by the desktop scope chips
 *  and the mobile SearchTabBar so the per-scope wording lives in one place. */
export function searchScopeLabel(scope: SearchScope, t: SearchI18n): string {
	if (scope === 'activities') return t.scopeActivities;
	if (scope === 'messages') return t.scopeMessages;
	if (scope === 'users') return t.scopeUsers;
	return t.scopeDiscussions;
}
