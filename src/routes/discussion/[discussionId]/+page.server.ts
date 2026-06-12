import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { discussions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { discussionId } = params;
	const db = locals.db;

	const record = await db
		.select({ slug: discussions.slug })
		.from(discussions)
		.where(eq(discussions.id, discussionId))
		.limit(1);

	if (record.length === 0) {
		error(404, 'Discussion Not Found');
	}

	const slug = record[0].slug;
	redirect(302, `/discussion/${discussionId}/${slug}`);
};
