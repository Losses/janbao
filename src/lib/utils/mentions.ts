/**
 * Extract `@username` mentions from a serialized Lexical JSON content string.
 *
 * The rich text editor stores content as a Lexical serialized state tree. This
 * walks every node, collects the raw text payloads, and matches `@username`
 * tokens against the canonical username character set (`[a-zA-Z0-9_-]{2,30}`).
 *
 * The editor does not currently emit dedicated mention nodes, so mentions are
 * resolved from plain-text `@username` tokens. Returns a de-duplicated list of
 * usernames (without the leading `@`), preserving first-seen order.
 */
interface LexicalNode {
	type: string;
	text?: string;
	children?: LexicalNode[];
}

const MENTION_PATTERN = /@[a-zA-Z0-9_-]{2,30}/g;

export function extractMentions(contentJson: string): string[] {
	let root: unknown;
	try {
		root = JSON.parse(contentJson);
	} catch {
		return [];
	}

	const texts: string[] = [];
	collectText(root, texts);

	const usernames: string[] = [];
	const seen = new Set<string>();
	for (const text of texts) {
		const matches = text.match(MENTION_PATTERN);
		if (!matches) continue;
		for (const match of matches) {
			const username = match.slice(1);
			if (!seen.has(username)) {
				seen.add(username);
				usernames.push(username);
			}
		}
	}
	return usernames;
}

function collectText(node: unknown, out: string[]): void {
	if (!node || typeof node !== 'object') return;
	const lexicalNode = node as LexicalNode;
	if (typeof lexicalNode.text === 'string') {
		out.push(lexicalNode.text);
	}
	if (Array.isArray(lexicalNode.children)) {
		for (const child of lexicalNode.children) {
			collectText(child, out);
		}
	}
}

/**
 * Reduce a serialized Lexical JSON content string to a single-line plain-text
 * preview, collapsing whitespace and truncating to `maxLen`. Used for message
 * inbox previews where rendered markup is not needed.
 */
export function extractPlainText(contentJson: string, maxLen = 120): string {
	let root: unknown;
	try {
		root = JSON.parse(contentJson);
	} catch {
		return '';
	}

	const texts: string[] = [];
	collectText(root, texts);
	const joined = texts.join('').replace(/\s+/g, ' ').trim();
	if (joined.length <= maxLen) return joined;
	return `${joined.slice(0, maxLen)}…`;
}
