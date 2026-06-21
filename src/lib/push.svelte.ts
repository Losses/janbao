/**
 * Browser-side Web Push helpers.
 *
 * Used by the preferences page to subscribe/unsubscribe the active user's
 * service worker for push notifications. The application server key (VAPID
 * public key) is passed in from server-side layout data so the client never
 * hard-codes it.
 *
 * All network calls go to the authed /api/push/* endpoints; the active user
 * is implied by the session cookie.
 */

export type PushSubscribeOutcome =
	| 'subscribed'
	| 'denied'
	| 'unsupported'
	| 'no-service-worker'
	| 'error';

/**
 * Resolve to the active service-worker registration, or null when none is
 * registered on this origin. `navigator.serviceWorker.ready` NEVER resolves if
 * no SW exists (dev never registers one - registration is PROD-gated - or it
 * was just unregistered), which would hang every push call and freeze the
 * toggle. `getRegistrations()` resolves immediately, so check it first and
 * no-op cleanly when there's nothing to talk to.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null;
	const registrations = await navigator.serviceWorker.getRegistrations();
	if (registrations.length === 0) return null;
	return await navigator.serviceWorker.ready;
}

/**
 * Request notification permission and, on grant, subscribe the active service
 * worker registration for push using the supplied VAPID public key. Persists
 * the subscription server-side via POST /api/push/subscribe.
 *
 * @param vapidPublicKey  base64url-encoded VAPID public key from layout data
 * @returns 'subscribed' on success, 'denied' if the user dismissed the prompt,
 *          'unsupported' if PushManager/ServiceWorker is unavailable,
 *          'no-service-worker' if no SW is registered (dev, or not built),
 *          'error' for any other failure.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscribeOutcome> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return 'unsupported';
	}
	if (!vapidPublicKey) {
		return 'unsupported';
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return 'denied';

	try {
		const registration = await activeRegistration();
		if (!registration) return 'no-service-worker';
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
		});
		// `toJSON()` returns the DOM PushSubscriptionJSON shape (keys is a
		// Record); narrow to the wire shape POSTed to /api/push/subscribe.
		const json = subscription.toJSON();
		const keys = json.keys ?? {};
		const res = await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				endpoint: json.endpoint,
				keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' }
			})
		});
		if (!res.ok) return 'error';
		return 'subscribed';
	} catch (err) {
		console.error('[push] subscribe failed:', err);
		return 'error';
	}
}

/**
 * Unsubscribe the active service worker registration's current push
 * subscription and delete the server-side record. Safe to call when no
 * subscription exists (no-ops).
 *
 * @returns true on success (including the no-subscription present case),
 *          false on network/server error.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) return true;
	try {
		const registration = await activeRegistration();
		if (!registration) return true;
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) return true;
		const endpoint = subscription.endpoint;
		await subscription.unsubscribe();
		const res = await fetch('/api/push/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint })
		});
		return res.ok;
	} catch (err) {
		console.error('[push] unsubscribe failed:', err);
		return false;
	}
}

/**
 * True when the active service worker registration already has a push
 * subscription (used to render the enable/disable button correctly on page
 * load).
 */
export async function isPushSubscribed(): Promise<boolean> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
	try {
		const registration = await activeRegistration();
		if (!registration) return false;
		const subscription = await registration.pushManager.getSubscription();
		return subscription !== null;
	} catch {
		return false;
	}
}

/**
 * Convert a base64url-encoded VAPID public key into the Uint8Array that
 * `pushManager.subscribe({applicationServerKey})` expects. The browser's
 * `applicationServerKey` accepts both base64url and base64, but the array form
 * is unambiguous across implementations.
 */
export function urlBase64ToUint8Array(base64UrlKey: string): Uint8Array {
	const padding = '='.repeat((4 - (base64UrlKey.length % 4)) % 4);
	const base64 = (base64UrlKey + padding).replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
