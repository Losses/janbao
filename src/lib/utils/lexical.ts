/**
 * Shared Lexical editor utilities and constraints.
 */

/** Shared maximum length of serialized Lexical content JSON string. */
export const MAX_CONTENT_SIZE = 512 * 1024; // 512 KiB

interface LexicalNode {
	type: string;
	text?: string;
	username?: string;
	displayName?: string;
	src?: string;
	altText?: string;
	children?: LexicalNode[];
	root?: LexicalNode;
}

/**
 * Recursively traverses a Lexical JSON node to determine if it has any
 * user-provided meaningful content (non-whitespace text, mentions, images).
 */
function hasContent(node: unknown): boolean {
	if (!node || typeof node !== 'object') return false;
	const lexicalNode = node as LexicalNode;

	// Descend into root if checking from the top-level editor state JSON
	const entry: LexicalNode =
		lexicalNode.root && typeof lexicalNode.root === 'object' ? lexicalNode.root : lexicalNode;

	// Check for non-whitespace text
	if (typeof entry.text === 'string' && entry.text.trim() !== '') {
		return true;
	}

	// Check for dedicated mention node
	if (
		entry.type === 'mention' &&
		typeof entry.username === 'string' &&
		entry.username.trim() !== ''
	) {
		return true;
	}

	// Check for dedicated image node
	if (entry.type === 'image' && typeof entry.src === 'string' && entry.src.trim() !== '') {
		return true;
	}

	// Recursively inspect children nodes
	if (Array.isArray(entry.children)) {
		for (const child of entry.children) {
			if (hasContent(child)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Helper to check if a serialized Lexical JSON string is empty or contains no meaningful content.
 */
export function isLexicalEmpty(contentJson: string | null | undefined): boolean {
	if (!contentJson) return true;
	try {
		const root = JSON.parse(contentJson);
		return !hasContent(root);
	} catch {
		return true;
	}
}

/**
 * Recursively collect searchable text fragments from a Lexical node into `parts`.
 * - text node → its text
 * - mention node → username + displayName (so @mentions are searchable)
 * - image node → altText (so image descriptions are searchable)
 * - everything else (root/paragraph/heading/list/listitem/quote/link/code) → descend into children
 */
function collectSearchText(node: unknown, parts: string[]): void {
	if (!node || typeof node !== 'object') return;
	const lexicalNode = node as LexicalNode;
	const entry: LexicalNode =
		lexicalNode.root && typeof lexicalNode.root === 'object' ? lexicalNode.root : lexicalNode;

	if (entry.type === 'text' && typeof entry.text === 'string') {
		parts.push(entry.text);
		return;
	}
	if (entry.type === 'mention') {
		if (typeof entry.username === 'string') parts.push(entry.username);
		if (typeof entry.displayName === 'string') parts.push(entry.displayName);
		return;
	}
	if (entry.type === 'image' && typeof entry.altText === 'string') {
		parts.push(entry.altText);
		return;
	}

	if (Array.isArray(entry.children)) {
		for (const child of entry.children) {
			collectSearchText(child, parts);
		}
	}
}

/**
 * Extract plain searchable text from a serialized Lexical JSON string.
 *
 * Collects text from text nodes, @mention username/displayName, and image altText,
 * joining fragments with single spaces so trigram 3-character tokens never span
 * node boundaries. The result feeds the FTS5 trigram indexes
 * (see src/lib/server/search/fts.ts).
 *
 * Returns empty string for null/undefined/unparseable input (mirrors isLexicalEmpty).
 */
export function lexicalToSearchText(contentJson: string | null | undefined): string {
	if (!contentJson) return '';
	let parsed: unknown;
	try {
		parsed = JSON.parse(contentJson);
	} catch {
		return '';
	}
	const parts: string[] = [];
	collectSearchText(parsed, parts);
	return parts.join(' ').replace(/\s+/g, ' ').trim();
}
