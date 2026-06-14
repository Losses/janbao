import type { CookieSerializeOptions } from 'cookie';

// --- Shared Component Types ---

/** Category item used by CategoryListWidget and sidebar store. */
export interface CategoryItem {
	slug: string;
	title: string;
}

/** Online user item used by ActiveUsersWall and active-users store. */
export interface OnlineUser {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
}

/** Minimal user identity used by Header, sidebars, and user-facing molecules. */
export interface UserInfoSummary {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
	groupSlug?: string | null;
}

/** Recipient display info for directed activities (User A -> User B). */
export interface RecipientInfo {
	displayName: string;
	username: string;
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

export interface ActivityCommentItem {
	id: number;
	authorId: number;
	contentJson: string;
	createdAt: Date;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
}

// --- Profile Edit API Types ---

export interface ProfileEditBody {
	displayName?: string;
	email?: string;
	showEmail?: boolean;
	languagePreference?: string;
	username?: string;
	avatarFileId?: string;
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
}

export interface ProfileStealthBody {
	isStealth?: boolean;
}

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
	sourceAvatarFileId: string | null;
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
	lastAuthorAvatarFileId: string | null;
	participantCount: number;
	messageCount: number;
	unreadCount: number;
}

export interface MessageItem {
	id: number;
	conversationId: number;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	contentJson: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ParticipantItem {
	userId: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
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

export interface UserSearchResult {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
}

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
}
