<script lang="ts">
	/**
	 * SectionTitle - a group header: title with an optional description hugging
	 * it (tight `space-y-0.5`, muted caption) so the description reads as
	 * belonging to the title, not the content beneath. The block carries a small
	 * bottom margin (`mb-1`) so a group's body sits closer to its own header than
	 * to the previous group. Rendered inside `SettingGroup`; rarely used directly.
	 */
	interface SectionTitleProps {
		title: string;
		description?: string;
	}
	let { title, description }: SectionTitleProps = $props();
</script>

<div class="space-y-0.5 mb-3">
	<h2 class="section-title">{title}</h2>
	{#if description}
		<p class="text-xs text-base-content/60">{description}</p>
	{/if}
</div>
