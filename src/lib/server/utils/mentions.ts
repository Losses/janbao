/**
 * Server-side mention resolution utility.
 *
 * Scans serialized Lexical JSON content strings for `@username` patterns,
 * queries the database for matching user records, and returns a map suitable
 * for passing to LexicalRenderer as the `mentionedUsers` prop.
 *
 * This centralises the mention-resolution logic so every load handler can
 * call a single function instead of duplicating regex + query code.
 */
import { users } from '../db/schema';
import { inArray } from 'drizzle-orm';
import { extractMentions } from '$lib/utils/mentions';
import type { D1Db } from '../db/index';
import type { MentionedUsersMap } from '$lib/types/mentions';

export type { MentionedUsersMap };

/**
 * Scan one or more Lexical JSON content strings for `@username` mentions,
 * resolve them against the users table, and return a map keyed by username.
 *
 * @param contentJsons  Array of serialized Lexical JSON strings to scan.
 * @param db            Drizzle D1 database instance.
 * @returns             Record<username, MentionedUserEntry>
 */
export async function resolveMentions(
	contentJsons: (string | null | undefined)[],
	db: D1Db
): Promise<MentionedUsersMap> {
	// 1. Collect all unique usernames from all content JSONs
	const allUsernames: string[] = [];
	const seen = new Set<string>();

	for (const json of contentJsons) {
		if (!json) continue;
		const mentions = extractMentions(json);
		for (const username of mentions) {
			if (!seen.has(username)) {
				seen.add(username);
				allUsernames.push(username);
			}
		}
	}

	if (allUsernames.length === 0) {
		return {};
	}

	// 2. Batch-query users by username
	const matchedUsers = await db
		.select({
			id: users.id,
			displayName: users.displayName,
			username: users.username,
			avatarFileId: users.avatarFileId
		})
		.from(users)
		.where(inArray(users.username, allUsernames));

	// 3. Build the map keyed by username
	const map: MentionedUsersMap = {};
	for (const u of matchedUsers) {
		map[u.username] = {
			id: u.id,
			displayName: u.displayName,
			username: u.username,
			avatarFileId: u.avatarFileId
		};
	}

	return map;
}
