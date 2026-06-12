<script lang="ts">
	/**
	 * LexicalRenderer Molecule — Recursively renders Lexical JSON states securely on the client.
	 * Supports standard text formats (bold, italic, underline, strikethrough, inline code),
	 * paragraphs, headings (h1-h4), quotes, lists (numbered, bulleted), links, and images.
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
	}

	let { contentJson = null, class: className = '' }: LexicalRendererProps = $props();

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
			{node.text}
		</span>
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
			<a
				href={node.url}
				target={node.url?.startsWith('http') ? '_blank' : undefined}
				rel="noopener noreferrer"
				class="text-primary hover:underline hover:text-primary-focus transition-colors"
			>
				{#if node.children}
					{#each node.children as child, i (i)}
						{@render renderNode(child)}
					{/each}
				{/if}
			</a>
		{:else if node.type === 'image'}
			<img
				src={node.src}
				alt={node.altText || 'Image'}
				class="max-w-full my-3 rounded-lg border border-base-300 shadow-sm"
				loading="lazy"
			/>
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
