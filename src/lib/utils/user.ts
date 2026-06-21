import type { TranslationDict } from '$lib/types/translation';

export const GHOST_USER_ID = -2;
export const SYSTEM_USER_ID = -1;

/**
 * True for an id that refers to a real user account. The bootstrap super admin
 * is id 0, so the guard excludes the two negative sentinels (System User -1,
 * Vanilla-import ghost -2) rather than requiring a positive id — a `> 0` check
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
