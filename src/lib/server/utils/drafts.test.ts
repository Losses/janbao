import { test, expect } from 'bun:test';
import { normalizeDraftContextId } from './drafts';

// Regression guard: a non-numeric contextId (e.g. the literal 'new' a client
// sends for the "new composer" draft) must NOT pass through to the
// INTEGER-affinity drafts.context_id column, where SQLite would store it as
// TEXT and silently bypass every integer-keyed load/clear query (which query
// contextId = 0 for that draft), leaking one orphan row per call. The helper
// is the single boundary that prevents the entire drafts endpoint family from
// reintroducing the silent-data-loss gap.

test('normalizeDraftContextId: passes 0 through (the "new composer" draft key)', () => {
	expect(normalizeDraftContextId(0)).toBe(0);
});

test('normalizeDraftContextId: passes a positive integer through unchanged', () => {
	expect(normalizeDraftContextId(42)).toBe(42);
	expect(normalizeDraftContextId(1)).toBe(1);
	expect(normalizeDraftContextId(7408)).toBe(7408);
});

test('normalizeDraftContextId: coerces the "new" sentinel string to 0', () => {
	expect(normalizeDraftContextId('new')).toBe(0);
	expect(normalizeDraftContextId('42')).toBe(0);
});

test('normalizeDraftContextId: coerces null / undefined to 0', () => {
	expect(normalizeDraftContextId(null)).toBe(0);
	expect(normalizeDraftContextId(undefined)).toBe(0);
});

test('normalizeDraftContextId: coerces NaN / Infinity / -Infinity to 0', () => {
	expect(normalizeDraftContextId(NaN)).toBe(0);
	expect(normalizeDraftContextId(Infinity)).toBe(0);
	expect(normalizeDraftContextId(-Infinity)).toBe(0);
});

test('normalizeDraftContextId: passes a finite float through as-is', () => {
	// SQLite INTEGER affinity coerces on storage, so a finite float converges
	// with its integer-keyed peers at the column level. The helper does not
	// floor; it preserves the caller's value.
	expect(normalizeDraftContextId(3.7)).toBe(3.7);
});

test('normalizeDraftContextId: rejects other non-number types', () => {
	expect(normalizeDraftContextId(true)).toBe(0);
	expect(normalizeDraftContextId(false)).toBe(0);
	expect(normalizeDraftContextId({})).toBe(0);
	expect(normalizeDraftContextId([1])).toBe(0);
});
