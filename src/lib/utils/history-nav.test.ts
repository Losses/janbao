import { test, expect, beforeEach, afterEach } from 'bun:test';
import { hopForHref, isTabRootPath, backSwipeShouldPopHistory } from './history-nav';

// Minimal Navigation History API stub. hopForHref only reads currentEntry
// { index, url } and entries() [{ url }], so that is all we model. We install
// it on globalThis via defineProperty (no cast) and clear it between tests.
interface StubEntry {
	url: string | null;
	index: number;
}

type StubEntries = () => StubEntry[];

interface StubNav {
	currentEntry: StubEntry | null;
	entries: StubEntries;
}

function setNav(entries: StubEntry[], current: StubEntry | null): void {
	const nav: StubNav = { currentEntry: current, entries: () => entries };
	Object.defineProperty(globalThis, 'navigation', {
		value: nav,
		configurable: true,
		writable: true
	});
}

function clearNav(): void {
	Object.defineProperty(globalThis, 'navigation', {
		value: undefined,
		configurable: true,
		writable: true
	});
}

beforeEach(clearNav);
afterEach(clearNav);

test('returns "push" when the Navigation API is absent (progressive enhancement)', () => {
	clearNav();
	expect(hopForHref('/')).toBe('push');
});

test('returns "push" when currentEntry is null', () => {
	setNav([], null);
	expect(hopForHref('/')).toBe('push');
});

test('returns "back" when the previous entry pathname matches', () => {
	setNav(
		[
			{ url: '/', index: 0 },
			{ url: '/activity', index: 1 }
		],
		{
			url: '/activity',
			index: 1
		}
	);
	expect(hopForHref('/')).toBe('back');
});

test('returns "forward" when the next entry matches and the previous does not', () => {
	setNav(
		[
			{ url: '/activity', index: 0 },
			{ url: '/', index: 1 },
			{ url: '/messages/inbox', index: 2 }
		],
		{ url: '/', index: 1 }
	);
	expect(hopForHref('/messages/inbox')).toBe('forward');
});

test('prefers back over forward when both neighbours match', () => {
	setNav(
		[
			{ url: '/activity', index: 0 },
			{ url: '/', index: 1 },
			{ url: '/activity', index: 2 }
		],
		{ url: '/', index: 1 }
	);
	expect(hopForHref('/activity')).toBe('back');
});

test('returns "push" when neither neighbour matches', () => {
	setNav(
		[
			{ url: '/activity', index: 0 },
			{ url: '/messages/inbox', index: 1 },
			{ url: '/activity', index: 2 }
		],
		{ url: '/messages/inbox', index: 1 }
	);
	expect(hopForHref('/')).toBe('push');
});

test('at index 0 never returns back (no previous entry)', () => {
	setNav(
		[
			{ url: '/', index: 0 },
			{ url: '/activity', index: 1 }
		],
		{ url: '/', index: 0 }
	);
	expect(hopForHref('/activity')).toBe('forward');
	expect(hopForHref('/messages/inbox')).toBe('push');
});

test('matches pathname only, ignoring search', () => {
	setNav(
		[
			{ url: '/?page=2', index: 0 },
			{ url: '/activity', index: 1 }
		],
		{
			url: '/activity',
			index: 1
		}
	);
	expect(hopForHref('/')).toBe('back');
});

test('treats a malformed previous URL as no match', () => {
	setNav(
		[
			{ url: 'not-a-url', index: 0 },
			{ url: '/activity', index: 1 }
		],
		{
			url: '/activity',
			index: 1
		}
	);
	expect(hopForHref('/')).toBe('push');
});

test('treats a null previous URL as no match', () => {
	setNav(
		[
			{ url: null, index: 0 },
			{ url: '/activity', index: 1 }
		],
		{
			url: '/activity',
			index: 1
		}
	);
	expect(hopForHref('/')).toBe('push');
});

test('compares a relative target href against absolute entry URLs (real API shape)', () => {
	setNav(
		[
			{ url: 'https://example.test/', index: 0 },
			{ url: 'https://example.test/activity?page=2', index: 1 }
		],
		{ url: 'https://example.test/activity?page=2', index: 1 }
	);
	// target href '/' (relative) vs prev entry pathname '/' (absolute, search ignored)
	expect(hopForHref('/')).toBe('back');
});

// --- isTabRootPath: the deep-page vs tab-root discriminator. Config-driven, so
// it must hold for EVERY deep route (the back-swipe fix's generality hinges on
// this - it must not special-case /discussion).
test('isTabRootPath is true only for the exact tab-root routes', () => {
	for (const root of ['/', '/activity', '/messages/inbox']) {
		expect(isTabRootPath(root), `${root} is a tab root`).toBe(true);
	}
});

test('isTabRootPath is false for every kind of deep page (no /discussion hardcoding)', () => {
	const deepPages = [
		'/discussion/1054/slug/p1',
		'/discussion/29586/foo',
		'/profile/7408/losses',
		'/profile/discussions/55/sunny',
		'/bookmarks',
		'/bookmarks/p2',
		'/search',
		'/notifications',
		'/post/discussion',
		'/post/editDiscussion/123',
		'/messages/new',
		'/messages/add/55',
		'/messages/2', // a conversation, NOT the inbox tab root
		'/admin',
		'/settings',
		'/discussions/p5',
		'/offline/123/slug',
		'/activity/p2' // an activity PAGE, not the root
	];
	for (const p of deepPages) {
		expect(isTabRootPath(p), `${p} is a deep page, not a tab root`).toBe(false);
	}
});

// --- backSwipeShouldPopHistory: a tab back-swipe must pop real history when the
// entry behind the tab is a deep page, and switch tabs otherwise.
test('backSwipeShouldPopHistory is false when the Navigation API is absent', () => {
	clearNav();
	expect(backSwipeShouldPopHistory()).toBe(false);
});

test('backSwipeShouldPopHistory is false at the first entry (nothing behind)', () => {
	setNav([{ url: '/activity', index: 0 }], { url: '/activity', index: 0 });
	expect(backSwipeShouldPopHistory()).toBe(false);
});

test('backSwipeShouldPopHistory is false when the previous entry is a tab root (normal tab<->tab)', () => {
	// On /activity, arrived from / (Discussions tab) -> spatial switch is correct.
	setNav(
		[
			{ url: '/', index: 0 },
			{ url: '/activity', index: 1 }
		],
		{ url: '/activity', index: 1 }
	);
	expect(backSwipeShouldPopHistory()).toBe(false);
});

test('backSwipeShouldPopHistory is false when the previous entry is a different tab root', () => {
	// On /messages/inbox, previous entry is /activity -> still tab<->tab.
	setNav(
		[
			{ url: '/activity', index: 0 },
			{ url: '/messages/inbox', index: 1 }
		],
		{ url: '/messages/inbox', index: 1 }
	);
	expect(backSwipeShouldPopHistory()).toBe(false);
});

test('backSwipeShouldPopHistory is TRUE when the previous entry is a deep page (the bug case)', () => {
	// / -> thread -> /activity : the thread is behind the tab. Back-swipe must
	// return to the thread, not push the discussions root on top of it.
	setNav(
		[
			{ url: '/', index: 0 },
			{ url: '/discussion/1054/slug/p1', index: 1 },
			{ url: '/activity', index: 2 }
		],
		{ url: '/activity', index: 2 }
	);
	expect(backSwipeShouldPopHistory()).toBe(true);
});

test('backSwipeShouldPopHistory is TRUE when the deep page belongs to a different tab than the spatial previous', () => {
	// On /messages/inbox (Tab 2), the spatial previous tab is /activity (Tab 1).
	// The history entry behind the tab is a thread (belongs to Tab 0 Discussions).
	// The user came from the thread, so back-swipe must pop history to it -
	// NOT switch to /activity. The deep page's tab association is irrelevant.
	setNav(
		[
			{ url: '/', index: 0 },
			{ url: '/discussion/1054/slug/p1', index: 1 },
			{ url: '/messages/inbox', index: 2 }
		],
		{ url: '/messages/inbox', index: 2 }
	);
	expect(backSwipeShouldPopHistory()).toBe(true);
});

test('backSwipeShouldPopHistory is TRUE for any deep page behind the tab (generality)', () => {
	// The fix must not special-case /discussion: ANY non-tab-root page behind the
	// tab (profile, bookmarks, search, a messages conversation, ...) counts.
	const deepPrevs = [
		'/profile/7408/losses',
		'/bookmarks',
		'/search',
		'/notifications',
		'/post/discussion',
		'/discussions/p5'
	];
	for (const prev of deepPrevs) {
		setNav(
			[
				{ url: '/', index: 0 },
				{ url: prev, index: 1 },
				{ url: '/activity', index: 2 }
			],
			{ url: '/activity', index: 2 }
		);
		expect(backSwipeShouldPopHistory(), `prev=${prev} should pop history`).toBe(true);
	}
});
