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
	 * CSS transition on `transform`: active only when `transitionEnabled` is
	 * true (a GesturePageLayout exit slide, where `navStore.pendingNav` is set
	 * and GPL publishes the coverProgress endpoint snapshot). The discrete
	 * list<->compose family swap is no longer eased here: the FAB layer drives
	 * that via its own rAF family-swap ease, publishing the eased scale through
	 * the inline `style:transform` binding. Family A runs a per-frame rAF
	 * sampler that follows the track's own CSS easing 1:1; enabling the atom's
	 * transition during a drag would run a second unsynchronized clock and
	 * double-animate. The layer therefore drives
	 * `transitionEnabled = !pager.dragging && pendingNav !== null`. This CSS
	 * path dissolves in Phase 3 when the GPL routes migrate.
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
		/** When true, the atom's `transform` transitions over 200ms ease-out
		 *  (a GesturePageLayout exit slide, armed by `navStore.pendingNav`).
		 *  Suppressed while the layer's per-frame sampler, the rAF family-swap
		 *  ease, or a drag is driving the transform continuously. */
		transitionEnabled?: boolean;
	}

	let {
		scale,
		translateY,
		hideProgress,
		href,
		label,
		icon = mdiPlus,
		transitionEnabled = false
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
	class:fab-transition={transitionEnabled}
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

	/* GPL exit-slide ease: when `navStore.pendingNav` is set (a
	   GesturePageLayout back-swipe release), the layer arms this class so the
	   atom's transform eases from the mid-drag scale toward the published
	   coverProgress endpoint across the GPL track's 200ms CSS slide. The
	   discrete list<->compose family swap is eased by the layer's rAF
	   (publishing the eased scale inline), not this class. Suppressed while the
	   per-frame sampler or a drag owns the transform (the layer toggles the
	   class off then). Dissolves in Phase 3 when the GPL routes migrate. */
	.fab-transition {
		transition: transform 200ms ease-out;
	}
</style>
