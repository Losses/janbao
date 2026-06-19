<script lang="ts">
	interface PageTitleProps {
		title: string;
	}
	let { title }: PageTitleProps = $props();
</script>

<h1 class="page-title border-b border-base-300 pb-4">{title}</h1>
