import { test, expect } from 'bun:test';
import {
	isSafeInternalRedirect,
	resolveInternalRedirect,
	buildSignInRedirectUrl
} from './redirect';

const ORIGIN = 'https://forum.example.com';

test('isSafeInternalRedirect: accepts same-origin relative paths', () => {
	expect(isSafeInternalRedirect('/profile/edit', ORIGIN)).toBe(true);
	expect(isSafeInternalRedirect('/bookmarks', ORIGIN)).toBe(true);
	expect(isSafeInternalRedirect('/bookmarks?page=2', ORIGIN)).toBe(true);
	expect(isSafeInternalRedirect('/discussion/123/foo', ORIGIN)).toBe(true);
	expect(isSafeInternalRedirect('/', ORIGIN)).toBe(true);
});

test('isSafeInternalRedirect: rejects protocol-relative URLs', () => {
	// Regression guard for the open-redirect class called out in the signin
	// finding: a leading `//` is treated by browsers as scheme-relative.
	expect(isSafeInternalRedirect('//evil.com', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('//evil.com/path', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('///evil.com', ORIGIN)).toBe(false);
});

test('isSafeInternalRedirect: rejects absolute URLs with a scheme', () => {
	expect(isSafeInternalRedirect('https://evil.com', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('http://evil.com/path', ORIGIN)).toBe(false);
	// Even an absolute URL on the SAME origin must be rejected; the rule is
	// "same-origin RELATIVE path", not "same-origin host".
	expect(isSafeInternalRedirect('https://forum.example.com/path', ORIGIN)).toBe(false);
});

test('isSafeInternalRedirect: rejects backslash tricks', () => {
	// Browsers normalize `\` to `/` in path positions, so `/\\evil.com` is
	// equivalent to `//evil.com` once the browser parses it.
	expect(isSafeInternalRedirect('/\\evil.com', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('/path/\\evil.com', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('/foo\\bar', ORIGIN)).toBe(false);
});

test('isSafeInternalRedirect: rejects non-relative and empty input', () => {
	expect(isSafeInternalRedirect('relative/path', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect('', ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect(null, ORIGIN)).toBe(false);
	expect(isSafeInternalRedirect(undefined, ORIGIN)).toBe(false);
});

test('isSafeInternalRedirect: requires the resolved origin to match', () => {
	// A pathname that escapes the origin via an embedded authority component
	// would be caught by the earlier lexical rules, but the origin check is
	// the defense-in-depth backstop.
	expect(isSafeInternalRedirect('/path', 'not-a-url')).toBe(false);
});

test('resolveInternalRedirect: returns the target when safe', () => {
	expect(resolveInternalRedirect('/profile/edit', ORIGIN)).toBe('/profile/edit');
});

test('resolveInternalRedirect: falls back to "/" for unsafe or missing input', () => {
	expect(resolveInternalRedirect(null, ORIGIN)).toBe('/');
	expect(resolveInternalRedirect('', ORIGIN)).toBe('/');
	expect(resolveInternalRedirect('//evil.com', ORIGIN)).toBe('/');
	expect(resolveInternalRedirect('https://evil.com', ORIGIN)).toBe('/');
	expect(resolveInternalRedirect('/\\evil.com', ORIGIN)).toBe('/');
});

test('buildSignInRedirectUrl: encodes the pathname exactly once', () => {
	expect(buildSignInRedirectUrl('/profile/edit')).toBe(
		'/entry/signin?redirectTo=%2Fprofile%2Fedit'
	);
	expect(buildSignInRedirectUrl('/bookmarks?page=2')).toBe(
		'/entry/signin?redirectTo=%2Fbookmarks%3Fpage%3D2'
	);
});

test('buildSignInRedirectUrl: round-trips through decodeURIComponent into isSafeInternalRedirect', () => {
	const pathname = '/profile/edit';
	const built = buildSignInRedirectUrl(pathname);
	const encoded = built.slice('/entry/signin?redirectTo='.length);
	const decoded = decodeURIComponent(encoded);
	expect(isSafeInternalRedirect(decoded, ORIGIN)).toBe(true);
});
