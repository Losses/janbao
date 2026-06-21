import { test, expect } from 'bun:test';
import { isRealUserId, GHOST_USER_ID, SYSTEM_USER_ID } from './user';

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
