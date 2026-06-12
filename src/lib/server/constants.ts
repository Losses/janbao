const DEV_JWT_SECRET = 'fallback-secret-key-for-local-dev-only';

export function getJwtSecret(platformEnv: App.Platform['env'] | undefined): string {
	const secret = platformEnv?.JWT_SECRET;
	if (!secret) {
		console.warn(
			'[SECURITY WARNING] JWT_SECRET is not set. Using insecure fallback. Never deploy this to production.'
		);
		return DEV_JWT_SECRET;
	}
	return secret;
}

export function getCookieSecure(url: URL): boolean {
	return url.protocol === 'https:';
}

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Pagination limit helpers. Read from platform env (Cloudflare) or process.env (local),
 * falling back to spec defaults.
 */
export function getDiscussionsLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.DISCUSSIONS_LIMIT || process.env.DISCUSSIONS_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 20;
}

export function getPaginationLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.PAGINATION_LIMIT || process.env.PAGINATION_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 50;
}

export function getActivitiesLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.ACTIVITIES_LIMIT || process.env.ACTIVITIES_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 15;
}
