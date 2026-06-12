<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
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
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{t.home.welcomeTo}</h3>
				<div class="flex gap-2">
					<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
					<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
				</div>
			</div>
		{/if}
		<div class="divider my-1"></div>
		<CategoryListWidget {t} />
		<div class="divider my-1"></div>
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<div class="border-b border-base-300 pb-4">
			<h1 class="text-3xl font-extrabold tracking-tight">
				{t.sidebar.categoryList}
			</h1>
		</div>

		{#if categoriesList.length === 0}
			<div class="text-center py-10 text-base-content/50">
				{t.common.noResults}
			</div>
		{:else}
			<div class="grid gap-4">
				{#each categoriesList as category (category.slug)}
					<div
						class="card bg-base-100 border border-base-200 hover:border-primary/40 transition-all p-5 rounded-xl shadow-sm"
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
