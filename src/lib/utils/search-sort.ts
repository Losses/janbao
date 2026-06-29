import type { SearchScope, SearchSort } from '$lib/types/search';

/**
 * `replies` is a valid sort only for the discussions scope (the only scope with
 * a reply count). On any other scope it is normalized to `newest` so the
 * returned `sort` matches the ordering the DAO actually applied (the DAO
 * default-branch would otherwise silently fall back). Pure so it is unit-testable.
 */
export function normalizeSearchSort(sort: SearchSort, scope: SearchScope): SearchSort {
	return scope !== 'discussions' && sort === 'replies' ? 'newest' : sort;
}
