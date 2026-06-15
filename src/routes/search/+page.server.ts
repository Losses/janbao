import type { PageServerLoad } from './$types';
import { resolveGroupSlug } from '$lib/server/constants';
import { searchDiscussions, searchActivities, searchMessages } from '$lib/server/db/dao/search';
import type {
	DiscussionSearchItem,
	ActivitySearchItem,
	MessageSearchItem,
	SearchSort
} from '$lib/server/db/dao/search';

type SearchScope = 'discussions' | 'activities' | 'messages';

const SCOPES: SearchScope[] = ['discussions', 'activities', 'messages'];
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
		messages: null
	};
}

function parseScope(value: string | null): SearchScope {
	return SCOPES.includes(value as SearchScope) ? (value as SearchScope) : 'discussions';
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
	const sort = parseSort(event.url.searchParams.get('sort'));
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
			messages: null
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
			messages: r.results
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
		messages: null
	};
};
