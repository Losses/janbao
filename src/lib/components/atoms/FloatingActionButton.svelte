<script lang="ts">
	/**
	 * FloatingActionButton Atom - circular action button. Renders an anchor that
	 * wraps an MDI icon. The transform binds a SINGLE `scale(s) translateY(y)`
	 * string so the route-transition scale driver and the scroll-hide translateY
	 * driver compose on different matrix dimensions (orthogonal, no precedence
	 * rule). Mirrors Header's single-style-transform binding pattern.
	 *
	 * Viewport gating (mobile-only) and stacking context live on the layer
	 * (FloatingActionButtonLayer); the atom is viewport-agnostic.
	 *
	 * The atom carries NO CSS transition. Every motion that affects the
	 * transform (route-transition scale, scroll-hide translateY) is driven by
	 * the global nav-pipeline orchestrator's per-frame publication; the layer
	 * is a reactive reader and the atom has no transition directive. The layer
	 * binds the eased scale through the inline `style:transform` binding.
	 *
	 * Visibility gates (both feed `pointer-events` and `aria-hidden`):
	 *   - scale hidden: `scale < 0.01` (route-transition scale-out)
	 *   - scroll hidden: `hideProgress >= 0.99` (translateY off the bottom edge)
	 * A tap cannot land on a partially-hidden button.
	 */
	import { mdiPlus } from '@mdi/js';
	import Icon from '$lib/components/atoms/Icon.svelte';

	interface FloatingActionButtonProps {
		/** Route-transition scale factor, clamped to [0, 1] by the caller. */
		scale: number;
		/** Vertical offset in px (positive slides the FAB down off the bottom). */
		translateY: number;
		/** Scroll-hide progress 0..1; gates pointer-events when >= 0.99. */
		hideProgress: number;
		/** Destination of the anchor. */
		href: string;
		/** Accessible label (action + target list). */
		label: string;
		/** MDI path data (defaults to a plus icon). */
		icon?: string;
	}

	let {
		scale,
		translateY,
		hideProgress,
		href,
		label,
		icon = mdiPlus
	}: FloatingActionButtonProps = $props();

	const ICON_SIZE = 28;

	const hidden = $derived(scale < 0.01 || hideProgress >= 0.99);
</script>

<a
	{href}
	aria-label={label}
	aria-hidden={hidden}
	data-no-swipe
	data-testid="fab"
	class="fab-anchor flex size-14 items-center justify-center rounded-full bg-accent text-accent-content shadow-md"
	class:pointer-events-none={hidden}
	style:transform={`scale(${scale}) translateY(${translateY}px)`}
	style:transform-origin="center"
>
	<Icon path={icon} size={ICON_SIZE} />
</a>

<style>
	/* position: fixed anchors the FAB to the viewport (under html.fixed-viewport
	   the html/body box is fixed; a fixed descendant of a non-transformed
	   ancestor still pins to the viewport, mirroring Header at the same AppShell
	   DOM level). Resting insets: 1rem right, 1rem + safe-area bottom so the
	   button clears the iOS home indicator. The scroll-hide slide distance the
	   caller computes uses the same bottom clearance (env included). */
	.fab-anchor {
		position: fixed;
		right: 1rem;
		bottom: calc(1rem + env(safe-area-inset-bottom));
	}
</style>
