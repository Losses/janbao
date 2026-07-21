// Pure-function unit tests for the offline author join layer. Pins the
// CachedUser nullable contract: a row whose display fields are `null` (deleted
// account, partial cache, server join that yielded null) must flow through the
// join as `null`, never as an English literal. The reader applies its
// localized `unknownUser` fallback at render time; baking English in at the
// IDB/join layer would surface `'user'` to non-English users.
import { test, expect } from 'bun:test';
import { joinDiscussions, joinReplies, lookupAuthor } from './join';
import type { CachedAuthorProjection, CachedDiscussion, CachedReply } from './types';

// Minimal-but-valid CachedDiscussion row. Fields not under test are populated
// with representative values; only authorId + the joined projection matter for
// lookupAuthor's contract.
function sampleDiscussion(id: number, authorId: number): CachedDiscussion {
	return {
		id,
		title: 't',
		slug: 's',
		categorySlug: 'c',
		authorId,
		commentCount: 0,
		isPinned: false,
		createdAt: 0,
		updatedAt: 0,
		lastReplyAt: null,
		cachedAt: 0
	};
}

function sampleReply(id: number, discussionId: number, authorId: number): CachedReply {
	return {
		id,
		discussionId,
		authorId,
		contentJson: '{}',
		createdAt: 0,
		updatedAt: 0,
		editedAt: null,
		editedBy: null,
		cachedAt: 0
	};
}

test('lookupAuthor: returns null fields for a projection with null display info', () => {
	const map = new Map<number, CachedAuthorProjection>([
		[7, { displayName: null, username: null, avatarUrl: null }]
	]);
	const result = lookupAuthor(map, 7);
	expect(result).toEqual({ displayName: null, username: null, avatarUrl: null });
});

test('lookupAuthor: returns the NULL_AUTHOR sentinel for an unknown id', () => {
	const map = new Map<number, CachedAuthorProjection>();
	const result = lookupAuthor(map, 999);
	expect(result).toEqual({ displayName: null, username: null, avatarUrl: null });
});

test('lookupAuthor: returns NULL_AUTHOR for a null / undefined id', () => {
	const map = new Map<number, CachedAuthorProjection>([
		[0, { displayName: 'Admin', username: 'admin', avatarUrl: null }]
	]);
	expect(lookupAuthor(map, null)).toEqual({ displayName: null, username: null, avatarUrl: null });
	expect(lookupAuthor(map, undefined)).toEqual({
		displayName: null,
		username: null,
		avatarUrl: null
	});
});

test('lookupAuthor: never substitutes the English literal "user" for missing fields', () => {
	const map = new Map<number, CachedAuthorProjection>([
		[5, { displayName: null, username: null, avatarUrl: null }]
	]);
	const result = lookupAuthor(map, 5);
	expect(result.displayName).not.toBe('user');
	expect(result.username).not.toBe('user');
	// Contract: the field stays null so the reader's localized fallback applies.
	expect(result.displayName).toBeNull();
	expect(result.username).toBeNull();
});

test('joinDiscussions: a null-bearing CachedAuthorProjection flows through unchanged', () => {
	const map = new Map<number, CachedAuthorProjection>([
		[3, { displayName: null, username: null, avatarUrl: null }]
	]);
	const [joined] = joinDiscussions([sampleDiscussion(1, 3)], map);
	expect(joined.author).toEqual({ displayName: null, username: null, avatarUrl: null });
});

test('joinReplies: a null-bearing CachedAuthorProjection flows through unchanged', () => {
	const map = new Map<number, CachedAuthorProjection>([
		[9, { displayName: null, username: null, avatarUrl: null }]
	]);
	const [joined] = joinReplies([sampleReply(11, 1, 9)], map);
	expect(joined.author).toEqual({ displayName: null, username: null, avatarUrl: null });
});
