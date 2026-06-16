<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { AdminUserGroupItem, ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const permissionsT = $derived(t.permissions);
	const user = $derived(data.user);
	const groups = $derived(data.groups as AdminUserGroupItem[]);

	let showAddModal = $state(false);
	let slug = $state('');
	let title = $state('');
	let description = $state('');
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	function openAdd() {
		slug = '';
		title = '';
		description = '';
		showAddModal = true;
	}

	function setMessage(type: FeedbackMessage['type'], text: string) {
		message = { type, text };
	}

	async function addGroup() {
		saving = true;
		message = null;
		try {
			const res = await fetch('/api/admin/user-groups', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slug, title, description })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				showAddModal = false;
				setMessage('success', permissionsT.groupCreated);
				await invalidateAll();
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
	<title>{formatTitle(adminT.userGroups)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="userGroups" />
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold">{adminT.userGroups}</h1>
			<button class="btn btn-primary btn-sm" onclick={openAdd} disabled={saving}>
				{adminT.addUserGroup}
			</button>
		</div>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

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
								<button
									class="btn btn-warning btn-xs"
									onclick={() => deleteGroup(group.slug)}
									disabled={saving || group.reserved || group.userCount > 0}
								>
									{t.common.delete}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</DualColumnLayout>

{#if showAddModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{adminT.newGroup}</h3>
			<form
				class="space-y-3 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					addGroup();
				}}
			>
				<FormField id="group-slug" label={permissionsT.slug} bind:value={slug} required />
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
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (showAddModal = false)}>
						{t.common.cancel}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
