import type { CookieSerializeOptions } from 'cookie';
import type { EditorPreferences } from '$lib/editor/prefs';

// --- Shared Component Types ---

/** Category item used by CategoryListWidget and sidebar store. */
export interface CategoryItem {
	slug: string;
	title: string;
}

/**
 * Canonical display subset of a user, shared by every avatar/name chip across
 * the app (post/reply/message author, activity actor, notification source,
 * search hit, online user, etc.). The server selects the raw avatar columns via
 * `userPreviewColumns` ($lib/server/db/dao/user-preview) and computes
 * `avatarUrl` server-side via `buildAvatarUrl` ($lib/utils/image), so the
 * client always renders a ready URL string (never builds one itself). Adding a
 * display field is a one-place change there + here, and every caller that
 * spreads the column-set picks it up.
 */
export interface UserPreview {
	id: number;
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

/**
 * Flat author-display fields (the `author*` prefix) for any row that JOINs users
 * as its author. Produced by spreading `authorPreviewColumns`
 * ($lib/server/db/dao/user-preview) into a query; domain types `extends
 * AuthorPreviewFields` so a field added to the column-set + this interface
 * reaches every author-bearing row automatically. Fields are non-null because
 * the author join is inner (a row always has an author).
 */
export interface AuthorPreviewFields {
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarUrl: string | null;
}

/**
 * Minimal user identity for rendering an avatar chip/card: id + name + avatar.
 * Shared base for online users, search/mention results, and viewer summaries.
 * Carries a ready `avatarUrl` (server-built).
 */
export interface UserCard {
	id: number;
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

/** Online user item used by ActiveUsersWall and active-users store. */
export type OnlineUser = UserCard;

/** Minimal user identity used by Header, sidebars, and user-facing molecules. */
export interface UserInfoSummary extends UserCard {
	groupSlug?: string | null;
}

/** Recipient display info for directed activities (User A -> User B). */
export interface RecipientInfo {
	displayName: string;
	username: string;
}

/**
 * The target user's columns needed by the shared profile header (avatar, name,
 * bio, and the statistics row). Email is deliberately excluded - it is fetched
 * alongside this but gated by the caller (guests never see it).
 */
export interface ProfileHeaderUser {
	id: number;
	username: string;
	displayName: string;
	bio: string | null;
	avatarFileId: string | null;
	signupTime: Date;
	lastActiveTime: Date;
	groupSlug: string;
	groupTitle: string;
	viewCount: number;
	isStealth: boolean;
	showEmail: boolean;
}

// --- Auth Types ---

export interface AuthRegisterBody {
	invitationCode?: string;
	username?: string;
	email?: string;
	password?: string;
	confirmPassword?: string;
	displayName?: string;
}

export interface AuthLoginBody {
	usernameOrEmail?: string;
	password?: string;
	rememberMe?: boolean;
}

export interface ApiResponse {
	success?: boolean;
	error?: string;
	userId?: number;
}

export interface SessionCookieOptions extends CookieSerializeOptions {
	path: string;
}

// --- Activity API Types ---

export interface ActivityCreateBody {
	contentJson?: string;
	recipientId?: number;
}

export interface ActivityDeleteBody {
	activityId?: number;
}

export interface ActivityCommentCreateBody {
	parentActivityId?: number;
	contentJson?: string;
}

export interface ActivityCommentsResponse {
	comments: ActivityCommentItem[];
}

export interface ActivityCommentItem extends AuthorPreviewFields {
	id: number;
	authorId: number;
	contentJson: string;
	createdAt: Date;
}

// A member of an isJoined activity (a user who registered that day). Names render
// as clickable profile links in the joined render pipeline.
export interface JoinedMember {
	userId: number;
	displayName: string;
	username: string;
	avatarUrl: string | null;
}

/**
 * A feed item as produced by the activity loaders. The union of what
 * ActivityRow and JoinedActivityRow consume. Shared between the server DAO
 * (`loadActivityPage`), the activity panel, and the mobile tab pager.
 */
export interface ActivityListItem extends AuthorPreviewFields {
	id: number;
	authorId: number;
	recipientId?: number | null;
	recipientDisplayName?: string | null;
	recipientUsername?: string | null;
	contentJson: string;
	createdAt: Date;
	commentCount: number;
	isJoined: boolean;
	joinedMembers: JoinedMember[];
}

// --- Profile Edit API Types ---

export interface ProfileEditBody {
	displayName?: string;
	email?: string;
	showEmail?: boolean;
	languagePreference?: string;
	username?: string;
	avatarFileId?: string;
	bio?: string;
}

export interface ProfilePasswordBody {
	currentPassword?: string;
	newPassword?: string;
}

export interface ProfilePreferencesBody {
	profileComment?: boolean;
	discussionReply?: boolean;
	discussionComment?: boolean;
	participatedComment?: boolean;
	mention?: boolean;
	bookmarkedDiscussionComment?: boolean;
	pushProfileComment?: boolean;
	pushDiscussionReply?: boolean;
	pushDiscussionComment?: boolean;
	pushParticipatedComment?: boolean;
	pushMention?: boolean;
	pushBookmarkedDiscussionComment?: boolean;
	pushMessage?: boolean;
}

export interface ProfileStealthBody {
	isStealth?: boolean;
}

/** Partial editor-preferences write body; every field optional + boolean. */
export type EditorPreferencesBody = Partial<EditorPreferences>;

// --- Generic API Response Types ---

export interface ApiSuccessResponse {
	success: boolean;
	id?: number;
}

export interface ApiErrorResponse {
	error: string;
}

export interface ApiResult {
	success?: boolean;
	error?: string;
	id?: number;
	fileId?: string;
	// Avatar uploads only: server-built avatar URL the client renders directly
	// (no client-side URL construction). Omitted for attachment uploads.
	avatarUrl?: string | null;
}

// --- Frontend Feedback Message Type ---

export interface FeedbackMessage {
	type: 'success' | 'error';
	text: string;
}

// --- Shared list/pagination option types ---

/** Limit + offset window shared by paginated list DAOs. */
export interface ListOffsetOptions {
	limit: number;
	offset: number;
}

// --- Notifications API Types ---

export interface NotificationItem {
	id: number;
	type: string;
	isRead: boolean;
	createdAt: Date;
	sourceUserId: number | null;
	sourceDisplayName: string | null;
	sourceUsername: string | null;
	sourceAvatarUrl: string | null;
	discussionId: number | null;
	discussionTitle: string | null;
	discussionSlug: string | null;
	replyId: number | null;
	activityId: number | null;
}

export interface NotificationMarkReadBody {
	ids?: number[];
	all?: boolean;
}

// --- Bookmarks List API Types ---

export interface BookmarkListItem {
	discussionId: number;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle: string;
	authorId: number;
	authorUsername: string;
	authorDisplayName: string;
	bookmarkedAt: Date;
}

export interface BookmarkToggleBody {
	discussionId?: number;
}

// --- Messaging API Types ---

export interface ConversationListItem {
	id: number;
	title: string;
	lastMessageAt: Date | null;
	lastMessagePreview: string | null;
	lastAuthorId: number | null;
	lastAuthorUsername: string | null;
	lastAuthorDisplayName: string | null;
	lastAuthorAvatarUrl: string | null;
	participantCount: number;
	messageCount: number;
	unreadCount: number;
}

export interface MessageItem extends AuthorPreviewFields {
	id: number;
	conversationId: number;
	authorId: number;
	contentJson: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ParticipantItem {
	userId: number;
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface MessageCreateBody {
	recipientIds?: number[];
	title?: string;
	contentJson?: string;
}

export interface AddParticipantBody {
	userId?: number;
}

export interface PostMessageBody {
	contentJson?: string;
}

// --- User Search API Types ---

export type UserSearchResult = UserCard;

// --- Drafts API Types ---

export interface DraftClearBody {
	contextType?: string;
	contextId?: number;
}

export interface DraftListItem {
	id: number;
	contextType: string;
	contextId: number | null;
	contentJson: string;
	updatedAt: Date;
}

// --- Invitations API Types ---

export interface InvitationItem {
	code: string;
	creatorId: number;
	usedById: number | null;
	usedByUsername: string | null;
	createdAt: Date;
	expiresAt: Date;
	status: 'used' | 'unused' | 'expired';
}

// --- Password Recovery API Types ---

export interface AuthForgotPasswordBody {
	email?: string;
}

export interface AuthResetPasswordBody {
	token?: string;
	password?: string;
}

export interface AuthAdminGenerateResetBody {
	targetUserId?: number;
}

export interface AuthAdminGenerateResetResponse {
	success: boolean;
	resetLink: string;
	guidance: string;
}

// --- Admin Permission Management Types ---

export interface AdminUserGroupItem {
	slug: string;
	title: string;
	description: string;
	userCount: number;
	reserved: boolean;
}

export interface AdminCategoryItem {
	slug: string;
	title: string;
	description: string;
	priority: number;
	displayOrder: number;
	themeName: string | null;
	disabledAt: Date | null;
}

export interface AdminCategoryPermissionItem {
	categorySlug: string;
	groupSlug: string;
	canRead: boolean;
	canCreate: boolean;
	canUpdate: boolean;
	canDelete: boolean;
}

export interface AdminManageableGroupItem {
	slug: string;
	title: string;
}

export interface AdminUserGroupWriteBody {
	slug?: string;
	title?: string;
	description?: string;
}

export interface AdminUserGroupDeleteBody {
	slug?: string;
}

export interface AdminCategoryCreateBody {
	slug?: string;
	title?: string;
	description?: string;
	priority?: number;
	displayOrder?: number;
	themeName?: string | null;
}

export interface AdminCategoryUpdateBody {
	slug?: string;
	title?: string;
	description?: string;
	priority?: number;
	displayOrder?: number;
	themeName?: string | null;
	disabled?: boolean;
}

export interface AdminCategoryDeleteBody {
	slug?: string;
}

export interface AdminCategoryPermissionsUpdateBody {
	permissions?: AdminCategoryPermissionItem[];
}

export interface AdminUserGroupChangeBody {
	targetUserId?: number;
	groupSlug?: string;
}

export interface InvitationRequestResponse {
	success: boolean;
	code: string;
	inviteLink: string;
}

// --- Offline Sync (DV06 C02) ---

export interface SyncDiscussionDTO {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: number;
	updatedAt: number;
	lastReplyAt: number | null;
}

export interface SyncReplyDTO {
	id: number;
	discussionId: number;
	authorId: number;
	contentJson: string;
	createdAt: number;
	updatedAt: number;
	editedAt: number | null;
	editedBy: number | null;
}

export interface SyncTombstoneDTO {
	id: number;
	deletedAt: number;
}

// A root activity (no parent) for the offline activity feed. Only the first
// page is synced (snapshot semantics, no cursor). joinedMembers / mentions are
// intentionally not synced - the offline ActivityList degrades (no member
// roster, no @-chips). commentCount is computed per-row (the activities table
// has no denormalized count).
export interface SyncActivityDTO {
	id: number;
	authorId: number;
	recipientId: number | null;
	contentJson: string;
	createdAt: number;
	updatedAt: number | null;
	isJoined: boolean;
	commentCount: number;
}

// Author display info for the offline reader. One row per unique authorId
// referenced by the returned discussions + replies; the client caches it in
// IDB so avatars and names render offline without a server round-trip.
export type SyncUserDTO = UserPreview;

export interface SyncCursors {
	discussions: string;
	replies: string;
	discussionTombstoneCursor: string;
	replyTombstoneCursor: string;
}

// Curated category page-1 id sets returned by /api/sync/content. Each key is
// present only when the client requested it via ?categories= - the server never
// infers prefs (INV-7). Mirrors the three DiscussionSort values; consumers key
// directly into this to drive the client reason-tagging + refresh diff.
export interface CuratedDiscussionIdSets {
	latest?: number[];
	mostViewed?: number[];
	mostReplied?: number[];
}

export interface SyncHasMore {
	discussions: boolean;
	replies: boolean;
	tombstones: boolean;
}

export interface SyncContentResponse {
	discussions: SyncDiscussionDTO[];
	replies: SyncReplyDTO[];
	// First + last page of replies for front-page + bookmarked discussions,
	// backfilled past the 30-day lookback so old threads (incl. stale pinned
	// posts) are openable offline. Merged into the client replies store.
	backfillReplies: SyncReplyDTO[];
	// Discussions whose cached replies are endpoint-only (may have a middle
	// gap). The offline reader inserts an "N more not cached" divider for these
	// when commentCount exceeds the cached count.
	partialReplyDiscussionIds: number[];
	// First page of the activity feed (snapshot, no pagination/cursor).
	activities: SyncActivityDTO[];
	// Reply page size the server used when backfilling first/last pages, so the
	// offline reader can place the "N pages not cached" divider at the exact
	// first-page / last-page boundary.
	replyPageSize: number;
	users: SyncUserDTO[];
	discussionTombstones: SyncTombstoneDTO[];
	replyTombstones: SyncTombstoneDTO[];
	frontPageDiscussionIds: number[];
	bookmarkedDiscussionIds: number[];
	// DV07: page-1 discussion ids for each curated category the client asked
	// for via ?categories=. Omitted keys = category not requested (server is
	// stateless re: prefs, INV-7). The client mirrors these into syncMeta and
	// uses them as the refresh-diff source for the curated cache.
	curatedDiscussionIds: CuratedDiscussionIdSets;
	cursors: SyncCursors;
	hasMore: SyncHasMore;
	serverTimeSeconds: number;
	retentionDays: number;
}

export interface ReadStateDelta {
	discussionId: number;
	lastReadReplyId: number | null;
	lastReadPage: number;
	lastReadAt: number;
}

export interface SyncReadStateBody {
	deltas: ReadStateDelta[];
}

export interface ReadStateConflict {
	discussionId: number;
	serverLastReadAt: number;
	serverLastReadReplyId: number | null;
	serverLastReadPage: number;
}

export interface SyncReadStateResponse {
	applied: number;
	skipped: number;
	conflicts: ReadStateConflict[];
}

/** Subscription keys as posted by the browser PushManager. */
export interface PushSubscriptionKeys {
	p256dh: string;
	auth: string;
}

/** POST /api/push/subscribe body. */
export interface PushSubscribeBody {
	endpoint: string;
	keys: PushSubscriptionKeys;
}

/** POST /api/push/unsubscribe body. */
export interface PushUnsubscribeBody {
	endpoint: string;
}
