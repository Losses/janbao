import type { TranslationDict } from '$lib/types/translation';

/**
 * Sentinel for the "System User" that authors automated activity (e.g. the
 * isJoined activity). Never a sign-in account. The single source of truth;
 * `$lib/server/constants` re-exports this symbol so server code that already
 * imports from there keeps a stable address.
 */
export const SYSTEM_USER_ID = -1;

/**
 * Sentinel for "original author no longer exists". Vanilla reserves UserID 0
 * for this (rendered as "Unknown"); we remap it onto -2 so the positive id
 * space - including id 0 (the seeded admin) - stays clear for real accounts.
 * The single source of truth; `$lib/server/constants` re-exports this symbol.
 */
export const GHOST_USER_ID = -2;

/**
 * True for an id that refers to a real user account. The bootstrap super admin
 * is id 0, so the guard excludes the two negative sentinels (System User -1,
 * Vanilla-import ghost -2) rather than requiring a positive id - a `> 0` check
 * wrongly drops the admin from recipient lists and sync hydration.
 */
export function isRealUserId(id: unknown): id is number {
	return (
		typeof id === 'number' && Number.isFinite(id) && id !== SYSTEM_USER_ID && id !== GHOST_USER_ID
	);
}

/**
 * Localizes a user's display name. If the user is the ghost/deleted user (ID -2)
 * or has no valid ID, it returns the localized "Unknown user" translation.
 */
export function formatDisplayName(
	displayName: string | null | undefined,
	userId: number | null | undefined,
	t: TranslationDict
): string {
	if (userId === GHOST_USER_ID || userId == null) {
		return t.offline.reader.unknownUser;
	}
	return displayName || t.offline.reader.unknownUser;
}
