import { describe, test, expect } from 'bun:test';
import { searchUnderline } from './search-underline';

const N = 4;
const cellPct = 100 / N; // 25

describe('searchUnderline - resting', () => {
	test('snaps to the rounded cell, width === one cell, at every integer', () => {
		for (let i = 0; i <= N - 1; i++) {
			const u = searchUnderline(i, false, 0, N);
			expect(u.width).toBe(cellPct);
			expect(u.left).toBe(i * cellPct);
		}
	});

	test('rests (dragDir 0) even mid-drag: rounds to nearest cell', () => {
		const u = searchUnderline(1.4, true, 0, N);
		expect(u.left).toBe(1 * cellPct); // round(1.4) = 1
		expect(u.width).toBe(cellPct);
	});
});

describe('searchUnderline - stretching rightward', () => {
	test('width >= one cell everywhere and === cell only at integers', () => {
		for (let f = 0; f <= N - 1 + 1e-9; f += 0.05) {
			const u = searchUnderline(f, true, 1, N);
			expect(u.width).toBeGreaterThanOrEqual(cellPct - 1e-9);
			const atInteger = Math.abs(f - Math.round(f)) < 1e-9;
			if (atInteger) {
				expect(u.width).toBeCloseTo(cellPct, 5);
			} else {
				expect(u.width).toBeGreaterThan(cellPct);
			}
		}
	});

	test('exact t=0.5 rightward: leading races to target, width = 1.5 cells', () => {
		// from cell 1 toward 2: left pinned at cell-1 left (25), right at (1+1+0.5)*25 = 62.5
		const u = searchUnderline(1.5, true, 1, N);
		expect(u.left).toBeCloseTo(1 * cellPct, 5);
		expect(u.width).toBeCloseTo(1.5 * cellPct, 5);
	});

	test('from cell 0: left clamps to 0', () => {
		const u = searchUnderline(0.5, true, 1, N);
		expect(u.left).toBe(0);
		expect(u.width).toBeCloseTo(1.5 * cellPct, 5);
	});
});

describe('searchUnderline - stretching leftward', () => {
	test('width >= one cell everywhere and === cell only at integers', () => {
		for (let f = 0; f <= N - 1 + 1e-9; f += 0.05) {
			const u = searchUnderline(f, true, -1, N);
			expect(u.width).toBeGreaterThanOrEqual(cellPct - 1e-9);
			const atInteger = Math.abs(f - Math.round(f)) < 1e-9;
			if (atInteger) {
				expect(u.width).toBeCloseTo(cellPct, 5);
			} else {
				expect(u.width).toBeGreaterThan(cellPct);
			}
		}
	});

	test('exact t=0.5 leftward: trailing edge anchored at source-right, width = 1.5 cells', () => {
		// source = ceil(2.5) = 3; left = (3-0.5)*25 = 62.5, right = (3+1)*25 = 100
		const u = searchUnderline(2.5, true, -1, N);
		expect(u.left).toBeCloseTo(2.5 * cellPct, 5);
		expect(u.width).toBeCloseTo(1.5 * cellPct, 5);
	});
});
