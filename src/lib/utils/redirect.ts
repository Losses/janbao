/**
 * Open-redirect defense and URL builder for post-login destination handling.
 *
 * Loaders that gate on authentication preserve the requested path via
 * `?redirectTo=<encoded>` so the signin page can route the user back after a
 * successful login. The validator here is the trust boundary: every value
 * read back from a query string MUST pass `isSafeInternalRedirect` before it
 * is fed to `goto`/`redirect`, otherwise an attacker-crafted link can send a
 * freshly-authenticated user to an external origin.
 *
 * Rules (defense in depth; every layer must pass):
 *   1. Non-empty and starts with a single '/' (rejects `relative/path`,
 *      `https://host`, empty input).
 *   2. Does NOT start with '//' (protocol-relative → host `evil.com`) or
 *      '/\\' (browsers normalize backslashes to slashes).
 *   3. Contains no backslashes anywhere (same browser-normalization trick).
 *   4. Contains no '://' scheme separator (catches `javascript:`, `data:`,
 *      `https://` once a leading slash is somehow injected).
 *   5. Resolves, relative to the current origin, to the SAME origin. This is
 *      the final guard: even if the lexical rules above pass, the parsed URL
 *      must land on the same host.
 */

const SCHEME_SEPARATOR = /:\/\//;
const SIGNIN_BASE = '/entry/signin';

/**
 * True iff `target` is a same-origin relative path that is safe to use as a
 * post-login destination. Pure predicate (no I/O, no globals), so it is
 * deterministic and unit-testable.
 */
export function isSafeInternalRedirect(target: string | null | undefined, origin: string): boolean {
	if (typeof target !== 'string' || target.length === 0) return false;
	if (!target.startsWith('/')) return false;
	if (target.startsWith('//') || target.startsWith('/\\')) return false;
	if (target.includes('\\')) return false;
	if (SCHEME_SEPARATOR.test(target)) return false;
	try {
		const resolved = new URL(target, origin);
		return resolved.origin === origin;
	} catch {
		return false;
	}
}

/**
 * Resolve a post-login destination. Returns the validated target, or '/' when
 * the input is missing or fails validation. Callers MUST use this instead of
 * raw `searchParams.get('redirectTo')` so the open-redirect guard is applied
 * at every consumer.
 */
export function resolveInternalRedirect(target: string | null | undefined, origin: string): string {
	return isSafeInternalRedirect(target, origin) ? (target as string) : '/';
}

/**
 * Build the sign-in redirect URL, preserving the requested pathname as the
 * `redirectTo` query parameter. Use this from any auth-gating loader (or a
 * client-side auth fallback) so the post-login destination is consistent
 * across the codebase and always URL-encoded.
 *
 * Only the pathname is forwarded; query strings and fragments are dropped,
 * because (a) post-login return-to-page semantics are about the resource, not
 * transient filters, and (b) it keeps the parameter short and free of
 * second-level encoding pitfalls.
 */
export function buildSignInRedirectUrl(pathname: string): string {
	return `${SIGNIN_BASE}?redirectTo=${encodeURIComponent(pathname)}`;
}
