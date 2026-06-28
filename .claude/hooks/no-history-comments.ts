/// <reference types="bun" />

/**
 * PreToolUse hook: block code comments that reference a superseded
 * implementation.
 *
 * A comment describing how the code looked before this edit only makes sense to
 * someone who saw the earlier version; a future reader sees working code plus a
 * confusing reference to something that no longer exists. Such comments must
 * state current intent only (what the code IS and WHY, forward-looking); the
 * history of how the code reached this state belongs in version control, not
 * inline.
 *
 * Scope is tight to avoid false positives: source files only (.md/.json/memory
 * skipped), comment lines only (// * /* #) so identifiers and strings are
 * ignored, and high-precision phrases rather than bare words. The list is
 * intentionally high-precision, not exhaustive: it catches common variants but
 * cannot enumerate every phrasing, so the pre-save self-check (see memory
 * no-error-history-comments) remains the primary guard.
 */
const CODE_EXTS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.vue',
	'.astro',
	'.css',
	'.scss',
	'.less',
	'.html',
	'.py',
	'.go',
	'.rs',
	'.java',
	'.kt',
	'.swift',
	'.c',
	'.cpp',
	'.h',
	'.hpp',
	'.sql'
]);

interface HookInput {
	tool_name?: string;
	tool_input?: ToolInput;
}

type ToolInput = Record<string, unknown>;

interface NewContent {
	label: string;
	text: string;
}

interface BoolRef {
	value: boolean;
}

// Phrases that, in a comment, almost always point at superseded code.
const PATTERN =
	/\b(formerly|originally|used to be|once was|once were|the former|the old|was previously|previously this|replaces the (?:former|old|prior|previous)|replaced the|instead of (?:a|the) (?:fixed|old|former|previous|prior)|(?:switched|migrated|changed|refactored) from|got rid of)\b/i;

function isComment(line: string): boolean {
	const stripped = line.trimStart();
	return (
		stripped.startsWith('//') ||
		stripped.startsWith('*') ||
		stripped.startsWith('/*') ||
		stripped.startsWith('#')
	);
}

function isCodePath(path: string): boolean {
	if (!path) return false;
	if (path.replaceAll('\\', '/').includes('/memory/')) return false;
	const dot = path.lastIndexOf('.');
	if (dot < 0) return false;
	return CODE_EXTS.has(path.slice(dot).toLowerCase());
}

function scan(label: string, text: string, hits: string[], sawComment: BoolRef): void {
	for (const line of text.split('\n')) {
		if (!isComment(line)) continue;
		sawComment.value = true;
		const match = PATTERN.exec(line);
		if (match) hits.push(`  [${label}] '${match[1]}' :: ${line.trim()}`);
	}
}

function textOf(input: ToolInput, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' ? value : undefined;
}

function newContents(toolName: string, input: ToolInput): NewContent[] {
	const out: NewContent[] = [];
	if (toolName === 'Write') {
		const filePath = textOf(input, 'file_path');
		const content = textOf(input, 'content');
		if (content !== undefined && filePath !== undefined && isCodePath(filePath))
			out.push({ label: filePath, text: content });
	} else if (toolName === 'Edit') {
		const filePath = textOf(input, 'file_path');
		const newString = textOf(input, 'new_string');
		if (newString !== undefined && filePath !== undefined && isCodePath(filePath))
			out.push({ label: filePath, text: newString });
	} else if (toolName === 'MultiEdit') {
		const filePath = textOf(input, 'file_path');
		if (filePath !== undefined && isCodePath(filePath) && Array.isArray(input['edits'])) {
			for (const edit of input['edits'] as ToolInput[]) {
				const newString = textOf(edit, 'new_string');
				if (newString !== undefined) out.push({ label: filePath, text: newString });
			}
		}
	} else if (toolName === 'NotebookEdit') {
		const notebookPath = textOf(input, 'notebook_path');
		const newSource = textOf(input, 'new_source');
		if (newSource !== undefined && notebookPath !== undefined)
			out.push({ label: notebookPath, text: newSource });
	}
	return out;
}

async function main(): Promise<number> {
	let raw: string;
	try {
		raw = await Bun.stdin.text();
	} catch {
		return 0; // fail open on read error
	}
	let data: HookInput;
	try {
		data = JSON.parse(raw) as HookInput;
	} catch {
		return 0; // fail open on malformed input
	}
	const toolName = data.tool_name ?? '';
	const input = data.tool_input ?? {};
	const hits: string[] = [];
	const sawComment: BoolRef = { value: false };
	for (const { label, text } of newContents(toolName, input)) scan(label, text, hits, sawComment);
	if (hits.length > 0) {
		const message =
			'no-history-comments: blocked a comment referencing a superseded implementation. ' +
			'Rewrite to current intent only (what the code IS and WHY, forward-looking):\n' +
			hits.join('\n') +
			'\n';
		process.stderr.write(message);
		return 2; // PreToolUse exit 2 => block the tool call
	}
	// The phrase allowlist is not exhaustive: nudge the model to self-check the
	// comments it just wrote, so a phrasing the list does not cover is still
	// caught. Emitted only when the edit actually added comments to a code file.
	if (sawComment.value) {
		process.stdout.write(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					additionalContext:
						'no-history-comments: the phrase allowlist passed, but it is NOT exhaustive. ' +
						'Re-read every comment you just wrote and confirm none references a ' +
						'superseded implementation; if any does, rewrite it to current intent only.'
				}
			}) + '\n'
		);
	}
	return 0;
}

main().then((code) => process.exit(code));
