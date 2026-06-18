/**
 * VAPID key resolution (RFC8292).
 *
 * VAPID keys are an ECDSA P-256 keypair used to sign the JWT that authorizes
 * the application server to send Web Push messages. The public key is also
 * handed to `PushManager.subscribe` as the `applicationServerKey`.
 *
 * Storage convention (mirrors the `web-push` library so the same env vars are
 * portable): env values are base64url strings of the RAW key bytes -
 *  - publicKey: 65 bytes, P-256 uncompressed point (0x04 || X(32) || Y(32))
 *  - privateKey: 32 bytes, raw scalar d
 *
 * The public key is safe to expose to the client (it is published in the
 * service worker subscription); the private key must stay server-side.
 *
 * In dev with no env vars, a P-256 keypair is generated on first use and
 * cached for the process lifetime, so subscriptions remain valid across
 * requests within a single dev server run. In production builds a missing
 * key throws - silently signing push with no/known key would let anyone
 * impersonate the server.
 */

import { env } from '$env/dynamic/private';

export interface VapidKeyMaterial {
	/** 65-byte uncompressed P-256 public key (0x04 || X || Y). */
	publicKey: Uint8Array;
	/** 32-byte raw private scalar d. */
	privateKey: Uint8Array;
	/** VAPID subject (mailto: or https: URL), per RFC8292 §4. */
	subject: string;
}

const DEV_VAPID_SUBJECT = 'mailto:dev@janbao.local';

let cachedDevKeypair: VapidKeyMaterial | null = null;

async function loadOrGenerateDevKeypair(): Promise<VapidKeyMaterial> {
	if (cachedDevKeypair) return cachedDevKeypair;
	const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
	// Recover the raw scalar d from the JWK export. The `d` field is the
	// base64url-encoded raw scalar; this is the canonical WebCrypto path and
	// avoids fragile PKCS8 offset slicing.
	const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
	if (!jwk.d) throw new Error('Exported JWK for an ECDSA private key must include `d`');
	const privateKey = base64UrlToBytes(jwk.d);
	cachedDevKeypair = {
		publicKey,
		privateKey,
		subject: DEV_VAPID_SUBJECT
	};
	console.warn(
		'[SECURITY WARNING] VAPID_* env vars are not set. Generated an ephemeral dev keypair (lost on restart). Never deploy this.'
	);
	return cachedDevKeypair;
}

export async function getVapidKeys(
	platformEnv: App.Platform['env'] | undefined
): Promise<VapidKeyMaterial> {
	const publicKeyB64Url = platformEnv?.VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY;
	const privateKeyB64Url = platformEnv?.VAPID_PRIVATE_KEY || env.VAPID_PRIVATE_KEY;
	const subject = platformEnv?.VAPID_SUBJECT || env.VAPID_SUBJECT;

	if (publicKeyB64Url && privateKeyB64Url && subject) {
		return {
			publicKey: base64UrlToBytes(publicKeyB64Url),
			privateKey: base64UrlToBytes(privateKeyB64Url),
			subject
		};
	}

	if (import.meta.env.DEV) {
		return loadOrGenerateDevKeypair();
	}

	throw new Error(
		'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not configured. Refusing to sign push with an insecure key in a production build.'
	);
}

/**
 * The public key, base64url-encoded, as `PushManager.subscribe` expects for
 * `applicationServerKey`. Returns null when VAPID is not configured and we
 * are not in dev, so the layout can hide the push UI entirely.
 *
 * Sync because the client only needs the configured env string; the dev
 * fallback path falls back to null (the dev server's getVapidKeys call on
 * the push path will generate lazily and the subscribe() call there will
 * exercise the full path). For the UI gate this is sufficient.
 */
export function getVapidPublicKeyBase64Url(
	platformEnv: App.Platform['env'] | undefined
): string | null {
	const publicKeyB64Url = platformEnv?.VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY;
	if (publicKeyB64Url) return publicKeyB64Url;
	// In dev, expose the cached dev public key if one has been generated.
	if (import.meta.env.DEV && cachedDevKeypair) {
		return bytesToBase64Url(cachedDevKeypair.publicKey);
	}
	return null;
}

/** base64url decode (Web-safe alphabet, no padding) into a fresh Uint8Array. */
export function base64UrlToBytes(b64url: string): Uint8Array {
	const pad = (4 - (b64url.length % 4)) % 4;
	const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** base64url encode of a Uint8Array, with padding stripped. */
export function bytesToBase64Url(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
