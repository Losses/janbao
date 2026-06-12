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
