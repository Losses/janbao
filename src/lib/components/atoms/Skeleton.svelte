<script lang="ts">
	/**
	 * Skeleton - the shared loading-placeholder primitive. Wraps daisyUI's
	 * `skeleton` class so a placeholder's color and shimmer animation come
	 * from one component. Size and radius come from Tailwind utilities on
	 * `class` (e.g. `w-full h-5 rounded`); a page-shaped layout skeleton
	 * composes several of these.
	 */
	interface SkeletonProps {
		/** Tailwind utilities for size / radius / layout, e.g. `w-full h-5 rounded`. */
		class?: string;
	}

	let { class: klass = '' }: SkeletonProps = $props();
</script>

<div class="skeleton {klass}"></div>
