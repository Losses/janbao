/**
 * RFC8291 aes128gcm content encryption for Web Push.
 *
 * Encrypts an application payload to a single PushSubscription using the
 * subscription's P-256 ECDH public key (p256dh) and authentication secret
 * (auth). The output is one RFC8188 aes128gcm record:
 *
 *   +-----------+--------+-----------+---------------+
 *   | salt (16) | rs(4)  | idlen (1) | keyid (idlen) |
 *   +-----------+--------+-----------+---------------+
 *   | ciphertext (AES-128-GCM of plaintext || pad)   |
 *   +-------------------------------------------------+
 *
 *   rs = 4096 (record size, includes the 16-byte GCM auth tag + 1 pad byte)
 *   idlen = 65 (as-binary server public key, uncompressed P-256)
 *   keyid = the ephemeral server public key
 *
 * Key derivation (RFC8188 §2):
 *   PRK = HKDF-Expand(HKDF-Extract(salt, IKM), info, L)
 *   where IKM is built in two stages:
 *     1. IKM_auth = ECDH(ephemeral_priv, p256dh_pub)
 *     2. IKM = HKDF-Expand(HKDF-Extract(auth_secret, IKM_auth),
 *                          "Content-Encoding: auth\0", 32)
 *   then:
 *     cek  = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: aes128gcm\0", 16)
 *     nonce = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: nonce\0", 12)
 *
 * All cryptographic primitives come from WebCrypto (HMAC-SHA-256 for HKDF,
 * ECDH P-256, AES-128-GCM), so this module runs unmodified on Cloudflare
 * Workers and Bun.
 */

const RECORD_SIZE = 4096;
const PAD_SIZE = 1; // single-record delimiter: 0x02 then no further padding

/** HKDF-Extract using HMAC-SHA-256. */
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		ikm as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, salt as BufferSource));
	return mac;
}

/** HKDF-Expand using HMAC-SHA-256 (RFC5869 §2.3). */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		prk as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const out = new Uint8Array(length);
	let prev: Uint8Array = new Uint8Array(0);
	let offset = 0;
	let counter = 1;
	while (offset < length) {
		const input = new Uint8Array(prev.length + info.length + 1);
		input.set(prev, 0);
		input.set(info, prev.length);
		input[prev.length + info.length] = counter;
		prev = new Uint8Array(await crypto.subtle.sign('HMAC', key, input as BufferSource));
		const take = Math.min(prev.length, length - offset);
		out.set(prev.slice(0, take), offset);
		offset += take;
		counter++;
	}
	return out;
}

/** Build an RFC8188 HKDF `info` value: ASCII label || 0x00 terminator. */
function rfc8188Info(label: string): Uint8Array {
	const base = new TextEncoder().encode(label);
	const out = new Uint8Array(base.length + 1);
	out.set(base, 0);
	out[base.length] = 0x00;
	return out;
}

/** Concatenate two byte arrays into a fresh Uint8Array. */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

/**
 * Encrypt `payload` for the given subscription key material.
 *
 * @param payload   Plaintext bytes (typically UTF-8 JSON)
 * @param p256dh    Subscription P-256 ECDH public key, 65 bytes uncompressed
 * @param authSecret  Subscription auth secret, 16 bytes
 * @returns The complete RFC8188 aes128gcm record (header + ciphertext).
 */
export async function encryptPayload(
	payload: Uint8Array,
	p256dh: Uint8Array,
	authSecret: Uint8Array
): Promise<Uint8Array> {
	// Validate the receiver public key shape early.
	if (p256dh.length !== 65 || p256dh[0] !== 0x04) {
		throw new Error(
			`p256dh must be a 65-byte uncompressed P-256 key (0x04||X||Y); got length=${p256dh.length}`
		);
	}
	if (authSecret.length !== 16) {
		throw new Error(`auth secret must be 16 bytes; got ${authSecret.length}`);
	}

	// (a) Ephemeral server P-256 keypair.
	const ephemeralKeyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits']
	);
	const ephemeralPublicKey = new Uint8Array(
		await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey)
	);

	// Import the receiver public key for ECDH.
	const receiverPublic = await crypto.subtle.importKey(
		'raw',
		p256dh as BufferSource,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);

	// (b) ECDH shared secret Z.
	const sharedZ = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: receiverPublic },
			ephemeralKeyPair.privateKey,
			256
		)
	);

	// (c1) IKM for the "auth" pseudo-random key.
	//   PRK_auth = HKDF-Extract(auth_secret, Z)
	//   IKM      = HKDF-Expand(PRK_auth, "Content-Encoding: auth\0", 32)
	const prkAuth = await hkdfExtract(authSecret, sharedZ);
	const authInfo = rfc8188Info('Content-Encoding: auth');
	const ikm = await hkdfExpand(prkAuth, authInfo, 32);

	// (c2) Random salt (16 bytes) for this record.
	const salt = crypto.getRandomValues(new Uint8Array(16));

	//   PRK = HKDF-Extract(salt, IKM)
	const prk = await hkdfExtract(salt, ikm);

	// (d) CEK and nonce.
	//   cek   = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
	//   nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
	//
	// The nonce derivation in RFC8188 also XORs a sequence number into the
	// trailing bytes, but for a single record (seq=0) the derived nonce is
	// used verbatim.
	const cekInfo = rfc8188Info('Content-Encoding: aes128gcm');
	const nonceInfo = rfc8188Info('Content-Encoding: nonce');
	const cek = await hkdfExpand(prk, cekInfo, 16);
	const nonce = await hkdfExpand(prk, nonceInfo, 12);

	// (e) Pad and encrypt. For a single record, append the delimiter 0x02 then
	//     zero bytes to fill the record up to rs - 16 (auth tag) - 1 (this pad
	//     byte). When the payload already fits the record, append just the
	//     0x02 delimiter and zero trailing padding.
	const maxPlaintextLen = RECORD_SIZE - 16 - PAD_SIZE;
	if (payload.length > maxPlaintextLen) {
		throw new Error(
			`Payload too large for a single push record (${payload.length} > ${maxPlaintextLen}). Multi-record push is not supported.`
		);
	}
	const padLen = maxPlaintextLen - payload.length;
	const plaintext = new Uint8Array(payload.length + 1 + padLen);
	plaintext.set(payload, 0);
	plaintext[payload.length] = 0x02; // last record delimiter
	// trailing bytes default to 0x00 (padding)

	const aesKey = await crypto.subtle.importKey(
		'raw',
		cek as BufferSource,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);
	const ciphertextWithTag = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
			aesKey,
			plaintext as BufferSource
		)
	);

	// (f) Assemble the RFC8188 record header.
	//   salt(16) || rs(uint32 BE) || idlen(uint8=65) || keyid(ephPub 65) || ciphertext
	const idLen = ephemeralPublicKey.length; // 65
	const header = new Uint8Array(16 + 4 + 1 + idLen);
	header.set(salt, 0);
	const dv = new DataView(header.buffer, header.byteOffset + 16, 4);
	dv.setUint32(0, RECORD_SIZE, false); // big-endian
	header[20] = idLen;
	header.set(ephemeralPublicKey, 21);

	return concatBytes(header, ciphertextWithTag);
}

/** Convenience wrapper: encrypt a JS object as UTF-8 JSON. */
export async function encryptJsonPayload(
	obj: unknown,
	p256dh: Uint8Array,
	authSecret: Uint8Array
): Promise<Uint8Array> {
	return encryptPayload(new TextEncoder().encode(JSON.stringify(obj)), p256dh, authSecret);
}
