/**
 * Server-side drafts utility.
 *
 * Centralises the boundary coercion for `drafts.context_id` so every
 * drafts endpoint (save / clear / delete) applies the same normalization
 * when accepting a client-supplied contextId.
 */

/**
 * Normalize an incoming drafts.contextId value to a finite integer suitable
 * for storage in the INTEGER-affinity `drafts.context_id` column.
 *
 * Defense-in-depth: SQLite's INTEGER affinity silently stores a TEXT value
 * (e.g. the literal "new" a client may send for the "new composer" draft)
 * under TEXT storage class, which then bypasses every integer-keyed lookup
 * on the load and clear paths (they query `contextId = 0` for the "new"
 * composer draft), leaking one orphan row per call. Forcing the boundary
 * value to a finite number here means the unique index
 * (authorId, contextType, contextId) converges manual and auto saves onto
 * a single row regardless of caller, and a non-numeric input degrades to
 * the canonical 0 (the "new" composer draft key) instead of an orphan row.
 *
 * Floats are passed through as-is; SQLite's INTEGER affinity coerces them
 * on storage so callers that pass a non-integer still converge with their
 * integer-keyed peers. The current callers only ever pass an integer or a
 * non-numeric sentinel.
 *
 * Behavior:
 *   - finite number -> the number itself
 *   - NaN / Infinity / non-number / null / undefined -> 0
 */
export function normalizeDraftContextId(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
