<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { BackupListItem, BackupPolicy } from '$lib/types/backup';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const backupT = $derived(t.backup);
	const user = $derived(data.user);
	const available = $derived(data.available);
	const policy = $derived(data.policy as BackupPolicy);
	const backups = $derived(data.backups as BackupListItem[]);
	const retentionDaysDefault = $derived(data.retentionDaysDefault);

	// Editable drafts. Initialized from defaults and re-synced from data.policy
	// by the effect (mirrors the permissions page's empty-init-then-effect
	// pattern), so a save → invalidateAll → refreshed policy resets the inputs.
	let enabledDraft = $state(false);
	let retentionDraft = $state(0);
	let saving = $state(false);
	let backing = $state(false);
	let deletingName = $state<string | null>(null);
	let message = $state<FeedbackMessage | null>(null);

	$effect(() => {
		enabledDraft = policy.enabled;
		retentionDraft = policy.retentionDays;
	});

	const dirty = $derived(
		enabledDraft !== policy.enabled || retentionDraft !== policy.retentionDays
	);

	function setMessage(type: 'success' | 'error', text: string) {
		message = { type, text };
	}

	async function savePolicy() {
		const retention = Math.max(1, Math.floor(Number(retentionDraft) || retentionDaysDefault));
		saving = true;
		message = null;
		try {
			const res = await fetch('/api/admin/backups', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: enabledDraft, retentionDays: retention })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				setMessage('success', backupT.saved);
				await invalidateAll();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}

	async function backupNow() {
		backing = true;
		message = null;
		try {
			const res = await fetch('/api/admin/backups', { method: 'POST' });
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				setMessage('success', backupT.backupCreated);
				await invalidateAll();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		backing = false;
	}

	async function deleteBackup(name: string) {
		if (!confirm(backupT.confirmDelete)) return;
		deletingName = name;
		message = null;
		try {
			const res = await fetch(`/api/admin/backups/${encodeURIComponent(name)}`, {
				method: 'DELETE'
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				setMessage('success', backupT.deleted);
				await invalidateAll();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		deletingName = null;
	}
</script>

<svelte:head>
	<title>{formatTitle(backupT.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="backups" />
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="page-title">{backupT.title}</h1>
			{#if available}
				<button class="btn btn-primary btn-sm" onclick={backupNow} disabled={backing}>
					{backing ? t.common.saving : backupT.backupNow}
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

		{#if !available}
			<div class="alert" role="alert">
				{backupT.notAvailable}
			</div>
		{:else}
			<div class="space-y-4">
				<!-- Policy -->
				<div class="space-y-3">
					<label class="flex items-center gap-3">
						<input
							type="checkbox"
							class="checkbox checkbox-sm checkbox-primary"
							bind:checked={enabledDraft}
						/>
						<span>{backupT.enableAuto}</span>
					</label>

					<div class="flex flex-wrap items-end gap-3">
						<label class="form-control">
							<div class="label pb-1">
								<span class="label-text text-xs">{backupT.retentionDays}</span>
							</div>
							<input
								type="number"
								class="input input-bordered input-sm w-32"
								min="1"
								bind:value={retentionDraft}
							/>
						</label>
						<button class="btn btn-primary btn-sm" onclick={savePolicy} disabled={saving || !dirty}>
							{saving ? t.common.saving : backupT.save}
						</button>
					</div>
					<p class="text-xs text-base-content/60">{backupT.retentionDaysHelp}</p>
				</div>

				<!-- Backups list -->
				<div class="overflow-x-auto">
					<table class="table table-sm [&_tr]:border-base-300">
						<thead>
							<tr>
								<th>{backupT.name}</th>
								<th>{backupT.date}</th>
								<th class="text-right">{backupT.actions}</th>
							</tr>
						</thead>
						<tbody>
							{#each backups as backup (backup.name)}
								<tr>
									<td class="font-mono text-xs">{backup.name}</td>
									<td><DateAtom value={backup.date} {t} /></td>
									<td class="text-right">
										<div class="flex justify-end gap-1">
											<a
												class="btn btn-ghost btn-xs"
												href={`/api/admin/backups/${encodeURIComponent(backup.name)}`}
												download
											>
												{backupT.download}
											</a>
											<button
												class="btn btn-ghost btn-xs text-error"
												onclick={() => deleteBackup(backup.name)}
												disabled={deletingName === backup.name}
											>
												{backupT.delete}
											</button>
										</div>
									</td>
								</tr>
							{:else}
								<tr>
									<td colspan="3" class="text-base-content/50">{backupT.noBackups}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
</DualColumnLayout>
