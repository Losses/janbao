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
