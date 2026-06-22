<script lang="ts">
	/**
	 * OverlayLayer - in-flow layer that hosts a thread page (a discussion or
	 * conversation) on top of the persistent MobileTabPager on mobile. Rendered by
	 * the `(tabs)` layout for overlay routes, inside a `relative overflow-hidden`
	 * wrapper that clips the pager to the thread's height.
	 *
	 * In-flow (not absolute) so the thread drives the document height + window
	 * scroll, and so it sizes the clipping wrapper (the wrapper's height = this
	 * layer = the thread height). `relative z-20` sits it above the persistent
	 * MobileTabPager (`z-0`, absolute-behind) and below the drawer (`z-50`).
	 * Transparent: no blank fill - the pager behind is CLIPPED by the wrapper's
	 * overflow-hidden, and what shows below a short thread is the shell's own card
	 * background (same as when the list was a separate, unmounted route).
	 */
	import type { Snippet } from 'svelte';

	interface OverlayLayerProps {
		children: Snippet;
	}

	let { children }: OverlayLayerProps = $props();
</script>

<div class="relative z-20">
	{@render children()}
</div>
