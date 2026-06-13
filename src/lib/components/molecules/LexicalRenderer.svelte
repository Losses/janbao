<script lang="ts">
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import { generateSlug } from '$lib/utils/slug';
	/**
	 * LexicalRenderer Molecule - Recursively renders Lexical JSON states securely on the client.
	 * Supports standard text formats (bold, italic, underline, strikethrough, inline code),
	 * paragraphs, headings (h1-h4), quotes, lists (numbered, bulleted), links, images,
	 * and @username mention chips.
	 */
	interface LexicalNode {
		type: string;
		text?: string;
		url?: string;
		src?: string;
		altText?: string;
		tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
		listType?: 'number' | 'bullet' | 'check';
		checked?: boolean;
		format?: number;
		style?: string;
		children?: LexicalNode[];
	}

	interface LexicalRendererProps {
		contentJson?: string | null;
		class?: string;
		mentionedUsers?: MentionedUsersMap | null;
	}

	let {
		contentJson = null,
		class: className = '',
		mentionedUsers = null
	}: LexicalRendererProps = $props();

	/** Defense-in-depth: only allow http/https URLs to prevent Stored XSS */
	function safeUrl(url: string | undefined): string {
		if (!url) return '';
		if (url.startsWith('http://') || url.startsWith('https://')) return url;
		return '';
	}

	/**
	 * Regex pattern to match @username mentions in text.
	 * Matches @ followed by 2-30 alphanumeric, underscore, or hyphen characters.
	 */
	const MENTION_REGEX = /@[a-zA-Z0-9_-]{2,30}/g;

	/**
	 * Split a text string into segments, replacing @username tokens
	 * with mention chip placeholder objects when the username exists in the map.
	 */
	interface TextSegment {
		kind: 'text' | 'mention';
		text: string;
		username: string;
	}

	function parseMentions(text: string): TextSegment[] {
		if (!mentionedUsers || Object.keys(mentionedUsers).length === 0) {
			return [{ kind: 'text', text, username: '' }];
		}

		const segments: TextSegment[] = [];
		let lastIndex = 0;

		// Reset regex state for global matching
		const regex = new RegExp(MENTION_REGEX.source, 'g');
		let match: RegExpExecArray | null;

		while ((match = regex.exec(text)) !== null) {
			const username = match[0].slice(1); // strip leading @

			// Only convert to chip if the user exists in the map
			if (mentionedUsers[username]) {
				// Push preceding plain text
				if (match.index > lastIndex) {
					segments.push({ kind: 'text', text: text.slice(lastIndex, match.index), username: '' });
				}
				segments.push({ kind: 'mention', text: match[0], username });
				lastIndex = regex.lastIndex;
			}
		}

		// Push remaining text
		if (lastIndex < text.length) {
			segments.push({ kind: 'text', text: text.slice(lastIndex), username: '' });
		}

		// If no mentions were found, return single text segment
		if (segments.length === 0) {
			return [{ kind: 'text', text, username: '' }];
		}

		return segments;
	}

	const rootNode = $derived.by(() => {
		if (!contentJson) return null;
		try {
			const parsed = JSON.parse(contentJson);
			// Lexical states usually have a top-level { root: { children: [...] } }
			return parsed.root || parsed;
		} catch {
			// Fallback: render as single plain text paragraph if JSON is invalid
			return {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{
								type: 'text',
								text: contentJson,
								format: 0
							}
						]
					}
				]
			};
		}
	});
</script>

{#snippet renderNode(node: LexicalNode)}
	{#if node.type === 'text'}
		{#each parseMentions(node.text || '') as segment, idx (idx)}
			{#if segment.kind === 'mention' && mentionedUsers?.[segment.username]}
				{@const user = mentionedUsers[segment.username]}
				<a
					href="/profile/{user.id}/{generateSlug(user.username)}"
					class="inline-flex items-center gap-0.5 px-1.5 py-0 mx-0.5 rounded bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors no-underline"
				>
					{user.displayName}
				</a>
			{:else}
				<span
					class="{(node.format ?? 0) & 1 ? 'font-bold' : ''} {(node.format ?? 0) & 2
						? 'italic'
						: ''} {(node.format ?? 0) & 4 ? 'line-through' : ''} {(node.format ?? 0) & 8
						? 'underline'
						: ''} {(node.format ?? 0) & 16
						? 'bg-base-300 px-1.5 py-0.5 rounded font-mono text-xs text-secondary-content'
						: ''}"
					style={node.style || undefined}
				>
					{segment.text}
				</span>
			{/if}
		{/each}
	{:else}
		{#if node.type === 'paragraph'}
			<p class="mb-2 leading-relaxed text-base-content/95 min-h-[1.2em]">
				{#if node.children}
					{#each node.children as child, i (i)}
						{@render renderNode(child)}
					{/each}
				{/if}
			</p>
		{:else if node.type === 'heading'}
			{#if node.tag === 'h1'}
				<h1 class="text-2xl font-bold mt-4 mb-2 text-base-content">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</h1>
			{:else if node.tag === 'h2'}
				<h2 class="text-xl font-bold mt-3 mb-2 text-base-content">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</h2>
			{:else if node.tag === 'h3'}
				<h3 class="text-lg font-bold mt-3 mb-1 text-base-content">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</h3>
			{:else}
				<h4 class="text-base font-bold mt-2 mb-1 text-base-content">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</h4>
			{/if}
		{:else if node.type === 'quote'}
			<blockquote
				class="border-l-4 border-primary bg-base-200/40 pl-4 py-2 my-3 rounded-r-lg italic text-base-content/80"
			>
				{#if node.children}
					{#each node.children as child, i (i)}
						{@render renderNode(child)}
					{/each}
				{/if}
			</blockquote>
		{:else if node.type === 'list'}
			{#if node.listType === 'number'}
				<ol class="list-decimal ml-6 mb-3 space-y-1">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</ol>
			{:else}
				<ul class="list-disc ml-6 mb-3 space-y-1">
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</ul>
			{/if}
		{:else if node.type === 'listitem'}
			<li class="text-base-content/90">
				{#if node.children}
					{#each node.children as child, i (i)}
						{@render renderNode(child)}
					{/each}
				{/if}
			</li>
		{:else if node.type === 'link' || node.type === 'autolink'}
			{#if safeUrl(node.url)}
				<a
					href={safeUrl(node.url)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-primary hover:underline hover:text-primary-focus transition-colors"
				>
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</a>
			{:else}
				<span>
					{#if node.children}
						{#each node.children as child, i (i)}
							{@render renderNode(child)}
						{/each}
					{/if}
				</span>
			{/if}
		{:else if node.type === 'image'}
			{#if safeUrl(node.src)}
				<img
					src={safeUrl(node.src)}
					alt={node.altText || 'Image'}
					class="max-w-full my-3 rounded-lg border border-base-300 shadow-sm"
					loading="lazy"
				/>
			{/if}
		{:else if node.children}
			{#each node.children as child, i (i)}
				{@render renderNode(child)}
			{/each}
		{/if}
	{/if}
{/snippet}

<div class="prose prose-sm max-w-none {className}">
	{#if rootNode && rootNode.children}
		{#each rootNode.children as child, i (i)}
			{@render renderNode(child)}
		{/each}
	{/if}
</div>
