<script module lang="ts">
	import type { LexicalEditorProps } from './LexicalEditor.svelte';

	type LexicalEditorComponent = typeof import('./LexicalEditor.svelte').default;

	// Cache the resolved editor across instances so a `{#key}` remount (e.g. after a
	// reply/comment submit) doesn't re-flash the skeleton - the chunk is already loaded.
	let cachedEditor: LexicalEditorComponent | null = null;

	// Drop the cached constructor on hot disposal. A `<script module>` context
	// outlives a Svelte component hot-update, so without this `cachedEditor` keeps
	// pointing at the pre-edit constructor after `LexicalEditor.svelte` is
	// recompiled. Reusing that stale constructor (whose compiled template state is
	// invalidated) then tearing it down leaves Svelte's effect graph referencing
	// dead nodes - the `node.remove is not a function` crash during branch destroy.
	if (import.meta.hot) {
		import.meta.hot.dispose(() => {
			cachedEditor = null;
		});
	}
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
	import { getEditorPrefsStore } from '$lib/stores/editor-prefs.svelte';
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';

	type LexicalEditorInstance = ReturnType<LexicalEditorComponent>;

	let { class: className = '', ...rest }: LexicalEditorProps = $props();
	let Editor = $state<LexicalEditorComponent | null>(cachedEditor);
	let inner: LexicalEditorInstance | undefined = $state();

	// Mirror the loaded editor's plain-mode gate: the real editor unmounts its
	// toolbar when plainMode is on, so the skeleton must drop its toolbar row
	// too (and the height then matches the plain editor, shrinking the swap
	// CLS). Reads the same session-hydrated store the editor does; the value is
	// correct on first paint because this lazy chunk loads after the root
	// layout's hydrate effect has run.
	const editorPrefs = getEditorPrefsStore();
	const plainMode = $derived(editorPrefs.prefs.plainMode);

	let mounted = true;

	onMount(() => {
		if (cachedEditor) {
			Editor = cachedEditor;
			return () => {
				mounted = false;
			};
		}
		void import('./LexicalEditor.svelte').then((module) => {
			cachedEditor = module.default;
			// Bail if the instance unmounted while the chunk was loading: setting
			// `Editor` would mount the heavy editor into a tearing-down subtree (the
			// HMR destroy race) and re-trigger the stale-node crash.
			if (mounted) Editor = cachedEditor;
		});
		return () => {
			mounted = false;
		};
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
		{#if !plainMode}
			<div class="flex items-center gap-1.5 border-b border-base-300 bg-base-200 p-1.5">
				<Skeleton class="h-6 w-32 rounded" />
			</div>
		{/if}
		<div class="prose prose-sm max-w-none min-h-[200px] px-3 py-2">
			<div class="space-y-2">
				<Skeleton class="h-3 w-3/4 rounded" />
				<Skeleton class="h-3 w-1/2 rounded" />
			</div>
		</div>
	</div>
{/if}
