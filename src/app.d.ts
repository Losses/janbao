/// <reference types="@cloudflare/workers-types" />
import type { D1Db } from '$lib/server/db';
import type { TranslationDict } from '$lib/types/translation';
import type { EditorPreferences } from '$lib/editor/prefs';
import type { UiPreferences } from '$lib/ui/prefs';

interface PlatformEnv {
	D1_DB?: D1Database;
	JWT_SECRET: string;
	PUBLIC_SITE_NAME?: string;
	PUBLIC_SITE_SHORT_NAME?: string;
	PUBLIC_SITE_DESCRIPTION?: string;
	PUBLIC_BRANDED_FIRST_TAB?: string;
	ADMIN_EMAIL?: string;
	ADMIN_PASSWORD?: string;
	MONTHLY_INVITATION_LIMIT?: string;
	FORUM_TIMEZONE?: string;
	WELCOME_TEXT?: string;
	PCLOUD_USERNAME?: string;
	PCLOUD_PASSWORD?: string;
	PCLOUD_WEBDAV_HOST?: string;
	PCLOUD_BASE_PATH?: string;
	DISCUSSIONS_LIMIT?: string;
	PAGINATION_LIMIT?: string;
	ACTIVITIES_LIMIT?: string;
	ALLOW_SLUG_CHANGE?: string;
	ALLOW_GUEST_ACTIVITY?: string;
	POST_THROTTLE_WINDOW_SEC?: string;
	POST_THROTTLE_LIMIT?: string;
	SITE_URL?: string;
	OFFLINE_RETENTION_DAYS?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
}

type WaitUntilFn = (promise: Promise<unknown>) => void;

interface PlatformContext {
	waitUntil: WaitUntilFn;
}

interface UserData {
	id: number;
	username: string;
	email: string;
	displayName: string;
	bio: string | null;
	avatarFileId: string | null;
	groupSlug: string;
	signupTime: Date;
	lastActiveTime: Date;
	showEmail: boolean;
	languagePreference: string;
	isStealth: boolean;
	rssToken: string;
	viewCount: number;
	editorPreferences: EditorPreferences;
	uiPreferences: UiPreferences;
}

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			db: D1Db;
			user: UserData | null;
			lang: string;
			t: TranslationDict;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: PlatformEnv;
			context?: PlatformContext;
		}
	}
}

export {};
