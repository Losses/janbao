import { test, expect } from 'bun:test';
import { isRealUserId, GHOST_USER_ID, SYSTEM_USER_ID } from './user';
import {
	SYSTEM_USER_ID as SERVER_SYSTEM_USER_ID,
	GHOST_USER_ID as SERVER_GHOST_USER_ID
} from '$lib/server/constants';

test('isRealUserId: accepts the super admin (id 0)', () => {
	// Regression guard: id 0 is the bootstrap admin account, not a sentinel.
	// A `> 0` guard wrongly dropped it from recipient lists and sync hydration.
	expect(isRealUserId(0)).toBe(true);
});

test('isRealUserId: accepts ordinary positive ids', () => {
	expect(isRealUserId(1)).toBe(true);
	expect(isRealUserId(7408)).toBe(true);
});

test('isRealUserId: rejects the System and Ghost sentinels', () => {
	expect(isRealUserId(SYSTEM_USER_ID)).toBe(false);
	expect(isRealUserId(GHOST_USER_ID)).toBe(false);
	expect(isRealUserId(-1)).toBe(false);
	expect(isRealUserId(-2)).toBe(false);
});

test('isRealUserId: rejects non-numeric / non-finite input', () => {
	expect(isRealUserId(NaN)).toBe(false);
	expect(isRealUserId(Infinity)).toBe(false);
	expect(isRealUserId(-Infinity)).toBe(false);
	expect(isRealUserId('0')).toBe(false);
	expect(isRealUserId(null)).toBe(false);
	expect(isRealUserId(undefined)).toBe(false);
	expect(isRealUserId(true)).toBe(false);
});

test('isRealUserId: narrows to number for type-checked callers', () => {
	const mixed: unknown[] = [0, -1, -2, 5, 'x', NaN];
	const real = mixed.filter(isRealUserId);
	expect(real).toEqual([0, 5]);
});

// Drift guard: the user-id sentinels are the single source of truth in
// `$lib/utils/user` and re-exported by `$lib/server/constants`. A future edit
// that defines either symbol directly in the server module would make server
// code and `isRealUserId` silently disagree; this test pins both modules to
// the same value.
test('sentinels: $lib/server/constants re-exports the canonical values', () => {
	expect(SERVER_SYSTEM_USER_ID).toBe(SYSTEM_USER_ID);
	expect(SERVER_GHOST_USER_ID).toBe(GHOST_USER_ID);
	expect(SERVER_SYSTEM_USER_ID).toBe(-1);
	expect(SERVER_GHOST_USER_ID).toBe(-2);
});
