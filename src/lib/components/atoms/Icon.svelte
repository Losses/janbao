<script lang="ts">
	/**
	 * Icon Atom - Renders a Material Design Icon (MDI) as an inline SVG.
	 * Uses @mdi/js path data to avoid external resource loading.
	 */
	interface IconProps {
		path: string;
		size?: number;
		class?: string;
		ariaLabel?: string;
	}

	let { path, size = 20, class: className = '', ariaLabel }: IconProps = $props();

	const viewBoxSize = 24;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 {viewBoxSize} {viewBoxSize}"
	width={size}
	height={size}
	fill="currentColor"
	class={className}
	aria-hidden={ariaLabel ? undefined : true}
	aria-label={ariaLabel}
	role={ariaLabel ? 'img' : 'presentation'}
>
	<path d={path} />
</svg>
