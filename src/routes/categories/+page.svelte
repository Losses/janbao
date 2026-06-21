<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const categoriesList = $derived(data.categories);
</script>

<svelte:head>
	<title>{formatTitle(t.nav.categories)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		<CategoryListWidget {t} />
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<div class="border-b border-base-300 pb-4">
			<h1 class="page-title">
				{t.sidebar.categoryList}
			</h1>
		</div>

		{#if categoriesList.length === 0}
			<EmptyState message={t.common.noResults} bordered={false} />
		{:else}
			<div class="grid gap-4">
				{#each categoriesList as category (category.slug)}
					<div
						class="card bg-base-100 border border-base-200 hover:border-primary/40 transition-all p-5 rounded-box shadow-sm"
					>
						<h2 class="text-xl font-bold mb-2">
							<a
								href="/category/{category.slug}"
								class="hover:text-primary transition-colors hover:underline"
							>
								{category.title}
							</a>
						</h2>
						<p class="text-sm text-base-content/75 leading-relaxed">{category.description}</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</DualColumnLayout>
