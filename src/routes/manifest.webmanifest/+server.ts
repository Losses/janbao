import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

export const GET: RequestHandler = async (event) => {
	const platformEnv = event.platform?.env;

	const siteName =
		platformEnv?.PUBLIC_SITE_NAME ||
		env.PUBLIC_SITE_NAME ||
		process.env.PUBLIC_SITE_NAME ||
		'Janbao';

	const shortName =
		platformEnv?.PUBLIC_SITE_SHORT_NAME ||
		env.PUBLIC_SITE_SHORT_NAME ||
		process.env.PUBLIC_SITE_SHORT_NAME ||
		siteName;

	const description =
		platformEnv?.PUBLIC_SITE_DESCRIPTION ||
		env.PUBLIC_SITE_DESCRIPTION ||
		process.env.PUBLIC_SITE_DESCRIPTION ||
		`${siteName}`;

	const manifest = {
		name: siteName,
		short_name: shortName,
		description: description,
		start_url: '/',
		scope: '/',
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#ffb257',
		lang: 'en',
		categories: ['social'],
		icons: [
			{
				src: '/icons/icon-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: '/icons/icon-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: '/icons/icon-192-maskable.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'maskable'
			},
			{
				src: '/icons/icon-512-maskable.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			}
		]
	};

	return new Response(JSON.stringify(manifest, null, 2), {
		headers: {
			'Content-Type': 'application/manifest+json; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
