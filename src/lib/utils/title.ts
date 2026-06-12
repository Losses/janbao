import { env } from '$env/dynamic/public';

export function getSiteName(): string {
	return env.PUBLIC_SITE_NAME || 'Janbao';
}

export function formatTitle(pageTitle?: string): string {
	const siteName = getSiteName();
	return pageTitle ? `${pageTitle} - ${siteName}` : siteName;
}
