<script lang="ts">
	/**
	 * OverlaySidebarBinding - registers a thread page's sidebar snippet into the
	 * overlay-sidebar store so the `(tabs)` layout's single DualColumnLayout can
	 * render it in the drawer while the thread is shown as a mobile overlay.
	 * Renders nothing; mount it once in the page's mobile branch.
	 *
	 * A binding (not direct setContext) because Svelte context only flows
	 * parent→child and the `(tabs)` layout (parent) owns the drawer, while the
	 * sidebar content is page-specific (defined here, in the child). Snippets are
	 * template-scoped, so this component receives the snippet as a prop and
	 * publishes it on mount, clearing on destroy.
	 */
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { getOverlaySidebarStore } from '$lib/stores/overlay-sidebar.svelte';

	interface OverlaySidebarBindingProps {
		sidebar: Snippet;
	}

	let { sidebar }: OverlaySidebarBindingProps = $props();
	const store = getOverlaySidebarStore();

	// onMount (and its cleanup) are client-only - they do not fire during SSR,
	// so the store is only touched while the overlay is actually live.
	onMount(() => {
		store.set(sidebar);
		return () => store.clear();
	});
</script>
