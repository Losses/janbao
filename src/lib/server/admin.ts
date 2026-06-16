import { jsonError } from '$lib/server/errors';
import type { TranslationDict } from '$lib/types/translation';
import type { UserInfoSummary } from '$lib/types/api';

const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;

export function requireAdmin(user: UserInfoSummary | null, t: TranslationDict): Response | null {
	if (!user) return jsonError(t, 'common.unauthorized', 401);
	if (user.groupSlug !== 'admin') return jsonError(t, 'common.forbidden', 403);
	return null;
}

export function isValidAdminSlug(slug: string): boolean {
	return SLUG_PATTERN.test(slug);
}
