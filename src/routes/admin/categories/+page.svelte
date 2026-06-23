<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
	import { invalidateAll } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { AdminCategoryItem, ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const online = getOnlineStore();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const permissionsT = $derived(t.permissions);
	const user = $derived(data.user);
	const categories = $derived(data.categories as AdminCategoryItem[]);

	let showModal = $state(false);
	let modalMode = $state<'add' | 'edit'>('add');
	let slug = $state('');
	let title = $state('');
	let description = $state('');
	let displayOrder = $state('1');
	let priority = $state('1');
	let themeName = $state('');
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	const modalHeading = $derived(modalMode === 'add' ? adminT.newCategory : adminT.editCategory);

	function openAdd() {
		modalMode = 'add';
		slug = '';
		title = '';
		description = '';
		displayOrder = '1';
		priority = '1';
		themeName = '';
		showModal = true;
	}

	function openEdit(category: AdminCategoryItem) {
		modalMode = 'edit';
		slug = category.slug;
		title = category.title;
		description = category.description;
		displayOrder = String(category.displayOrder);
		priority = String(category.priority);
		themeName = category.themeName ?? '';
		showModal = true;
	}

	function setMessage(type: FeedbackMessage['type'], text: string) {
		message = { type, text };
	}

	async function submitCategory() {
		saving = true;
		message = null;
		try {
			const method = modalMode === 'add' ? 'POST' : 'PATCH';
			const res = await fetch('/api/admin/categories', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					slug,
					title,
					description,
					displayOrder: Number(displayOrder),
					priority: Number(priority),
					themeName: themeName || null
				})
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				showModal = false;
				setMessage(
					'success',
					modalMode === 'add' ? permissionsT.categoryCreated : permissionsT.categoryUpdated
				);
				await invalidateAll();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}

	async function setCategoryDisabled(categorySlug: string, disabled: boolean) {
		saving = true;
		message = null;
		try {
			const res = await fetch('/api/admin/categories', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slug: categorySlug, disabled })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				setMessage(
					'success',
					disabled ? permissionsT.categoryDisabled : permissionsT.categoryRestored
				);
				await invalidateAll();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(adminT.categories)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="categories" />
{/snippet}

{#snippet leftPanel()}
	{#if user}
		<AdminMenuPanel {user} {t} lang={data.lang} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref="/admin" fallbackRoute="/admin">
		<div class="space-y-3">
			<div class="flex items-center justify-between border-b border-base-300 pb-4">
				<h1 class="page-title">{adminT.categories}</h1>
				{#if online.online}
					<button class="btn btn-primary btn-sm" onclick={openAdd} disabled={saving}>
						{adminT.addCategory}
					</button>
				{/if}
			</div>

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			{#if online.online}
				<div class="overflow-x-auto">
					<table class="table table-sm [&_tr]:border-base-300">
						<thead>
							<tr>
								<th>{permissionsT.slug}</th>
								<th>{permissionsT.title}</th>
								<th>{permissionsT.order}</th>
								<th>{permissionsT.status}</th>
								<th>{permissionsT.actions}</th>
							</tr>
						</thead>
						<tbody>
							{#each categories as category (category.slug)}
								<tr class={category.disabledAt ? 'opacity-60' : ''}>
									<td class="font-mono text-xs">{category.slug}</td>
									<td>
										<div class="font-medium">{category.title}</div>
										<div class="text-xs text-base-content/50">{category.description}</div>
									</td>
									<td>{category.displayOrder}</td>
									<td>{category.disabledAt ? permissionsT.disabled : permissionsT.enabled}</td>
									<td>
										<div class="flex gap-1">
											<button
												class="btn btn-outline btn-xs"
												onclick={() => openEdit(category)}
												disabled={saving}
											>
												{t.common.edit}
											</button>
											{#if category.disabledAt}
												<button
													class="btn btn-outline btn-xs"
													onclick={() => setCategoryDisabled(category.slug, false)}
													disabled={saving}
												>
													{permissionsT.restore}
												</button>
											{:else}
												<button
													class="btn btn-warning btn-xs"
													onclick={() => setCategoryDisabled(category.slug, true)}
													disabled={saving}
												>
													{permissionsT.disable}
												</button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<OfflinePlaceholder {t} />
			{/if}
		</div>
	</GesturePageLayout>
</DualColumnLayout>

{#if showModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{modalHeading}</h3>
			<form
				class="space-y-3 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					submitCategory();
				}}
			>
				<FormField
					id="category-slug"
					label={permissionsT.slug}
					bind:value={slug}
					required
					disabled={modalMode === 'edit'}
				/>
				<FormField id="category-title" label={permissionsT.title} bind:value={title} required />
				<FormField
					id="category-description"
					label={permissionsT.descriptionLabel}
					bind:value={description}
					as="textarea"
					required
				/>
				<div class="grid grid-cols-2 gap-3">
					<FormField
						id="category-display-order"
						type="number"
						label={permissionsT.displayOrder}
						bind:value={displayOrder}
					/>
					<FormField
						id="category-priority"
						type="number"
						label={permissionsT.priority}
						bind:value={priority}
					/>
				</div>
				<FormField id="category-theme" label={permissionsT.themeName} bind:value={themeName} />
				<div class="modal-action gap-2">
					<button type="submit" class="btn btn-primary btn-sm" disabled={saving}>
						{saving ? t.common.saving : t.common.submit}
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (showModal = false)}>
						{t.common.cancel}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
