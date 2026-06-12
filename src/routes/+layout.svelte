<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	interface LayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: LayoutProps = $props();

	// Reactively update the <html> tag's lang attribute
	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.lang = data.lang;
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
