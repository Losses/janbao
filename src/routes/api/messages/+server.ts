import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import {
	conversations,
	conversationParticipants,
	messages,
	users,
	drafts,
	conversationReads
} from '$lib/server/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import type { DbTransaction } from '$lib/server/db';
import type { RequestHandler } from './$types';
import type { MessageCreateBody } from '$lib/types/api';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';

const MAX_RECIPIENTS = 20;

// POST /api/messages - Create a new private conversation with an initial
// message authored by the active user and the selected recipients.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: MessageCreateBody;
	try {
		body = (await request.json()) as MessageCreateBody;
	} catch {
		return jsonError(t, 'common.badRequest', 400);
	}

	const title = (body.title || '').trim();
	const contentJson = body.contentJson || '';
	const recipientIds = Array.isArray(body.recipientIds)
		? [...new Set(body.recipientIds.filter((id) => typeof id === 'string' && id !== user.id))]
		: [];

	if (!title) {
		return jsonError(t, 'message.titleRequired', 400);
	}
	if (isLexicalEmpty(contentJson)) {
		return jsonError(t, 'common.contentRequired', 400);
	}
	if (recipientIds.length === 0) {
		return jsonError(t, 'message.recipientsRequired', 400);
	}
	if (recipientIds.length > MAX_RECIPIENTS) {
		return jsonError(t, 'message.tooManyRecipients', 400);
	}
	if (contentJson.length > MAX_CONTENT_SIZE) {
		return jsonError(t, 'common.contentTooLarge', 400);
	}

	const db = locals.db;

	// Verify all recipients exist
	const recipientRecords = await db
		.select({ id: users.id })
		.from(users)
		.where(inArray(users.id, recipientIds));

	if (recipientRecords.length !== recipientIds.length) {
		return jsonError(t, 'message.recipientNotFound', 404);
	}

	const conversationId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const now = new Date();

	// Insert conversation, participants, and the first message atomically
	await db.transaction(async (tx: DbTransaction) => {
		await tx.insert(conversations).values({
			id: conversationId,
			title,
			createdAt: now
		});

		const participantRows = [
			{ conversationId, userId: user.id, joinedAt: now },
			...recipientIds.map((rid) => ({ conversationId, userId: rid, joinedAt: now }))
		];
		await tx.insert(conversationParticipants).values(participantRows);

		await tx.insert(messages).values({
			id: messageId,
			conversationId,
			authorId: user.id,
			contentJson,
			createdAt: now,
			updatedAt: now
		});
	});

	// Clear the composer draft (contextType 'message', contextId 'new')
	await db
		.delete(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'message'),
				eq(drafts.contextId, 'new')
			)
		);

	// Mark the conversation as read for the author so their own opening message
	// does not inflate their inbox unread badge.
	await db
		.insert(conversationReads)
		.values({
			userId: user.id,
			conversationId,
			lastReadAt: now
		})
		.onConflictDoUpdate({
			target: [conversationReads.userId, conversationReads.conversationId],
			set: { lastReadAt: now }
		});

	return json({ success: true, conversationId }, { status: 201 });
};
