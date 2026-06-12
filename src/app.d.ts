/// <reference types="@cloudflare/workers-types" />
import type { D1Db } from '$lib/server/db';
import type en from '$lib/i18n/en.json';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			db: D1Db;
			user: {
				id: string;
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
			} | null;
			lang: string;
			t: typeof en; // Translation dictionary object
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				D1_DB?: D1Database;
				JWT_SECRET: string;
				ADMIN_EMAIL?: string;
				ADMIN_PASSWORD?: string;
				MONTHLY_INVITATION_LIMIT?: string;
			};
		}
	}
}

export {};
