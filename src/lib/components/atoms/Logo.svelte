<script lang="ts">
	/**
	 * Logo Atom - Renders a theme-aware SVG logo component.
	 */
	interface LogoProps {
		class?: string;
	}

	let { class: className = '' }: LogoProps = $props();
</script>

<a href="/" class="flex items-center {className}" aria-label="Home">
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" class="h-10 w-auto">
		<g paint-order="markers stroke fill">
			<path
				fill="currentColor"
				d="M54.841 15.232h3.3v12h-3.3zM73 16h3v8h-3zM82 24h2.4v9H82zM90 16h3v8h-3z"
				style="-inkscape-stroke:none"
			/>
			<path
				fill="currentColor"
				d="M73 16h20v2H73zM73 33h20v2H73zM73 29.4h20v2H73zM74.595 26H93v2H74.595z"
				style="-inkscape-stroke:none"
			/>
			<path
				fill="currentColor"
				d="M18.813 75.761h3.379v1.5h-3.379z"
				style="-inkscape-stroke:none"
				transform="rotate(-55.307)"
			/>
			<path fill="currentColor" d="M73 22h20v2H73zM73 19h20v2H73z" style="-inkscape-stroke:none" />
			<path
				fill="currentColor"
				d="M38.358 30.525h3v9.5h-3z"
				style="-inkscape-stroke:none"
				transform="rotate(-17.769)"
			/>
			<path
				fill="currentColor"
				d="M-68.874-3.971h3v9.5h-3z"
				style="-inkscape-stroke:none"
				transform="rotate(17.769)scale(-1 1)"
			/>
			<path
				fill="currentColor"
				d="M55.31-24.428h3v11.732h-3z"
				style="-inkscape-stroke:none"
				transform="rotate(48.773)"
			/>
			<path
				fill="currentColor"
				d="M-19.03 60.411h3v11.732h-3z"
				style="-inkscape-stroke:none"
				transform="rotate(131.227)scale(1 -1)"
			/>
			<circle
				cx="19.842"
				cy="20.158"
				r="17.578"
				fill="none"
				stroke="var(--color-brand-logo, var(--color-primary))"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="4.529"
			/>
		</g>
	</svg>
</a>
