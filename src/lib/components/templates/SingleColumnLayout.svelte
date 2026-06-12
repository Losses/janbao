<script lang="ts">
	import type { Snippet } from 'svelte';

	interface SingleColumnLayoutProps {
		children: Snippet;
	}

	let { children }: SingleColumnLayoutProps = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-12 sm:px-6 lg:px-8">
	<div
		class="w-full max-w-md space-y-8 rounded-xl border border-base-300 bg-base-100 p-8 shadow-sm"
	>
		{@render children()}
	</div>
</div>
