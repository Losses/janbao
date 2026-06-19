<script lang="ts">
	interface SectionTitleProps {
		title: string;
		description?: string;
	}
	let { title, description }: SectionTitleProps = $props();
</script>

<div class="space-y-1">
	<h2 class="section-title py-2">{title}</h2>
	{#if description}
		<p class="text-sm text-base-content/70">{description}</p>
	{/if}
</div>
