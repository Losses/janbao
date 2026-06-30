/**
 * fab-routes - pure (runes-free) path predicates that classify a route for the
 * Floating Action Button. Pure so unit-testable under `bun test`.
 *
 * A thread / conversation overlay (Family B) and a compose page (Family C) are
 * both reached by forward nav FROM a list; the FAB atom stays mounted across
 * the swap, showing the SOURCE LIST's FAB at foregroundFraction 0 at rest (the
 * destination page covers the list). A deep-link to `/discussion/<id>` SSRs at
 * foregroundFraction 0 so there is no flash of scale 1 even though its tab
 * index resolves to 0.
 */

export type FabListKind = 'discussions' | 'messages';

const DISCUSSION_PREFIX = '/discussion/';
const MESSAGES_NUMERIC_PREFIX = /^\/messages\/\d/;
const POST_DISCUSSION = '/post/discussion';
const MESSAGES_NEW = '/messages/new';
const DISCUSSIONS_LIST = '/';
const MESSAGES_LIST = '/messages/inbox';

/** Thread or conversation route (covers the list with an overlay). */
export function isOverlayRoute(pathname: string): boolean {
	return pathname.startsWith(DISCUSSION_PREFIX) || MESSAGES_NUMERIC_PREFIX.test(pathname);
}

/** Compose route (no pager, no track to sample). */
export function isComposeRoute(pathname: string): boolean {
	return pathname === POST_DISCUSSION || pathname === MESSAGES_NEW;
}

/**
 * The source-list FAB shown on an overlay or compose route (Family B/C). The
 * thread under `/discussion/*` and the compose form under `/post/discussion`
 * both originate from the discussions list; `/messages/<id>` and `/messages/new`
 * both originate from the messages inbox. Returns null when the route is
 * neither overlay nor compose (the layer resolves the list FAB directly).
 */
export function sourceListKindForOverlayOrCompose(pathname: string): FabListKind | null {
	if (pathname.startsWith(DISCUSSION_PREFIX) || pathname === POST_DISCUSSION) {
		return 'discussions';
	}
	if (MESSAGES_NUMERIC_PREFIX.test(pathname) || pathname === MESSAGES_NEW) {
		return 'messages';
	}
	return null;
}

/** Discussions list tab route. */
export function isDiscussionsListRoute(pathname: string): boolean {
	return pathname === DISCUSSIONS_LIST;
}

/** Messages inbox tab route. */
export function isMessagesListRoute(pathname: string): boolean {
	return pathname === MESSAGES_LIST;
}
