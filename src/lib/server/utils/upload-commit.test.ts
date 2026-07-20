import { test, expect } from 'bun:test';
import { commitUploadedFile } from './upload-commit';

// Pin the atomicity contract of commitUploadedFile: the DB publish and the
// pCloud MOVE are ordered DB-first / MOVE-second, and a MOVE failure after a
// successful DB write MUST undo the DB write so storage and DB never diverge
// (no orphan file with no row, no row pointing at missing bytes). The tests
// inject the primitives, so they run under bun:test with no SvelteKit / D1 /
// pCloud environment.

test('commitUploadedFile: rolls back the DB write when the MOVE throws', async () => {
	// Load-bearing assertion: rollbackDbWrite MUST run after a successful
	// dbWrite followed by a failing move. Skipping it leaves a published DB row
	// pointing at bytes that were never moved into place.
	const dbWriteCalls: string[] = [];
	const rollbackCalls: string[] = [];
	const moveCalls: string[] = [];

	await expect(
		commitUploadedFile({
			dbWrite: async () => {
				dbWriteCalls.push('write');
			},
			move: async () => {
				moveCalls.push('move');
				throw new Error('pCloud MOVE failed');
			},
			rollbackDbWrite: async () => {
				rollbackCalls.push('rollback');
			}
		})
	).rejects.toThrow('pCloud MOVE failed');

	expect(dbWriteCalls).toEqual(['write']);
	expect(moveCalls).toEqual(['move']);
	expect(rollbackCalls).toEqual(['rollback']);
});

test('commitUploadedFile: does not call move or rollback when dbWrite throws', async () => {
	// dbWrite failure must short-circuit: no MOVE attempted, no compensation.
	const moveCalls: string[] = [];
	const rollbackCalls: string[] = [];

	await expect(
		commitUploadedFile({
			dbWrite: async () => {
				throw new Error('db connection dropped');
			},
			move: async () => {
				moveCalls.push('move');
			},
			rollbackDbWrite: async () => {
				rollbackCalls.push('rollback');
			}
		})
	).rejects.toThrow('db connection dropped');

	expect(moveCalls).toEqual([]);
	expect(rollbackCalls).toEqual([]);
});

test('commitUploadedFile: no rollback on full success', async () => {
	const rollbackCalls: string[] = [];
	let wrote = false;
	let moved = false;

	await commitUploadedFile({
		dbWrite: async () => {
			wrote = true;
		},
		move: async () => {
			moved = true;
		},
		rollbackDbWrite: async () => {
			rollbackCalls.push('rollback');
		}
	});

	expect(wrote).toBe(true);
	expect(moved).toBe(true);
	expect(rollbackCalls).toEqual([]);
});

test('commitUploadedFile: rollback failure does not mask the original move error', async () => {
	// If the rollback itself throws, the caller must still see the MOVE error
	// (which determines the HTTP response), not the cleanup error.
	await expect(
		commitUploadedFile({
			dbWrite: async () => {},
			move: async () => {
				throw new Error('move failed');
			},
			rollbackDbWrite: async () => {
				throw new Error('rollback also failed');
			}
		})
	).rejects.toThrow('move failed');
});
