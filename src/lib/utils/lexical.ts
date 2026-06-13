/**
 * Shared Lexical editor utilities and constraints.
 */

/** Shared maximum length of serialized Lexical content JSON string. */
export const MAX_CONTENT_SIZE = 512 * 1024; // 512 KiB

interface LexicalNode {
	type: string;
	text?: string;
	username?: string;
	src?: string;
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
