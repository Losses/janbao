import { json } from '@sveltejs/kit';
import { sql, and, eq, lt } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { authThrottle } from '$lib/server/db/schema';
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

	// Best-effort prune of stale windows (older than the previous epoch).
	try {
		await db
			.delete(authThrottle)
			.where(and(eq(authThrottle.bucket, bucket), lt(authThrottle.windowEpoch, epoch - 1)));
	} catch {
		// Pruning is advisory; never fail the request because of it.
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
