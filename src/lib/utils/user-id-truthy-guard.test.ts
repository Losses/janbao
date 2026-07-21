// Preventive test: detect truthy guards on numeric user-id fields under src/.
//
// Background: id 0 is the bootstrap super admin (a real account). A truthy
// guard like the bare forms flagged below silently drops id 0 because 0 is
// falsy in JavaScript, even though batched lookups (sourceMap, participantMap,
// cached users) admit id 0 via an explicit `!== null` filter. The defect
// surfaces as the admin's display info, recipient eligibility, or editedBy
// attribution being replaced by a "System" / null fallback.
//
// Correct patterns (the patterns below deliberately do NOT match these):
//   - explicit null check: x.userId !== null, x.userId != null
//   - isRealUserId(x.userId) (excludes the System/Ghost sentinels)
//   - equality: x.userId === 0, x.userId === currentId
//   - map-membership: map.get(x.userId) (not a guard)
//
// SUB-PATTERN 2: Number(null) collision: when a user-id arrives from an
// optional source (searchParams, formData, JSON body), `Number(null) === 0`
// and `Number('') === 0`, both colliding with the real id-0 admin under an
// isRealUserId gate. The boundary must exclude the missing/empty case BEFORE
// calling Number, then apply isRealUserId. This test does NOT cover that
// data-flow-dependent pattern; reviewers audit new Number(<optional>) sites
// that feed isRealUserId on user-id-typed inputs.
//
// This file is excluded from its own scan.

import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const USER_ID_FIELDS = [
	'userId',
	'sourceUserId',
	'recipientId',
	'authorId',
	'editedBy',
	'editedById',
	'lastReplyAuthorId',
	'participantId',
	'inviterId',
	'byUserId',
	'fromUserId',
	'toUserId',
	'actorId',
	'targetUserId',
	'ownerId',
	'senderId',
	'receiverId',
	'creatorId',
	'reviewerId',
	'modifierId',
	'approverId',
	'usedById',
	'uploaderId'
] as const;

// Allowlist of `relative-path:line` entries permitted to use a truthy guard
// on a user-id field. Empty by design; add an entry ONLY if a truthy guard
// is provably correct for the data-flow at that site (e.g. the field is
// documented to never hold id 0 for that input shape).
const ALLOWLIST: string[] = [];

const FIELDS_RE = USER_ID_FIELDS.join('|');

// Identifier-chain prefix: word chars, dots, brackets, quotes (covers
// `r.userId`, `obj.foo.authorId`, `rows[0].userId`, `data['x'].senderId`).
const CHAIN = `[\\w$.\\[\\]'"]+`;

const TRUTHY_GUARD_PATTERNS: RegExp[] = [
	// `if (X.field)` or `if (!X.field)`, close-paren immediately after field
	new RegExp(`\\bif\\s*\\(\\s*!?${CHAIN}\\.(${FIELDS_RE})\\b\\s*\\)`),
	// Svelte `{#if X.field}` or `{:else if X.field}` (optionally negated)
	new RegExp(`\\{(?:#if|:else\\s+if)\\s+!?${CHAIN}\\.(${FIELDS_RE})\\b\\s*\\}`),
	// Ternary `X.field ?`: `?` after field, not the nullish `??` or `?.`
	new RegExp(`${CHAIN}\\.(${FIELDS_RE})\\b\\s*\\?(?!\\?|=)`),
	// Logical-or default `X.field ||` (excludes the nullish `??`)
	new RegExp(`${CHAIN}\\.(${FIELDS_RE})\\b\\s*\\|\\|`)
];

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.svelte']);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			walk(fullPath, out);
		} else if (SCAN_EXTENSIONS.has(extname(fullPath))) {
			out.push(fullPath);
		}
	}
	return out;
}

interface Violation {
	path: string;
	line: number;
	text: string;
}

interface TruthyGuardCase {
	text: string;
	shouldMatch: boolean;
}

function scan(srcRoot: string, selfPath: string): Violation[] {
	const violations: Violation[] = [];
	for (const filePath of walk(srcRoot)) {
		if (filePath === selfPath) continue;
		const text = readFileSync(filePath, 'utf8');
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const pattern of TRUTHY_GUARD_PATTERNS) {
				if (pattern.test(line)) {
					const rel = relative(srcRoot, filePath);
					const key = `${rel}:${i + 1}`;
					if (!ALLOWLIST.includes(key)) {
						violations.push({ path: rel, line: i + 1, text: line.trim() });
					}
				}
			}
		}
	}
	return violations;
}

const SRC_ROOT = join(import.meta.dir, '..', '..');
const SELF_PATH = import.meta.path;

// Sanity: the four guard patterns catch the bad forms and pass the good forms.
test('truthy-guard regex: positive and negative cases', () => {
	const cases: TruthyGuardCase[] = [
		// Defect forms, must match
		{ text: '\t\tif (r.userId) doSomething();', shouldMatch: true },
		{ text: 'if (!item.authorId) return null;', shouldMatch: true },
		{ text: '{#if notification.sourceUserId}', shouldMatch: true },
		{ text: '{#if !p.participantId}', shouldMatch: true },
		{ text: '{:else if row.editedBy}', shouldMatch: true },
		{ text: 'const source = r.sourceUserId ? map.get(r.sourceUserId) : null;', shouldMatch: true },
		{ text: 'const name = p.senderId || "anon";', shouldMatch: true },
		// Correct forms, must NOT match
		{ text: 'if (r.userId !== null) doSomething();', shouldMatch: false },
		{ text: 'if (r.userId != null) return;', shouldMatch: false },
		{ text: 'if (r.userId === 0) return admin;', shouldMatch: false },
		{ text: '{#if item.sourceUserId !== null}', shouldMatch: false },
		{ text: '{:else if row.editedBy != null}', shouldMatch: false },
		{ text: 'const a = isRealUserId(r.editedBy) ? x : y;', shouldMatch: false },
		{ text: 'const name = p.senderId ?? "anon";', shouldMatch: false },
		{ text: 'const u = userMap.get(r.userId);', shouldMatch: false },
		{ text: 'const n = r.userIds.length;', shouldMatch: false },
		{ text: 'if (Number.isNaN(targetUserId)) return;', shouldMatch: false }
	];
	for (const { text, shouldMatch } of cases) {
		const matched = TRUTHY_GUARD_PATTERNS.some((p) => p.test(text));
		expect(matched, `pattern match for: ${text}`).toBe(shouldMatch);
	}
});

// Binding horizontal check: zero unallowlisted truthy guards on user-id
// fields under src/. When this test fails, EITHER fix the flagged site to use
// an explicit null/equality/isRealUserId check, OR (if provably correct) add
// the `relative-path:line` to ALLOWLIST above with a justifying comment.
test('no truthy guards on user-id fields under src/', () => {
	const violations = scan(SRC_ROOT, SELF_PATH);
	const report = violations.map((v) => `${v.path}:${v.line}  =>  ${v.text}`).join('\n');
	expect(violations, report).toEqual([]);
});
