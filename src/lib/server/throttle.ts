import { json } from '@sveltejs/kit';
import { sql, and, eq, lt } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { authThrottle, rateLimits } from '$lib/server/db/schema';
import type { D1Db } from '$lib/server/db';

export interface ThrottleConfig {
	limit: number;
	windowSec: number;
}

export interface ThrottleResult {
	blocked: boolean;
	retryAfter: number;
}

/**
 * Fixed-window rate limits for the auth surface. Tuned to allow a legitimate
 * user room to retry (mis-typed passwords, resends) while blocking online
 * brute-force and email-bombing.
 */
export const LOGIN_IP_THROTTLE: ThrottleConfig = { limit: 15, windowSec: 60 };
export const LOGIN_IDENTITY_THROTTLE: ThrottleConfig = { limit: 10, windowSec: 60 };
export const FORGOT_IP_THROTTLE: ThrottleConfig = { limit: 10, windowSec: 3600 };
export const FORGOT_EMAIL_THROTTLE: ThrottleConfig = { limit: 3, windowSec: 3600 };
export const RESET_IP_THROTTLE: ThrottleConfig = { limit: 20, windowSec: 3600 };

/**
 * Resolve the client IP from a SvelteKit request event. Falls back to a stable
 * sentinel when the address cannot be determined (e.g. some local setups).
 */
export function getClientAddressSafe(event: RequestEvent): string {
	try {
		return event.getClientAddress() || 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Fixed-window counter throttle persisted in the shared D1/libsql store, so it
 * is honoured across all isolates (unlike an in-memory map). Increments the
 * counter atomically via an upsert; blocks once the count exceeds `limit`
 * within the current window. Expired windows are pruned best-effort.
 */
export async function enforceThrottle(
	db: D1Db,
	bucket: string,
	identifier: string,
	{ limit, windowSec }: ThrottleConfig
): Promise<ThrottleResult> {
	const nowSec = Math.floor(Date.now() / 1000);
	const epoch = Math.floor(nowSec / windowSec);

	const inserted = await db
		.insert(authThrottle)
		.values({ bucket, identifier, windowEpoch: epoch, count: 1 })
		.onConflictDoUpdate({
			target: [authThrottle.bucket, authThrottle.identifier, authThrottle.windowEpoch],
			set: { count: sql`${authThrottle.count} + 1` }
		})
		.returning({ count: authThrottle.count });

	// Best-effort prune of stale windows for THIS bucket only. The epoch is on a
	// per-bucket scale (floor(now / windowSec)), so it is only comparable within a
	// single bucket - a cross-bucket prune would delete live rows belonging to a
	// bucket with a larger window. Runs on ~10% of calls to stay off the hot path.
	// Pruning is advisory and never fails the request.
	if (Math.random() < 0.1) {
		try {
			await db
				.delete(authThrottle)
				.where(and(eq(authThrottle.bucket, bucket), lt(authThrottle.windowEpoch, epoch - 1)));
		} catch {
			// ignore - prune is best-effort
		}
	}

	const count = inserted[0]?.count ?? 1;
	const blocked = count > limit;
	const retryAfter = blocked ? (epoch + 1) * windowSec - nowSec : 0;
	return { blocked, retryAfter };
}

/**
 * Build a standardised 429 response with a `Retry-After` header (seconds).
 */
export function tooManyRequests(message: string, retryAfter: number): Response {
	return json(
		{ error: message },
		{ status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfter)) } }
	);
}

/**
 * Resolve the post-surface throttle window/limit from env
 * (POST_THROTTLE_WINDOW_SEC / POST_THROTTLE_LIMIT). Defaults to a 10s window
 * with a limit of 1, i.e. a second submission inside the window is rejected.
 */
export function getPostThrottleConfig(
	platformEnv: App.Platform['env'] | undefined
): ThrottleConfig {
	const windowRaw = platformEnv?.POST_THROTTLE_WINDOW_SEC || process.env.POST_THROTTLE_WINDOW_SEC;
	const limitRaw = platformEnv?.POST_THROTTLE_LIMIT || process.env.POST_THROTTLE_LIMIT;

	let windowSec = 10;
	let limit = 1;
	if (windowRaw) {
		const parsed = parseInt(windowRaw, 10);
		if (!isNaN(parsed) && parsed > 0) windowSec = parsed;
	}
	if (limitRaw) {
		const parsed = parseInt(limitRaw, 10);
		// limit must be >= 1: 0 would block every submission (count > 0 is always
		// true) with no safe escape hatch, so a 0/misconfig falls back to default.
		if (!isNaN(parsed) && parsed >= 1) limit = parsed;
	}
	return { limit, windowSec };
}

/**
 * Fixed-window counter throttle for the non-auth write surface, persisted in
 * the dedicated `rate_limits` table. Mirrors {@link enforceThrottle} but stays
 * physically separate from `authThrottle` so the auth rate-limit surface and
 * its naming never collide with post throttling. Not genericised over the
 * table on purpose - isolating the two surfaces is the whole point.
 */
export async function enforceRateLimit(
	db: D1Db,
	bucket: string,
	identifier: string,
	{ limit, windowSec }: ThrottleConfig
): Promise<ThrottleResult> {
	const nowSec = Math.floor(Date.now() / 1000);
	const epoch = Math.floor(nowSec / windowSec);

	const inserted = await db
		.insert(rateLimits)
		.values({ bucket, identifier, windowEpoch: epoch, count: 1 })
		.onConflictDoUpdate({
			target: [rateLimits.bucket, rateLimits.identifier, rateLimits.windowEpoch],
			set: { count: sql`${rateLimits.count} + 1` }
		})
		.returning({ count: rateLimits.count });

	// Best-effort prune of stale windows for THIS bucket only (see enforceThrottle).
	if (Math.random() < 0.1) {
		try {
			await db
				.delete(rateLimits)
				.where(and(eq(rateLimits.bucket, bucket), lt(rateLimits.windowEpoch, epoch - 1)));
		} catch {
			// ignore - prune is best-effort
		}
	}

	const count = inserted[0]?.count ?? 1;
	const blocked = count > limit;
	const retryAfter = blocked ? (epoch + 1) * windowSec - nowSec : 0;
	return { blocked, retryAfter };
}

/**
 * Convenience wrapper for the post write surface: resolves the env-tuned
 * config and keys the counter per user (`user:<id>`). Returns whether the
 * submission should be blocked and how long to wait.
 */
export async function enforcePostThrottle(
	db: D1Db,
	bucket: string,
	userId: number,
	platformEnv: App.Platform['env'] | undefined
): Promise<ThrottleResult> {
	const config = getPostThrottleConfig(platformEnv);
	return enforceRateLimit(db, bucket, `user:${userId}`, config);
}
