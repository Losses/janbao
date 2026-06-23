<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { AdminUserGroupItem, ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	/** Shape of GET /api/admin/user-groups. */
	interface UserGroupsResponse {
		groups: AdminUserGroupItem[];
	}

	// Skeleton row placeholders - count/widths mirror the loaded table so the
	// skeleton-to-content swap doesn't reflow (tuned via MCP measurement).
	const SKELETON_ROWS = [0, 1, 2, 3, 4] as const;

	let { data }: PageProps = $props();
	const online = getOnlineStore();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const permissionsT = $derived(t.permissions);
	const user = $derived(data.user);

	let loaded = $state(false);
	let groups = $state<AdminUserGroupItem[]>([]);

	let showModal = $state(false);
	let modalMode = $state<'add' | 'edit'>('add');
	let slug = $state('');
	let title = $state('');
	let description = $state('');
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let pendingDeleteSlug = $state<string | null>(null);

	const pendingDeleteGroup = $derived(
		pendingDeleteSlug ? (groups.find((group) => group.slug === pendingDeleteSlug) ?? null) : null
	);

	async function reload() {
		try {
			const res = await fetch('/api/admin/user-groups');
			if (res.ok) {
				const result = (await res.json()) as UserGroupsResponse;
				groups = result.groups;
			} else {
				setMessage('error', t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		loaded = true;
	}

	onMount(() => {
		void reload();
	});

	const modalHeading = $derived(modalMode === 'add' ? adminT.newGroup : adminT.editUserGroup);

	function openAdd() {
		modalMode = 'add';
		slug = '';
		title = '';
		description = '';
		showModal = true;
	}

	function openEdit(group: AdminUserGroupItem) {
		modalMode = 'edit';
		slug = group.slug;
		title = group.title;
		description = group.description;
		showModal = true;
	}

	function setMessage(type: FeedbackMessage['type'], text: string) {
		message = { type, text };
	}

	async function submitGroup() {
		saving = true;
		message = null;
		try {
			const method = modalMode === 'add' ? 'POST' : 'PATCH';
			const res = await fetch('/api/admin/user-groups', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slug, title, description })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				showModal = false;
				setMessage(
					'success',
					modalMode === 'add' ? permissionsT.groupCreated : permissionsT.groupUpdated
				);
				await reload();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}

	async function deleteGroup(targetSlug: string) {
		saving = true;
		message = null;
		try {
			const res = await fetch('/api/admin/user-groups', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slug: targetSlug })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				setMessage('success', permissionsT.groupDeleted);
				await reload();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}

	async function confirmDelete() {
		const target = pendingDeleteSlug;
		pendingDeleteSlug = null;
		if (target) await deleteGroup(target);
	}
</script>

<svelte:head>
	<title>{formatTitle(adminT.userGroups)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="userGroups" />
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
				<h1 class="page-title">{adminT.userGroups}</h1>
				{#if online.online}
					<button class="btn btn-primary btn-sm" onclick={openAdd} disabled={!loaded || saving}>
						{adminT.addUserGroup}
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

			{#if !loaded}
				<div class="overflow-x-auto">
					<table class="table table-sm [&_tr]:border-base-300">
						<thead>
							<tr>
								<th>{permissionsT.slug}</th>
								<th>{permissionsT.title}</th>
								<th>{permissionsT.users}</th>
								<th>{permissionsT.status}</th>
								<th>{permissionsT.actions}</th>
							</tr>
						</thead>
						<tbody>
							{#each SKELETON_ROWS as i (i)}
								<tr>
									<td><div class="skeleton h-3 w-12"></div></td>
									<td>
										<div class="skeleton h-3 w-40 mb-1"></div>
										<div class="skeleton h-2 w-56"></div>
									</td>
									<td><div class="skeleton h-3 w-4"></div></td>
									<td><div class="skeleton h-3 w-16"></div></td>
									<td><div class="skeleton h-5 w-24 rounded"></div></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if online.online}
				<div class="overflow-x-auto">
					<table class="table table-sm [&_tr]:border-base-300">
						<thead>
							<tr>
								<th>{permissionsT.slug}</th>
								<th>{permissionsT.title}</th>
								<th>{permissionsT.users}</th>
								<th>{permissionsT.status}</th>
								<th>{permissionsT.actions}</th>
							</tr>
						</thead>
						<tbody>
							{#each groups as group (group.slug)}
								<tr>
									<td class="font-mono text-xs">{group.slug}</td>
									<td>
										<div class="font-medium">{group.title}</div>
										<div class="text-xs text-base-content/50">{group.description}</div>
									</td>
									<td>{group.userCount}</td>
									<td>{group.reserved ? permissionsT.reserved : permissionsT.custom}</td>
									<td>
										<div class="flex gap-1">
											<button
												class="btn btn-outline btn-xs"
												onclick={() => openEdit(group)}
												disabled={saving}
											>
												{t.common.edit}
											</button>
											<button
												class="btn btn-warning btn-xs"
												onclick={() => (pendingDeleteSlug = group.slug)}
												disabled={saving || group.reserved || group.userCount > 0}
											>
												{t.common.delete}
											</button>
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
					submitGroup();
				}}
			>
				<FormField
					id="group-slug"
					label={permissionsT.slug}
					bind:value={slug}
					required
					disabled={modalMode === 'edit'}
				/>
				<FormField id="group-title" label={permissionsT.title} bind:value={title} required />
				<FormField
					id="group-description"
					label={permissionsT.descriptionLabel}
					bind:value={description}
					as="textarea"
					required
				/>
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

{#if pendingDeleteGroup}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{t.common.delete}</h3>
			<p class="py-4 text-sm text-base-content/80">
				{t.common.deleteConfirm}
				<span class="font-mono text-xs">{pendingDeleteGroup.slug}</span>
			</p>
			<div class="modal-action gap-2">
				<button class="btn btn-warning btn-sm" onclick={confirmDelete} disabled={saving}>
					{saving ? t.common.saving : t.common.delete}
				</button>
				<button class="btn btn-ghost btn-sm" onclick={() => (pendingDeleteSlug = null)}>
					{t.common.cancel}
				</button>
			</div>
		</div>
	</div>
{/if}
