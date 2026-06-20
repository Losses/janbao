import type { TranslationDict } from '$lib/types/translation';

export const GHOST_USER_ID = -2;
export const SYSTEM_USER_ID = -1;

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
