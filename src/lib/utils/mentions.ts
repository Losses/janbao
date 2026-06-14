/**
 * Extract `@username` mentions from a serialized Lexical JSON content string.
 *
 * The rich text editor stores content as a Lexical serialized state tree. This
 * walks every node, collects the raw text payloads, and matches `@username`
 * tokens against the canonical username character set (`[a-zA-Z0-9_-]{2,30}`).
 *
 * Also handles dedicated MentionNode entries (type: 'mention') which store the
 * username directly. Returns a de-duplicated list of usernames (without the
 * leading `@`), preserving first-seen order.
 */
interface LexicalNode {
	type: string;
	text?: string;
	username?: string;
	children?: LexicalNode[];
	root?: LexicalNode;
}

const MENTION_PATTERN = /@[\p{L}\p{N}_-]{2,30}/gu;

export function extractMentions(contentJson: string): string[] {
	let root: unknown;
	try {
		root = JSON.parse(contentJson);
	} catch {
		return [];
	}

	const texts: string[] = [];
	const mentionUsernames: string[] = [];
	collectTextAndMentions(root, texts, mentionUsernames);

	const usernames: string[] = [];
	const seen = new Set<string>();

	// First, add usernames from dedicated MentionNodes
	for (const username of mentionUsernames) {
		if (!seen.has(username)) {
			seen.add(username);
			usernames.push(username);
		}
	}

	// Then, extract @username tokens from plain text
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

function collectTextAndMentions(node: unknown, texts: string[], mentionUsernames: string[]): void {
	if (!node || typeof node !== 'object') return;
	const lexicalNode = node as LexicalNode;

	// A serialized Lexical state is wrapped as { root: { type: 'root', children: [...] } }.
	// Callers pass the parsed JSON object, so descend into `root` on the entry node;
	// recursive children have no `root` and are traversed directly.
	const entry: LexicalNode =
		lexicalNode.root && typeof lexicalNode.root === 'object' ? lexicalNode.root : lexicalNode;

	// Collect plain text content
	if (typeof entry.text === 'string') {
		texts.push(entry.text);
	}

	// Collect username from dedicated MentionNode
	if (entry.type === 'mention' && typeof entry.username === 'string') {
		mentionUsernames.push(entry.username);
	}

	if (Array.isArray(entry.children)) {
		for (const child of entry.children) {
			collectTextAndMentions(child, texts, mentionUsernames);
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
	const mentionUsernames: string[] = [];
	collectTextAndMentions(root, texts, mentionUsernames);

	// Include mention display names as @username in the plain text
	const allTexts = [...texts, ...mentionUsernames.map((u) => `@${u}`)];

	const joined = allTexts.join('').replace(/\s+/g, ' ').trim();
	if (joined.length <= maxLen) return joined;
	return `${joined.slice(0, maxLen)}…`;
}
