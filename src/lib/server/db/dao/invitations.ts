import { invitations, users } from '../schema';
import { eq, and, gte, lt, inArray, count, desc } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { InvitationItem, UserInfoSummary } from '$lib/types/api';
import type { DateBoundary } from '../welcome';

/**
 * List all invitation codes created by `userId`, each with its status resolved
 * dynamically from usedById / expiresAt and the username of the redeeming user.
 */
export async function getInvitations(db: D1Db, userId: number): Promise<InvitationItem[]> {
	const rows = await db
		.select({
			code: invitations.code,
			creatorId: invitations.creatorId,
			usedById: invitations.usedById,
			createdAt: invitations.createdAt,
			expiresAt: invitations.expiresAt
		})
		.from(invitations)
		.where(eq(invitations.creatorId, userId))
		.orderBy(desc(invitations.createdAt));

	const usedByIds = rows.map((r) => r.usedById).filter((id): id is number => id !== null);
	const usedByMap = new Map<number, string>();
	if (usedByIds.length > 0) {
		const uniqueUsedByIds = [...new Set(usedByIds)];
		const usedByUsers = await db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(inArray(users.id, uniqueUsedByIds));
		for (const u of usedByUsers) {
			usedByMap.set(u.id, u.username);
		}
	}

	const now = Date.now();
	return rows.map((r) => {
		let status: InvitationItem['status'];
		if (r.usedById !== null) {
			status = 'used';
		} else if (r.expiresAt.getTime() < now) {
			status = 'expired';
		} else {
			status = 'unused';
		}
		return {
			code: r.code,
			creatorId: r.creatorId,
			usedById: r.usedById,
			usedByUsername: r.usedById ? (usedByMap.get(r.usedById) ?? null) : null,
			createdAt: r.createdAt,
			expiresAt: r.expiresAt,
			status
		};
	});
}

/**
 * Find the user who invited `userId` — the creator of the invitation code that
 * `userId` redeemed at sign-up. Returns null for users who joined without an
 * invitation (e.g. the seed admin) or whose inviter's account was deleted.
 */
export async function getInviter(db: D1Db, userId: number): Promise<UserInfoSummary | null> {
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId
		})
		.from(invitations)
		.innerJoin(users, eq(invitations.creatorId, users.id))
		.where(eq(invitations.usedById, userId))
		.limit(1);

	return rows.length > 0 ? rows[0] : null;
}

/**
 * Count the invitation codes a user has created within a half-open month window.
 */
export async function getMonthlyRequestCount(
	db: D1Db,
	userId: number,
	window: DateBoundary
): Promise<number> {
	const result = await db
		.select({ value: count() })
		.from(invitations)
		.where(
			and(
				eq(invitations.creatorId, userId),
				gte(invitations.createdAt, window.start),
				lt(invitations.createdAt, window.end)
			)
		);
	return result[0]?.value ?? 0;
}
