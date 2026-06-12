import type { RequestHandler } from './$types';
import { categories, categoryPermissions, discussions, users } from '$lib/server/db/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { formatTitle } from '$lib/utils/title';
import { XMLBuilder } from 'fast-xml-parser';

export const GET: RequestHandler = async (event) => {
	const { categorySlug } = event.params;
	const token = event.url.searchParams.get('token');

	if (!token) {
		return new Response('Unauthorized', { status: 401 });
	}

	const db = event.locals.db;

	// 1. Resolve user matching rssToken
	const userRecords = await db.select().from(users).where(eq(users.rssToken, token)).limit(1);
	if (userRecords.length === 0) {
		return new Response('Unauthorized', { status: 401 });
	}
	const user = userRecords[0];

	// 2. Fetch category
	const categoryRecords = await db
		.select()
		.from(categories)
		.where(eq(categories.slug, categorySlug))
		.limit(1);
	if (categoryRecords.length === 0) {
		return new Response('Category Not Found', { status: 404 });
	}
	const category = categoryRecords[0];

	// Check if user's group can read this category
	const permRecords = await db
		.select()
		.from(categoryPermissions)
		.where(
			and(
				eq(categoryPermissions.categorySlug, categorySlug),
				eq(categoryPermissions.groupSlug, user.groupSlug)
			)
		)
		.limit(1);

	const canRead = permRecords.length === 0 ? true : permRecords[0].canRead;
	if (!canRead) {
		return new Response('Forbidden', { status: 403 });
	}

	// 3. Query the 20 most recent discussions in this category
	const recentDiscussions = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			createdAt: discussions.createdAt
		})
		.from(discussions)
		.where(and(eq(discussions.categorySlug, categorySlug), isNull(discussions.deletedAt)))
		.orderBy(desc(discussions.createdAt))
		.limit(20);

	const host = event.url.host;
	const protocol = event.url.protocol;
	const siteUrl = `${protocol}//${host}`;

	// 4. Build structured feed object — all text is auto-escaped by XMLBuilder
	const items: Record<string, unknown>[] = recentDiscussions.map((d) => {
		const link = `${siteUrl}/discussion/${d.id}/${d.slug}`;
		return {
			title: d.title,
			link,
			guid: { '@_isPermaLink': 'true', '#text': link },
			pubDate: new Date(d.createdAt).toUTCString(),
			description: d.title
		};
	});

	const feed = {
		rss: {
			'@_version': '2.0',
			'@_xmlns:atom': 'http://www.w3.org/2005/Atom',
			channel: {
				title: formatTitle(category.title),
				link: `${siteUrl}/category/${categorySlug}`,
				description: category.description,
				'atom:link': {
					'@_href': `${siteUrl}/category/${categorySlug}/rss`,
					'@_rel': 'self',
					'@_type': 'application/rss+xml'
				},
				item: items.length === 1 ? items[0] : items
			}
		}
	};

	const builder = new XMLBuilder({
		attributeNamePrefix: '@_',
		textNodeName: '#text',
		ignoreAttributes: false,
		suppressBooleanAttributes: false,
		format: true
	});

	const xml = `<?xml version="1.0" encoding="UTF-8" ?>\n${builder.build(feed)}`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
