/**
 * Generate a VAPID ECDSA P-256 keypair and print the base64url encodings ready
 * to paste into VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
 *
 * Public key: 65-byte uncompressed point (0x04 || X || Y)
 * Private key: 32-byte raw scalar d
 *
 * Run with: `bun scripts/generate-vapid-keys.ts`
 *
 * These keys are long-lived: a single pair identifies the application server
 * to push services. Rotating them invalidates every existing subscription, so
 * pick a stable subject (e.g. mailto:ops@your-domain) and store both halves
 * securely.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main(): Promise<void> {
	const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
	// The raw private scalar d is most reliably recovered from the JWK export
	// (the `d` field is the base64url-encoded raw scalar). Slicing PKCS8 by a
	// fixed offset is fragile because the wrapper length can vary subtly with
	// implementation - the JWK route is the canonical WebCrypto way.
	const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
	// The `d` field is the base64url-encoded raw scalar; it is always present for
	// an exported ECDSA private key, but the JsonWebKey type marks it optional.
	if (!jwk.d) throw new Error('Private key JWK is missing the scalar field d');
	const privateKey = base64UrlToBytes(jwk.d);

	if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
		throw new Error(`Unexpected public key length ${publicKey.length}`);
	}
	if (privateKey.length !== 32) {
		throw new Error(`Unexpected private key length ${privateKey.length}`);
	}

	console.log('VAPID keypair generated. Paste these into your .env / secrets:\n');
	console.log(`VAPID_PUBLIC_KEY="${bytesToBase64Url(publicKey)}"`);
	console.log(`VAPID_PRIVATE_KEY="${bytesToBase64Url(privateKey)}"`);
	console.log('VAPID_SUBJECT="mailto:you@example.com"');
	console.log('\nNote: VAPID_SUBJECT must be a mailto: or https: URL identifying the push sender.');
}

function base64UrlToBytes(b64url: string): Uint8Array {
	const pad = (4 - (b64url.length % 4)) % 4;
	const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

await main();

export {};
