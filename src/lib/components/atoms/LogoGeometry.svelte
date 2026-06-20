<script lang="ts">
	/**
	 * LogoGeometry Atom - The brand's geometric mark (a circle outline), inlined
	 * from the circle-outline source SVG. `fill="currentColor"` so it inherits the
	 * surrounding text color (e.g. a tab's active/inactive color). Used as the
	 * first tab's icon when `PUBLIC_BRANDED_FIRST_TAB` is enabled.
	 */
	interface LogoGeometryProps {
		class?: string;
	}

	let { class: className = '' }: LogoGeometryProps = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	class={className}
	fill="currentColor"
	aria-hidden="true"
>
	<path
		d="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"
	/>
</svg>
