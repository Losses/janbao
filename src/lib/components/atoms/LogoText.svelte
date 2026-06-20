<script lang="ts">
	/**
	 * LogoText Atom - The brand wordmark, inlined from the brand-text source SVG
	 * with its hardcoded green (`#00a300`) replaced by `currentColor` so it
	 * inherits the surrounding text color (e.g. a tab's active/inactive color).
	 * Used as the first tab's expanded label when `PUBLIC_BRANDED_FIRST_TAB` is
	 * enabled. Width scales with the height to keep the 48:20 viewBox aspect.
	 */
	interface LogoTextProps {
		class?: string;
	}

	let { class: className = '' }: LogoTextProps = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 20" class={className} aria-hidden="true">
	<g fill="currentColor">
		<path
			d="M1.625-.321h.873v3.174h-.873Zm4.804.203h.794v2.116h-.794ZM8.81 1.998h.635V4.38H8.81zm2.117-2.116h.794v2.116h-.794z"
			style="-inkscape-stroke:none"
			transform="translate(3.52 1.2)scale(3.73155)"
		/>
		<path
			d="M6.43-.118h5.29V.41H6.43Zm0 4.498h5.29v.529H6.43Zm0-.953h5.29v.53H6.43Zm.421-.9h4.87v.53H6.85Z"
			style="-inkscape-stroke:none"
			transform="translate(3.52 1.2)scale(3.73155)"
		/>
		<path
			d="m6.43 2.965.508-.735.326.226-.509.735ZM6.43 1.47h5.29v.528H6.43Zm0-.795h5.29v.53H6.43ZM-.756.242 0 0l.767 2.394-.756.242ZM4.789.21l-.756-.243-.767 2.393.756.243ZM1.62 2.395l.523.597L-.19 5.038l-.523-.597Z"
			style="-inkscape-stroke:none"
			transform="translate(3.52 1.2)scale(3.73155)"
		/>
		<path
			d="m2.454 2.395-.523.597 2.335 2.046.523-.597Z"
			style="-inkscape-stroke:none"
			transform="translate(3.52 1.2)scale(3.73155)"
		/>
	</g>
</svg>
