/// <reference types="@cloudflare/workers-types" />
import type { D1Db } from '$lib/server/db';
import type { TranslationDict } from '$lib/types/translation';

interface PlatformEnv {
	D1_DB?: D1Database;
	JWT_SECRET: string;
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
	avatarFileId: string | null;
	groupSlug: string;
	signupTime: Date;
	lastActiveTime: Date;
	showEmail: boolean;
	languagePreference: string;
	isStealth: boolean;
	rssToken: string;
	viewCount: number;
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
