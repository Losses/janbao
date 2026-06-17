import type { UserCard } from '$lib/types/api';

/**
 * Shared type for the mentionedUsers map passed from server loaders
 * to LexicalRenderer for @username chip rendering.
 */
type MentionedUserEntry = UserCard;

interface MentionedUsersMap {
	[username: string]: MentionedUserEntry;
}

export type { MentionedUsersMap, MentionedUserEntry };
