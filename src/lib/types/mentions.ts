/**
 * Shared type for the mentionedUsers map passed from server loaders
 * to LexicalRenderer for @username chip rendering.
 */
interface MentionedUserEntry {
	id: number;
	displayName: string;
	username: string;
	avatarFileId: string | null;
}

interface MentionedUsersMap {
	[username: string]: MentionedUserEntry;
}

export type { MentionedUsersMap, MentionedUserEntry };
