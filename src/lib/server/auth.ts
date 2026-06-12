// Helper utilities for Web Crypto API based JWT and password hashing.
// Compatible with Cloudflare Workers/Pages.

// --- Helper Functions ---
function bufferToHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
	const len = hex.length;
	const view = new Uint8Array(len / 2);
	for (let i = 0; i < len; i += 2) {
		view[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return view;
}

function base64urlEncode(str: string): string {
	const bytes = new TextEncoder().encode(str);
	return btoa(String.fromCharCode(...bytes))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function base64urlDecode(str: string): string {
	let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	while (base64.length % 4) {
		base64 += '=';
	}
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

// --- JWT Signing & Verification (HMAC SHA-256 / HS256) ---
async function getHmacKey(secret: string): Promise<CryptoKey> {
	const enc = new TextEncoder();
	return crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export interface JwtPayload {
	sub: string;
	username: string;
	role: string;
	exp?: number;
	iat?: number;
	[key: string]: unknown;
}

export function createSessionToken(
	sub: string,
	username: string,
	role: string,
	rememberMe: boolean
): JwtPayload {
	const now = Math.floor(Date.now() / 1000);
	const exp = rememberMe ? now + 2592000 : now + 86400;
	return { sub, username, role, iat: now, exp };
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
	const header = { alg: 'HS256', typ: 'JWT' };
	const headerPart = base64urlEncode(JSON.stringify(header));
	const payloadPart = base64urlEncode(JSON.stringify(payload));
	const message = `${headerPart}.${payloadPart}`;

	const key = await getHmacKey(secret);
	const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));

	const signaturePart = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	return `${message}.${signaturePart}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;

		const [headerPart, payloadPart, signaturePart] = parts;
		const message = `${headerPart}.${payloadPart}`;

		const key = await getHmacKey(secret);

		// Decode signature
		const binarySignature = atob(signaturePart.replace(/-/g, '+').replace(/_/g, '/'));
		const signatureBuffer = new Uint8Array(binarySignature.length);
		for (let i = 0; i < binarySignature.length; i++) {
			signatureBuffer[i] = binarySignature.charCodeAt(i);
		}

		const isValid = await crypto.subtle.verify(
			'HMAC',
			key,
			signatureBuffer,
			new TextEncoder().encode(message)
		);

		if (!isValid) return null;

		const payload = JSON.parse(base64urlDecode(payloadPart)) as JwtPayload;
		// Check expiration if present
		if (payload.exp && Date.now() / 1000 > payload.exp) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

// --- Password Hashing & Verification (PBKDF2 SHA-256) ---
export async function hashPassword(password: string): Promise<string> {
	const iterations = 100000;
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const saltHex = bufferToHex(salt.buffer);

	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveBits', 'deriveKey']
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt,
			iterations: iterations,
			hash: 'SHA-256'
		},
		baseKey,
		256
	);

	const hashHex = bufferToHex(derivedBits);
	return `pbkdf2:${iterations}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	try {
		const parts = storedHash.split(':');
		if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

		const iterations = parseInt(parts[1], 10);
		const salt = hexToBuffer(parts[2]);
		const storedHashHex = parts[3];

		const enc = new TextEncoder();
		const baseKey = await crypto.subtle.importKey(
			'raw',
			enc.encode(password),
			{ name: 'PBKDF2' },
			false,
			['deriveBits', 'deriveKey']
		);

		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: salt,
				iterations: iterations,
				hash: 'SHA-256'
			},
			baseKey,
			256
		);

		const candidateHashHex = bufferToHex(derivedBits);

		// Constant-time comparison
		if (candidateHashHex.length !== storedHashHex.length) return false;
		let result = 0;
		for (let i = 0; i < candidateHashHex.length; i++) {
			result |= candidateHashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
		}

		return result === 0;
	} catch {
		return false;
	}
}
