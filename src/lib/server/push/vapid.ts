/**
 * VAPID JWT signing (RFC8292 §3 + RFC7519 + JWS RFC7515).
 *
 * Produces a compact JWS using ES256 (ECDSA P-256 SHA-256). WebCrypto's
 * ECDSA signs in ASN.1 DER SEQUENCE { r INTEGER, s INTEGER }; JWS instead
 * wants the raw r||s (64 bytes for P-256). We convert between the two.
 *
 * The private key is provided as the raw 32-byte scalar d. To import it via
 * WebCrypto we reconstruct the JWK form, which requires the public key's
 * X and Y coordinates - derived from the 65-byte uncompressed public key.
 *
 * Header:  {"typ":"JWT","alg":"ES256"}
 * Payload: {"aud":<push service origin>, "exp":<now+12h>, "sub":<subject>}
 *   - aud is the push endpoint's origin (RFC8292 §3.2); the caller resolves
 *     it from the subscription endpoint URL.
 *   - sub is the VAPID subject (mailto: or https: URL).
 */

import { bytesToBase64Url } from './keys';

const ES256_HEADER_OBJ = { typ: 'JWT', alg: 'ES256' };

function objectToJsonBytes(obj: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(obj));
}

interface P256Coordinates {
	x: Uint8Array;
	y: Uint8Array;
}

/** Derive the X and Y coordinates from a 65-byte uncompressed P-256 public key. */
function splitUncompressedPublicKey(publicKey: Uint8Array): P256Coordinates {
	if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
		throw new Error(
			`Expected 65-byte uncompressed P-256 public key (0x04||X||Y); got length=${publicKey.length}`
		);
	}
	return {
		x: publicKey.slice(1, 33),
		y: publicKey.slice(33, 65)
	};
}

/** Convert a 32-byte big-endian unsigned integer to base64url. */
function u32ToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64Url(bytes);
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64Url(bytes);
}

// `base64UrlToBytes` is intentionally not re-exported here: VAPID signing only
// encodes bytes outward, never decodes.

/**
 * Convert a WebCrypto ECDSA P-256 signature to the raw r||s form JWS requires.
 *
 * Per the W3C WebCrypto spec the ECDSA algorithm produces an ASN.1 DER
 * SEQUENCE { r INTEGER, s INTEGER }; Cloudflare Workers and most browsers
 * follow this. Bun's WebCrypto, however, returns the raw 64-byte r||s form
 * directly. We detect which we got and normalize to raw in either case so
 * this module behaves identically on both runtimes.
 */
function ecdsaSignatureToRaw(signature: Uint8Array): Uint8Array {
	// Raw r||s for P-256 is exactly 64 bytes.
	if (signature.length === 64) return signature;
	// Otherwise expect DER. Anything else is malformed.
	if (signature.length < 8 || signature[0] !== 0x30) {
		throw new Error(
			`Unexpected ECDSA signature shape (len=${signature.length}, firstByte=0x${signature[0]?.toString(16) ?? 'na'})`
		);
	}
	return derToRaw(signature);
}

/** Strip the ASN.1 DER wrapper from an ECDSA signature and return raw r||s. */
function derToRaw(derSignature: Uint8Array): Uint8Array {
	// ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }
	// DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
	// Integers may be zero-padded with a leading 0x00 to keep them unsigned;
	// JWS r||s is fixed-width 32 bytes each for P-256, so we strip/restore.
	let idx = 2; // skip 0x30 and total-length octet (single-byte length assumed)
	if (derSignature[1] !== derSignature.length - 2) {
		// Long-form or unexpected length; recompute from the first integer tag.
		idx = 1 + lengthOfLengthPrefix(derSignature, 1);
	}

	// r
	if (derSignature[idx] !== 0x02) throw new Error('Malformed DER (expected r INTEGER tag)');
	const rLen = derSignature[idx + 1];
	const rBytes = derSignature.slice(idx + 2, idx + 2 + rLen);
	idx = idx + 2 + rLen;

	// s
	if (derSignature[idx] !== 0x02) throw new Error('Malformed DER (expected s INTEGER tag)');
	const sLen = derSignature[idx + 1];
	const sBytes = derSignature.slice(idx + 2, idx + 2 + sLen);

	return concatFixedWidth(rBytes, sBytes, 32);
}

function lengthOfLengthPrefix(bytes: Uint8Array, offset: number): number {
	// Returns the number of octets the DER length field occupies starting at
	// `offset`, including the initial octet. Used only as a fallback.
	const first = bytes[offset];
	if (first < 0x80) return 1;
	const numLenOctets = first & 0x7f;
	return 1 + numLenOctets;
}

/** Normalize an INTEGER field to exactly `width` bytes (strip leading 0x00 or left-pad). */
function concatFixedWidth(r: Uint8Array, s: Uint8Array, width: number): Uint8Array {
	const rNorm = normalizeIntegerBytes(r, width);
	const sNorm = normalizeIntegerBytes(s, width);
	const out = new Uint8Array(width * 2);
	out.set(rNorm, 0);
	out.set(sNorm, width);
	return out;
}

function normalizeIntegerBytes(bytes: Uint8Array, width: number): Uint8Array {
	// Strip a single leading 0x00 padding byte if present (DER keeps the sign bit clear).
	let start = 0;
	while (start < bytes.length - 1 && bytes[start] === 0x00) start++;
	const trimmed = bytes.slice(start);
	if (trimmed.length === width) return trimmed;
	if (trimmed.length > width) {
		// Truncate from the left (shouldn't happen for valid P-256 signatures).
		return trimmed.slice(trimmed.length - width);
	}
	const out = new Uint8Array(width);
	out.set(trimmed, width - trimmed.length);
	return out;
}

/**
 * Sign and return a VAPID JWT for the given push service `audience`.
 *
 * @param privateKey  32-byte raw P-256 scalar d
 * @param publicKey   65-byte uncompressed P-256 public key (needed to import
 *                    the private key via WebCrypto JWK reconstruction)
 * @param audience    Push service origin (scheme://host[:port])
 * @param subject     VAPID subject (mailto: or https: URL)
 * @param nowMs       Optional injected clock (test seam)
 */
export async function signVapidJwt(
	privateKey: Uint8Array,
	publicKey: Uint8Array,
	audience: string,
	subject: string,
	nowMs: number = Date.now()
): Promise<string> {
	if (privateKey.length !== 32) {
		throw new Error(`VAPID private key must be 32 bytes; got ${privateKey.length}`);
	}
	const { x, y } = splitUncompressedPublicKey(publicKey);

	const jwk = {
		kty: 'EC',
		crv: 'P-256',
		key_ops: ['sign'],
		ext: true,
		d: bytesToBase64Url(privateKey),
		x: u32ToBase64Url(x),
		y: u32ToBase64Url(y)
	};

	const cryptoKey = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);

	const headerB64 = uint8ArrayToBase64Url(objectToJsonBytes(ES256_HEADER_OBJ));
	const payload = {
		aud: audience,
		exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
		sub: subject
	};
	const payloadB64 = uint8ArrayToBase64Url(objectToJsonBytes(payload));
	const signingInput = `${headerB64}.${payloadB64}`;
	const dataToSign = new TextEncoder().encode(signingInput);

	const derSig = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, dataToSign)
	);
	const rawSig = ecdsaSignatureToRaw(derSig);
	if (rawSig.length !== 64) {
		throw new Error(`Expected 64-byte raw ECDSA signature; got ${rawSig.length}`);
	}
	const sigB64 = uint8ArrayToBase64Url(rawSig);
	return `${signingInput}.${sigB64}`;
}
