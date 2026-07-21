/**
 * Pure push-payload composition.
 *
 * The push fan-out path in `deliver.ts` adapts two in-app notification streams
 * to web push: reply-triggered notifications and new-private-message pings.
 * Both must render their title in the recipient's `languagePreference`. This
 * module isolates that i18n composition from the transport (encryption /
 * VAPID / network) so it stays unit-testable without env-dependent imports.
 */

import { getTranslation } from '../i18n';

/** Shape handed to the push transport: a title/body deep-link plus dedupe tag. */
export interface PushPayload {
	title: string;
	body: string;
	url: string;
	tag?: string;
}

/** Resolve the notification i18n dictionary for a language. */
function notificationDict(lang: string): Record<string, string> {
	const t = getTranslation(lang);
	return (t.notification as Record<string, string> | undefined) ?? {};
}

/** Last-resort English label for a sender whose name could not be resolved. */
const UNKNOWN_SENDER_FALLBACK = 'Someone';

/** Compose the new-private-message push payload in the recipient's language. */
export function buildMessagePayload(
	authorName: string,
	conversationId: number,
	lang: string
): PushPayload {
	const notificationT = notificationDict(lang);
	const url = `/messages/${conversationId}`;
	const title = authorName
		? (notificationT.message ?? '{name} sent you a message').replace('{name}', authorName)
		: (notificationT.messageFallback ?? 'New message');
	return {
		title,
		body: '',
		url,
		tag: `message-${conversationId}`
	};
}

/** Compose a reply-triggered push payload from a notification row. */
export function buildNotificationPayload(
	type: string,
	sourceName: string,
	url: string,
	lang: string,
	discussionTitle: string | null
): PushPayload {
	const notificationT = notificationDict(lang);
	const actor = sourceName || (notificationT.unknownSender ?? UNKNOWN_SENDER_FALLBACK);

	let titlePattern: string;
	if (type === 'mention') {
		titlePattern = discussionTitle
			? (notificationT.mention ?? '')
			: (notificationT.mentionFallback ?? '');
	} else if (type === 'reply') {
		titlePattern = discussionTitle
			? (notificationT.reply ?? '')
			: (notificationT.replyFallback ?? '');
	} else if (type === 'participated_comment') {
		titlePattern = discussionTitle
			? (notificationT.participatedComment ?? '')
			: (notificationT.participatedCommentFallback ?? '');
	} else if (type === 'bookmarked_comment') {
		titlePattern = discussionTitle
			? (notificationT.bookmarkedComment ?? '')
			: (notificationT.bookmarkedCommentFallback ?? '');
	} else if (type === 'discussion_comment') {
		titlePattern = discussionTitle
			? (notificationT.discussionComment ?? '')
			: (notificationT.discussionCommentFallback ?? '');
	} else {
		titlePattern = discussionTitle
			? (notificationT.discussionComment ?? '')
			: (notificationT.discussionCommentFallback ?? '');
	}

	const verb = titlePattern.replace('{title}', discussionTitle ?? '');
	const title = `${actor} ${verb}`;

	switch (type) {
		case 'mention':
			return {
				title,
				body: '',
				url,
				tag: `mention-${url}`
			};
		case 'reply':
			return {
				title,
				body: '',
				url,
				tag: `reply-${url}`
			};
		case 'participated_comment':
			return {
				title,
				body: '',
				url,
				tag: `participated-${url}`
			};
		case 'bookmarked_comment':
			return {
				title,
				body: '',
				url,
				tag: `bookmarked-${url}`
			};
		case 'discussion_comment':
			return {
				title,
				body: '',
				url,
				tag: `comment-${url}`
			};
		default:
			return { title, body: '', url, tag: url };
	}
}
