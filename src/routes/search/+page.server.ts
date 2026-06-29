import type { PageServerLoad } from './$types';
import { resolveGroupSlug, getAllowGuestUserSearch } from '$lib/server/constants';
import {
	searchDiscussions,
	searchActivities,
	searchMessages,
	searchUsers
} from '$lib/server/db/dao/search';
import type {
	DiscussionSearchItem,
	ActivitySearchItem,
	MessageSearchItem,
	UserSearchItem,
	SearchSort
} from '$lib/server/db/dao/search';
import { SEARCH_SCOPES, type SearchScope } from '$lib/types/search';
import { normalizeSearchSort } from '$lib/utils/search-sort';

const SORTS: SearchSort[] = ['newest', 'oldest', 'relevance', 'replies'];

interface SearchLoadData {
	query: string;
	scope: SearchScope;
	sort: SearchSort;
	page: number;
	totalPages: number;
	total: number;
	usedFallback: boolean;
	discussions: DiscussionSearchItem[] | null;
	activities: ActivitySearchItem[] | null;
	messages: MessageSearchItem[] | null;
	users: UserSearchItem[] | null;
}

function emptyResult(query: string, scope: SearchScope, sort: SearchSort): SearchLoadData {
	return {
		query,
		scope,
		sort,
		page: 1,
		totalPages: 0,
		total: 0,
		usedFallback: false,
		discussions: null,
		activities: null,
		messages: null,
		users: null
	};
}

function parseScope(value: string | null): SearchScope {
	return SEARCH_SCOPES.includes(value as SearchScope) ? (value as SearchScope) : 'discussions';
}

function parseSort(value: string | null): SearchSort {
	return SORTS.includes(value as SearchSort) ? (value as SearchSort) : 'newest';
}

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const user = event.locals.user;
	const platformEnv = event.platform?.env;

	const q = event.url.searchParams.get('q') ?? '';
	const scope = parseScope(event.url.searchParams.get('scope'));
	const sort = normalizeSearchSort(parseSort(event.url.searchParams.get('sort')), scope);
	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) page = 1;

	if (q.trim().length === 0) {
		return emptyResult(q, scope, sort);
	}

	// Activity and message search require a signed-in user (they key on userId
	// for visibility). Discussions are searchable by guests, filtered by category
	// read permissions inside the DAO.
	if (scope === 'activities') {
		if (!user) return emptyResult(q, scope, sort);
		const r = await searchActivities(db, q, user.id, page, platformEnv, sort);
		return {
			query: q,
			scope,
			sort,
			page: r.page,
			totalPages: r.totalPages,
			total: r.total,
			usedFallback: r.usedFallback,
			discussions: null,
			activities: r.results,
			messages: null,
			users: null
		};
	}

	if (scope === 'messages') {
		if (!user) return emptyResult(q, scope, sort);
		const r = await searchMessages(db, q, user.id, page, platformEnv, sort);
		return {
			query: q,
			scope,
			sort,
			page: r.page,
			totalPages: r.totalPages,
			total: r.total,
			usedFallback: r.usedFallback,
			discussions: null,
			activities: null,
			messages: r.results,
			users: null
		};
	}

	if (scope === 'users') {
		// Guests need an explicit opt-in; logged-in users can always search users.
		if (!user && !getAllowGuestUserSearch(platformEnv)) {
			return emptyResult(q, scope, sort);
		}
		const r = await searchUsers(db, q, page, platformEnv, sort);
		return {
			query: q,
			scope,
			sort,
			page: r.page,
			totalPages: r.totalPages,
			total: r.total,
			usedFallback: r.usedFallback,
			discussions: null,
			activities: null,
			messages: null,
			users: r.results
		};
	}

	const groupSlug = resolveGroupSlug(user);
	const r = await searchDiscussions(db, q, user?.id ?? null, groupSlug, page, platformEnv, sort);
	return {
		query: q,
		scope,
		sort,
		page: r.page,
		totalPages: r.totalPages,
		total: r.total,
		usedFallback: r.usedFallback,
		discussions: r.results,
		activities: null,
		messages: null,
		users: null
	};
};
