<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { backHandler } from '$lib/stores/navigation.svelte';
	import { detectSwipe } from '$lib/actions/swipe';

	interface Props {
		children: Snippet;
		fallbackRoute?: string;
	}

	let { children, fallbackRoute = '/' }: Props = $props();
	const navStore = getNavigationStore();

	let dragOffset = $state(0);

	function onSwipeMove(deltaX: number) {
		if (deltaX > 0) {
			dragOffset = deltaX;
		}
	}

	function onSwipeEnd(deltaX: number) {
		// Threshold to commit back navigation
		if (deltaX > 80) {
			const consumed = backHandler.dispatch();
			if (!consumed) {
				if (navStore.activeStack.length > 1) {
					history.back();
				} else {
					void goto(fallbackRoute, { replaceState: true });
				}
			}
		}
		dragOffset = 0;
	}

	const contentStyle = $derived(
		dragOffset > 0 ? `transform: translateX(${dragOffset}px); transition: none;` : ''
	);
</script>

<div
	class="w-full h-full transition-transform duration-200"
	style={contentStyle}
	use:detectSwipe={{ onMove: onSwipeMove, onEnd: onSwipeEnd }}
>
	{@render children()}
</div>
