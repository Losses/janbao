import { test, expect } from 'bun:test';
import en from '$lib/i18n/en.json';
import zhCN from '$lib/i18n/zh-CN.json';
import { buildMessagePayload, buildNotificationPayload } from './payload';

// Both push title builders must honour the recipient's languagePreference.
// English must never leak to a zh-CN recipient for the private-message and
// unknown-sender paths.

const NEW_MESSAGE_KEYS = ['message', 'messageFallback', 'unknownSender'] as const;

test('push i18n keys exist in both en and zh-CN notification blocks', () => {
	for (const key of NEW_MESSAGE_KEYS) {
		expect(typeof en.notification[key], `en.notification.${key} must be a string`).toBe('string');
		expect(typeof zhCN.notification[key], `zh-CN.notification.${key} must be a string`).toBe(
			'string'
		);
		expect(
			(en.notification[key] as string).length,
			`en.notification.${key} must be non-empty`
		).toBeGreaterThan(0);
		expect(
			(zhCN.notification[key] as string).length,
			`zh-CN.notification.${key} must be non-empty`
		).toBeGreaterThan(0);
	}
});

test('buildMessagePayload: en message with author name substitutes {name}', () => {
	const payload = buildMessagePayload('Alice', 42, 'en');
	expect(payload.title).toBe('Alice sent you a message');
	expect(payload.url).toBe('/messages/42');
	expect(payload.tag).toBe('message-42');
	expect(payload.body).toBe('');
});

test('buildMessagePayload: zh-CN message with author name substitutes {name}', () => {
	const payload = buildMessagePayload('Alice', 42, 'zh-CN');
	// zh-CN template must localise the verb, not echo the English string.
	expect(payload.title).toContain('Alice');
	expect(payload.title).not.toContain('sent you a message');
});

test('buildMessagePayload: en falls back to "New message" when author name is empty', () => {
	const payload = buildMessagePayload('', 7, 'en');
	expect(payload.title).toBe('New message');
});

test('buildMessagePayload: zh-CN falls back to localised messageFallback, not English', () => {
	const payload = buildMessagePayload('', 7, 'zh-CN');
	expect(payload.title).toBe(zhCN.notification.messageFallback);
	expect(payload.title).not.toBe('New message');
});

test('buildNotificationPayload: zh-CN localises the unknown-sender actor', () => {
	const payload = buildNotificationPayload('mention', '', '/discussion/1', 'zh-CN', 'Title');
	// Actor must be the zh-CN unknownSender label, never the English "Someone".
	expect(payload.title.startsWith(`${zhCN.notification.unknownSender} `)).toBe(true);
	expect(payload.title.startsWith('Someone ')).toBe(false);
});

test('buildNotificationPayload: en uses "Someone" fallback when sourceName is empty', () => {
	const payload = buildNotificationPayload('mention', '', '/discussion/1', 'en', 'Title');
	expect(payload.title.startsWith('Someone ')).toBe(true);
});

test('buildMessagePayload: unknown language falls back to en dictionary', () => {
	const payload = buildMessagePayload('Alice', 1, 'klingon');
	expect(payload.title).toBe('Alice sent you a message');
});
