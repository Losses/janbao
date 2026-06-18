/**
 * Web Push delivery.
 *
 * Encrypts a payload per RFC8291, signs a VAPID JWT per RFC8292, and POSTs
 * the aes128gcm record to the push service endpoint. Outcomes are bucketed
 * so callers can react to permanent (404/410) vs transient (429/5xx) vs
 * success states.
 *
 * Two dispatch entry points adapt the in-app notification pipelines:
 *  - deliverPushForNotifications: reply-triggered notifications (mentions,
 *    owner, participant, bookmarker)
 *  - deliverPushForMessage: new private message
 *
 * Both are best-effort: every push attempt is wrapped so that a downstream
 * push service hiccup never fails the content-creating request. Callers are
 * expected to invoke them with `void x().catch(...)` (fire-and-forget).
 */

import { eq, and, inArray } from 'drizzle-orm';
import {
	pushSubscriptions,
	notificationPreferences,
	conversationParticipants,
	users
} from '$lib/server/db/schema';
import type { D1Db } from '$lib/server/db/index';
import type { NewNotificationRow, ReplyNotifCategory } from '$lib/server/db/notifications';
import { encryptJsonPayload } from './encryption';
import { signVapidJwt } from './vapid';
import { getVapidKeys, base64UrlToBytes, bytesToBase64Url } from './keys';

/** Discrete outcome of a single push POST. */
type PushDeliveryStatus = 'ok' | 'gone' | 'retryable' | 'failed';

export interface PushSubscriptionRecord {
	endpoint: string;
	/** base64url-encoded p256dh ECDH public key (65 bytes uncompressed). */
	p256dhKey: string;
	/** base64url-encoded 16-byte auth secret. */
	authKey: string;
}

export interface PushPayload {
	title: string;
	body: string;
	url: string;
	tag?: string;
}

/** A notification row plus its semantic push category, for fan-out. */
export type CreatedNotificationRow = NewNotificationRow;

const PUSH_TTL_SECONDS = 2419200; // 28 days, the maximum most push services honor.

/** Push preference column names gated by a reply-triggered notification. */
type ReplyPushPrefColumn =
	| 'pushMention'
	| 'pushDiscussionReply'
	| 'pushParticipatedComment'
	| 'pushBookmarkedDiscussionComment';

/** Map a reply notification category to the matching push preference column. */
function pushPrefColumnForCategory(category: ReplyNotifCategory): ReplyPushPrefColumn | null {
	switch (category) {
		case 'mention':
			return 'pushMention';
		case 'owner':
			return 'pushDiscussionReply';
		case 'participant':
			return 'pushParticipatedComment';
		case 'bookmarker':
			return 'pushBookmarkedDiscussionComment';
		default:
			return null;
	}
}

/** Resolve the push service origin (scheme://host[:port]) for the VAPID `aud`. */
function endpointAudience(endpoint: string): string {
	const url = new URL(endpoint);
	return `${url.protocol}//${url.host}`;
}

/**
 * Encrypt + sign + POST a payload to a single subscription.
 *
 * @returns 'gone' for 404/410 (caller should delete the subscription),
 *          'retryable' for 429/5xx, 'ok' for 2xx, 'failed' otherwise.
 */
export async function sendWebPush(
	subscription: PushSubscriptionRecord,
	payload: PushPayload,
	platformEnv: App.Platform['env'] | undefined
): Promise<PushDeliveryStatus> {
	const vapid = await getVapidKeys(platformEnv);

	const p256dh = base64UrlToBytes(subscription.p256dhKey);
	const authSecret = base64UrlToBytes(subscription.authKey);

	const body = await encryptJsonPayload(payload, p256dh, authSecret);
	const audience = endpointAudience(subscription.endpoint);
	const jwt = await signVapidJwt(vapid.privateKey, vapid.publicKey, audience, vapid.subject);

	const headers: Record<string, string> = {
		Authorization: `vapid t=${jwt},k=${bytesToBase64Url(vapid.publicKey)}`,
		TTL: String(PUSH_TTL_SECONDS),
		'Content-Encoding': 'aes128gcm',
		'Content-Type': 'application/octet-stream'
	};

	let response: Response;
	try {
		response = await fetch(subscription.endpoint, {
			method: 'POST',
			headers,
			body: body as BodyInit
		});
	} catch (err) {
		console.error('[push] network error sending push:', err);
		return 'retryable';
	}

	if (response.status === 404 || response.status === 410) return 'gone';
	if (response.status === 429 || response.status >= 500) return 'retryable';
	if (response.status >= 200 && response.status < 300) return 'ok';
	console.error('[push] unexpected push response status:', response.status);
	return 'failed';
}

/**
 * Fan out push notifications for reply-triggered notification rows.
 *
 * For each notification row we:
 *   1. Resolve the push preference column for that notification type.
 *   2. Look up the recipient's preference row and skip if disabled.
 *   3. Look up the source user for the body line ("X replied to you").
 *   4. Send to every active subscription for the recipient.
 *
 * Stale subscriptions (404/410) are pruned; failures are logged but never
 * thrown - this runs fire-and-forget from the reply action.
 */
export async function deliverPushForNotifications(
	db: D1Db,
	rows: CreatedNotificationRow[],
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	if (rows.length === 0) return;

	const userIds = [...new Set(rows.map((r) => r.userId))];
	const sourceUserIds = [...new Set(rows.map((r) => r.sourceUserId))];

	const [subsRows, prefRows, sourceUserRows] = await Promise.all([
		db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)),
		db
			.select()
			.from(notificationPreferences)
			.where(inArray(notificationPreferences.userId, userIds)),
		db
			.select({ id: users.id, username: users.username, displayName: users.displayName })
			.from(users)
			.where(inArray(users.id, sourceUserIds))
	]);

	const prefByUser = new Map(prefRows.map((p) => [p.userId, p]));
	const subsByUser = new Map<number, typeof subsRows>();
	for (const s of subsRows) {
		const list = subsByUser.get(s.userId) ?? [];
		list.push(s);
		subsByUser.set(s.userId, list);
	}
	const sourceByUser = new Map(sourceUserRows.map((u) => [u.id, u]));

	for (const row of rows) {
		const prefColumn = pushPrefColumnForCategory(row.category);
		if (!prefColumn) continue;
		const pref = prefByUser.get(row.userId);
		// No preference row means default-true for every push category.
		const enabled = pref ? pref[prefColumn] : true;
		if (!enabled) continue;

		const subscriptions = subsByUser.get(row.userId);
		if (!subscriptions || subscriptions.length === 0) continue;

		const source = sourceByUser.get(row.sourceUserId);
		const sourceName = source?.displayName || source?.username || '';
		const url = `/discussion/${row.discussionId}`;
		const payload = buildNotificationPayload(row.type, sourceName, url);

		await sendToSubscriptions(db, subscriptions, payload, platformEnv);
	}
}

/**
 * Fan out push notifications for a brand-new private message conversation.
 * Notifies every other participant (recipients) whose pushMessage pref is on.
 */
export async function deliverPushForMessage(
	db: D1Db,
	conversationId: number,
	authorId: number,
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	const participantRows = await db
		.select({ userId: conversationParticipants.userId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.conversationId, conversationId));
	const recipientIds = participantRows.map((p) => p.userId).filter((id) => id !== authorId);
	if (recipientIds.length === 0) return;

	const [subsRows, prefRows, authorRows] = await Promise.all([
		db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, recipientIds)),
		db
			.select()
			.from(notificationPreferences)
			.where(inArray(notificationPreferences.userId, recipientIds)),
		db
			.select({ username: users.username, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, authorId))
			.limit(1)
	]);

	const prefByUser = new Map(prefRows.map((p) => [p.userId, p]));
	const subsByUser = new Map<number, typeof subsRows>();
	for (const s of subsRows) {
		const list = subsByUser.get(s.userId) ?? [];
		list.push(s);
		subsByUser.set(s.userId, list);
	}
	const author = authorRows[0];
	const authorName = author?.displayName || author?.username || '';
	const url = `/messages/${conversationId}`;

	for (const userId of recipientIds) {
		const pref = prefByUser.get(userId);
		const enabled = pref ? pref.pushMessage : true;
		if (!enabled) continue;

		const subscriptions = subsByUser.get(userId);
		if (!subscriptions || subscriptions.length === 0) continue;

		const payload: PushPayload = {
			title: authorName ? `${authorName} sent you a message` : 'New message',
			body: '',
			url,
			tag: `message-${conversationId}`
		};
		await sendToSubscriptions(db, subscriptions, payload, platformEnv);
	}
}

interface PushSubscriptionRow {
	id: number;
	endpoint: string;
	p256dhKey: string;
	authKey: string;
}

/** Send one payload to every subscription of a single user; prune gone ones. */
async function sendToSubscriptions(
	db: D1Db,
	subs: PushSubscriptionRow[],
	payload: PushPayload,
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	const goneEndpoints: string[] = [];
	for (const sub of subs) {
		const status = await sendWebPush(
			{ endpoint: sub.endpoint, p256dhKey: sub.p256dhKey, authKey: sub.authKey },
			payload,
			platformEnv
		);
		if (status === 'gone') goneEndpoints.push(sub.endpoint);
	}
	if (goneEndpoints.length > 0) {
		try {
			await db
				.delete(pushSubscriptions)
				.where(and(inArray(pushSubscriptions.endpoint, goneEndpoints)));
		} catch (err) {
			console.error('[push] failed to prune gone subscriptions:', err);
		}
	}
}

/** Compose a human-readable payload from a notification row. */
function buildNotificationPayload(type: string, sourceName: string, url: string): PushPayload {
	const actor = sourceName || 'Someone';
	switch (type) {
		case 'mention':
			return {
				title: `${actor} mentioned you`,
				body: '',
				url,
				tag: `mention-${url}`
			};
		case 'reply':
			return {
				title: `${actor} replied to your discussion`,
				body: '',
				url,
				tag: `reply-${url}`
			};
		case 'discussion_comment':
			return {
				title: `${actor} posted in a discussion you follow`,
				body: '',
				url,
				tag: `comment-${url}`
			};
		default:
			return { title: actor, body: '', url, tag: url };
	}
}

/** Re-exported so callers can keep their import list narrow. */
