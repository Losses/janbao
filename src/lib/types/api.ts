import type { CookieSerializeOptions } from 'cookie';

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
	userId?: string;
}

export interface SessionCookieOptions extends CookieSerializeOptions {
	path: string;
}

// --- Activity API Types ---

export interface ActivityCreateBody {
	contentJson?: string;
	recipientId?: string;
}

export interface ActivityDeleteBody {
	activityId?: string;
}

export interface ActivityCommentCreateBody {
	parentActivityId?: string;
	contentJson?: string;
}

export interface ActivityCommentsResponse {
	comments: ActivityCommentItem[];
}

export interface ActivityCommentItem {
	id: string;
	authorId: string;
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
	privateMessage?: boolean;
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
	id?: string;
}

export interface ApiErrorResponse {
	error: string;
}

export interface ApiResult {
	success?: boolean;
	error?: string;
	id?: string;
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
	id: string;
	type: string;
	isRead: boolean;
	createdAt: Date;
	sourceUserId: string | null;
	sourceDisplayName: string | null;
	sourceUsername: string | null;
	sourceAvatarFileId: string | null;
	discussionId: string | null;
	discussionTitle: string | null;
	discussionSlug: string | null;
	replyId: string | null;
	messageId: string | null;
	conversationId: string | null;
	activityId: string | null;
}

export interface NotificationMarkReadBody {
	ids?: string[];
	all?: boolean;
}

// --- Bookmarks List API Types ---

export interface BookmarkListItem {
	discussionId: string;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle: string;
	authorDisplayName: string;
	bookmarkedAt: Date;
}

// --- Messaging API Types ---

export interface ConversationListItem {
	id: string;
	title: string;
	lastMessageAt: Date | null;
	lastMessagePreview: string | null;
	lastAuthorDisplayName: string | null;
	participantCount: number;
	unreadCount: number;
}

export interface MessageItem {
	id: string;
	conversationId: string;
	authorId: string;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	contentJson: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ParticipantItem {
	userId: string;
	username: string;
	displayName: string;
	avatarFileId: string | null;
}

export interface MessageCreateBody {
	recipientIds?: string[];
	title?: string;
	contentJson?: string;
}

export interface AddParticipantBody {
	userId?: string;
}

export interface PostMessageBody {
	contentJson?: string;
}

// --- User Search API Types ---

export interface UserSearchResult {
	id: string;
	username: string;
	displayName: string;
	avatarFileId: string | null;
}

// --- Drafts API Types ---

export interface DraftClearBody {
	contextType?: string;
	contextId?: string;
}

export interface DraftListItem {
	id: string;
	contextType: string;
	contextId: string | null;
	contentJson: string;
	updatedAt: Date;
}

// --- Invitations API Types ---

export interface InvitationItem {
	code: string;
	creatorId: string;
	usedById: string | null;
	usedByUsername: string | null;
	createdAt: Date;
	expiresAt: Date;
	status: 'used' | 'unused' | 'expired';
}
