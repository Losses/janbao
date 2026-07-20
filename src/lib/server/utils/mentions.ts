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
import { buildAvatarUrl } from '$lib/utils/image';
import { isRealUserId } from '$lib/utils/user';
import type { D1Db } from '../db/index';
import type { MentionedUsersMap } from '$lib/types/mentions';

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
			avatarFileId: users.avatarFileId,
			avatarContentType: users.avatarContentType
		})
		.from(users)
		.where(inArray(users.username, allUsernames));

	// 3. Build the map keyed by username. Sentinel accounts (System -1, Ghost
	//    -2) are skipped so @system / @<ghost-username> never render as a chip
	//    linking to a non-social profile. The author's literal text is preserved
	//    by the editor (it stays as plain "@system" in the rendered content);
	//    only the chip affordance is suppressed. This matches the typeahead
	//    contract (sentinels never appear in /api/users/search results).
	const map: MentionedUsersMap = {};
	for (const u of matchedUsers) {
		if (!isRealUserId(u.id)) continue;
		map[u.username] = {
			id: u.id,
			displayName: u.displayName,
			username: u.username,
			avatarUrl: buildAvatarUrl(u.id, u.avatarFileId, u.avatarContentType)
		};
	}

	return map;
}
