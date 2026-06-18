<script module lang="ts">
	import type { LexicalEditorProps } from './LexicalEditor.svelte';

	type LexicalEditorComponent = typeof import('./LexicalEditor.svelte').default;

	// Cache the resolved editor across instances so a `{#key}` remount (e.g. after a
	// reply/comment submit) doesn't re-flash the skeleton - the chunk is already loaded.
	let cachedEditor: LexicalEditorComponent | null = null;
</script>

<script lang="ts">
	/**
	 * LexicalEditorLazy - drops in wherever `LexicalEditor` is used, but splits the
	 * heavy editor (lexical + svelte-lexical + toolbar) into an async chunk that
	 * loads after first paint. Renders a dimension-matched skeleton meanwhile so the
	 * swap is zero-CLS. Props are forwarded 1:1 (including `class`), so call sites
	 * are unchanged. The `insertMention` instance method is forwarded to the loaded
	 * editor so parents that use `bind:this` (e.g. quickReply) keep working.
	 */
	import { onMount } from 'svelte';

	type LexicalEditorInstance = ReturnType<LexicalEditorComponent>;

	let { class: className = '', ...rest }: LexicalEditorProps = $props();
	let Editor = $state<LexicalEditorComponent | null>(cachedEditor);
	let inner: LexicalEditorInstance | undefined = $state();

	onMount(() => {
		if (cachedEditor) {
			Editor = cachedEditor;
			return;
		}
		void import('./LexicalEditor.svelte').then((module) => {
			cachedEditor = module.default;
			Editor = cachedEditor;
		});
	});

	export function insertMention(username: string, displayName: string): void {
		// No-ops if the editor chunk hasn't loaded yet (quickReply before hydration).
		inner?.insertMention?.(username, displayName);
	}
</script>

{#if Editor}
	<Editor bind:this={inner} {...rest} class={className} />
{:else}
	<!-- Skeleton mirrors the loaded editor's box model (bordered container + toolbar
	     row + min-h-[200px] content + the caller's margin class) so the swap is zero
	     layout shift. -->
	<div
		class="relative border border-base-300 bg-base-100 {className}"
		style="border-radius: var(--radius-field, 0.5rem);"
		role="status"
		aria-busy="true"
	>
		<div class="flex items-center gap-1.5 border-b border-base-300 bg-base-200 p-1.5">
			<div class="h-6 w-32 animate-pulse rounded bg-base-300/50"></div>
		</div>
		<div class="prose prose-sm max-w-none min-h-[200px] px-3 py-2">
			<div class="animate-pulse space-y-2">
				<div class="h-3 w-3/4 rounded bg-base-300/50"></div>
				<div class="h-3 w-1/2 rounded bg-base-300/50"></div>
			</div>
		</div>
	</div>
{/if}
