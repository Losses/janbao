<script lang="ts">
	import type { Snippet } from 'svelte';

	interface AdminLayoutProps {
		children: Snippet;
	}

	let { children }: AdminLayoutProps = $props();
</script>

{@render children()}
