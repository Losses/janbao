<script lang="ts">
	/**
	 * Logo Atom - Renders a theme-aware logo component.
	 * Uses Material Design Icon for the book icon.
	 * Text fallback "Janbao" when no custom SVG is available.
	 */
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { getSiteName } from '$lib/utils/title';
	import { mdiBookOpenPageVariant } from '@mdi/js';

	interface LogoProps {
		class?: string;
	}

	let { class: className = '' }: LogoProps = $props();
</script>

<a href="/" class="flex items-center gap-2 text-lg font-bold text-base-content {className}">
	<Icon path={mdiBookOpenPageVariant} size={24} />
	<span>{getSiteName()}</span>
</a>
