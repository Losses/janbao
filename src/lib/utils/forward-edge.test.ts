import { test, expect } from 'bun:test';
import { resolveForwardTarget } from './forward-edge';

test('resolveForwardTarget returns the next primary tab for a non-last tab', () => {
	expect(resolveForwardTarget(0)).toEqual({ kind: 'tab', index: 1 });
	expect(resolveForwardTarget(1)).toEqual({ kind: 'tab', index: 2 });
});

test('resolveForwardTarget returns the deep neighbour for the last tab that declares one', () => {
	expect(resolveForwardTarget(2)).toEqual({ kind: 'deep', href: '/search' });
});

test('resolveForwardTarget returns null when there is no next tab and no deep neighbour', () => {
	expect(resolveForwardTarget(99)).toBeNull();
});
