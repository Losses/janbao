<script lang="ts">
	/**
	 * SettingGroup — the settings sub-area abstraction: a `SectionTitle` header
	 * (title + description) followed by a body of related controls with uniform
	 * internal rhythm (`space-y-2`). Sibling groups are spaced by the page's
	 * outer `space-y-*` so grouping is expressed through spacing rather than
	 * cards (flat-design convention). This is what gives each settings page a
	 * consistent, logical structure instead of ad-hoc loose rows.
	 */
	import type { Snippet } from 'svelte';
	import SectionTitle from './SectionTitle.svelte';

	interface SettingGroupProps {
		title: string;
		description?: string;
		children: Snippet;
	}

	let { title, description, children }: SettingGroupProps = $props();
</script>

<section class="space-y-3">
	<SectionTitle {title} {description} />
	<div class="space-y-3">
		{@render children()}
	</div>
</section>
