import { test, expect } from 'bun:test';
import {
	initialNavState,
	initNav,
	switchTabNav,
	handleBeforeNavigateNav,
	handleAfterNavigateNav,
	backTargetFor,
	type NavState
} from './navigation-logic';

/**
 * Reproduces the mobile back-swipe matrix from
 * docs/mobile-gesture-backtarget-verification.md at the pure-logic level. Each
 * scenario drives the same init / switchTab / handleBeforeNavigate sequence the
 * live NavigationStore would see, then asserts backTargetFor matches the tab
 * the user actually came from.
 */

type Entry = 'hard' | 'reload' | 'tab' | 'sidebar';
type Source = 'discussion' | 'activity' | 'messages';

const TAB_HREF: Record<Source, string> = {
	discussion: '/',
	activity: '/activity',
	messages: '/messages/inbox'
};

function runScenario(entry: Entry, source: Source, target: string): string {
	let s: NavState = initialNavState();
	const src = TAB_HREF[source];
	if (entry === 'hard' || entry === 'reload') {
		s = initNav(s, src, '');
		s = handleBeforeNavigateNav(s, target, src, 'link', '');
	} else if (entry === 'tab') {
		s = initNav(s, '/', '');
		s = switchTabNav(s, src, '');
		s = handleBeforeNavigateNav(s, target, src, 'link', '');
	} else {
		// sidebar: land on home, then sidebar-link into the source tab, then into the target.
		s = initNav(s, '/', '');
		s = handleBeforeNavigateNav(s, src, '/', 'link', '');
		s = handleBeforeNavigateNav(s, target, src, 'link', '');
	}
	return backTargetFor(s);
}

interface Scenario {
	id: string;
	entry: Entry;
	source: Source;
	target: string;
	expected: string;
}

const A_GROUP: Scenario[] = [
	{
		id: 'A1',
		entry: 'hard',
		source: 'messages',
		target: '/bookmarks',
		expected: '/messages/inbox'
	},
	{ id: 'A2', entry: 'hard', source: 'activity', target: '/bookmarks', expected: '/activity' },
	{
		id: 'A3',
		entry: 'reload',
		source: 'messages',
		target: '/bookmarks',
		expected: '/messages/inbox'
	},
	{ id: 'A4', entry: 'tab', source: 'messages', target: '/bookmarks', expected: '/messages/inbox' },
	{ id: 'A5', entry: 'tab', source: 'activity', target: '/bookmarks', expected: '/activity' },
	{
		id: 'A6',
		entry: 'sidebar',
		source: 'messages',
		target: '/bookmarks',
		expected: '/messages/inbox'
	},
	{ id: 'A7', entry: 'hard', source: 'discussion', target: '/bookmarks', expected: '/' }
];

const GLOBAL_TARGETS = ['/bookmarks', '/notifications', '/profile', '/search', '/admin'];
const B_GROUP: Scenario[] = GLOBAL_TARGETS.map((target, i) => ({
	id: `B${i + 1}`,
	entry: 'hard',
	source: 'messages',
	target,
	expected: '/messages/inbox'
}));

for (const sc of [...A_GROUP, ...B_GROUP]) {
	test(`${sc.id}: ${sc.entry} entry, source=${sc.source}, target=${sc.target} → backTarget should be ${sc.expected}`, () => {
		const actual = runScenario(sc.entry, sc.source, sc.target);
		expect(actual).toBe(sc.expected);
	});
}

// Sanity: basic invariants of the reducers themselves.
test('init at a tab root leaves a single-entry stack', () => {
	let s = initialNavState();
	s = initNav(s, '/messages/inbox', '');
	expect(s.stacks[2]).toEqual([{ pathname: '/messages/inbox', search: '' }]);
});

test('init at a deep thread unshifts the tab root so back lands on the list', () => {
	let s = initialNavState();
	s = initNav(s, '/discussion/123/slug', '');
	expect(s.stacks[0].map((e) => e.pathname)).toEqual(['/', '/discussion/123/slug']);
});

test('handleAfterNavigate clears direction', () => {
	let s = initialNavState();
	s = handleBeforeNavigateNav(s, '/discussion/1', '/', 'link', '');
	expect(s.direction).toBe('forward');
	s = handleAfterNavigateNav(s);
	expect(s.direction).toBe('none');
});
