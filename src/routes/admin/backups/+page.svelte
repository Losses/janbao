<script lang="ts">
	import NavPipelineHost from '$lib/components/templates/NavPipelineHost.svelte';
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { BackupListItem, BackupPolicy, BackupRunStatus } from '$lib/types/backup';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	/** Shape of the GET /api/admin/backups response, used by the poll loop and reload. */
	interface BackupPollResponse {
		available: boolean;
		policy: BackupPolicy;
		backups: BackupListItem[];
		run: BackupRunStatus | null;
	}

	// Matches BACKUP_SETTING_DEFAULTS.retentionDays (server-only constant) so the
	// client has a fallback without importing server code.
	const RETENTION_DAYS_DEFAULT = 30;

	// Skeleton row placeholders - one full-width bar per expected row (count
	// tuned to typical data via MCP measurement).
	const SKELETON_ROWS = [0, 1, 2] as const;

	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

	let { data }: PageProps = $props();
	const online = getOnlineStore();

	const t = $derived(data.t);
	const backupT = $derived(t.backup);
	const user = $derived(data.user);

	let loaded = $state(false);
	let available = $state(false);
	let policy = $state<BackupPolicy>({ enabled: false, retentionDays: RETENTION_DAYS_DEFAULT });
	let backups = $state<BackupListItem[]>([]);

	// Editable drafts. Initialized from defaults and re-synced from policy by the
	// effect (mirrors the permissions page's empty-init-then-effect pattern), so a
	// save → reload → refreshed policy resets the inputs.
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

	async function reload() {
		try {
			const res = await fetch('/api/admin/backups');
			if (res.ok) {
				const result = (await res.json()) as BackupPollResponse;
				available = result.available;
				policy = result.policy;
				backups = result.backups;
				// If a run is already in progress (e.g. the daily backup started while
				// the admin was elsewhere), show the running state and poll. Mirrors the
				// old onMount check, deferred until the status actually arrives.
				if (!backing && result.run?.state === 'running') {
					backing = true;
					void pollBackupStatus();
				}
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

	async function savePolicy() {
		const retention = Math.max(1, Math.floor(Number(retentionDraft) || RETENTION_DAYS_DEFAULT));
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
				await reload();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		saving = false;
	}

	async function backupNow() {
		if (backing) return;
		backing = true;
		message = null;
		try {
			const res = await fetch('/api/admin/backups', { method: 'POST' });
			// 409 = another run is already in flight (e.g. the daily backup). Poll it
			// the same way as a fresh start so the UI tracks it to completion.
			if (res.ok || res.status === 409) {
				await pollBackupStatus();
				return;
			}
			const result = (await res.json()) as ApiResult;
			backing = false;
			setMessage('error', result.error || t.common.error);
		} catch {
			backing = false;
			setMessage('error', t.auth.networkError);
		}
	}

	/**
	 * Poll GET /api/admin/backups every few seconds until the in-memory run
	 * status reaches a terminal state (or the safety deadline elapses). Because
	 * the actual upload runs detached server-side, this loop only transfers the
	 * tiny status object - the 1GB upload never flows through these requests.
	 */
	async function pollBackupStatus() {
		const POLL_MS = 3000;
		const MAX_MS = 10 * 60 * 1000; // safety cap; longer than this is likely stuck
		const deadline = Date.now() + MAX_MS;
		while (Date.now() < deadline) {
			await sleep(POLL_MS);
			try {
				const res = await fetch('/api/admin/backups', { method: 'GET' });
				const data = (await res.json()) as BackupPollResponse;
				const run = data.run;
				if (run && run.state === 'running') continue; // still uploading
				// Terminal (succeeded/failed) or status lost on process restart.
				await reload();
				if (run?.state === 'succeeded') {
					setMessage('success', backupT.backupCreated);
				} else {
					setMessage('error', backupT.backupFailed);
				}
				backing = false;
				return;
			} catch {
				// Transient network blip mid-poll - keep going until the deadline.
			}
		}
		// Deadline exceeded without a terminal state.
		await reload();
		setMessage('error', backupT.backupTimedOut);
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
				await reload();
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
	<NavPipelineHost leftHref="/admin">
		<div class="space-y-3">
			<div class="flex items-center justify-between border-b border-base-300 pb-4">
				<h1 class="page-title">{backupT.title}</h1>
				{#if online.online}
					<button
						class="btn btn-primary btn-sm"
						onclick={backupNow}
						disabled={!loaded || !available || backing}
					>
						{backing ? backupT.backingUp : backupT.backupNow}
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

			{#if loaded && !available}
				<div class="alert" role="alert">
					{backupT.notAvailable}
				</div>
			{:else}
				<div class="space-y-4">
					<!-- Policy controls are static UI; their values sync from the loaded
					     policy via the draft effect, so they render immediately (no skeleton). -->
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
							{#if online.online}
								<button
									class="btn btn-primary btn-sm"
									onclick={savePolicy}
									disabled={saving || !dirty}
								>
									{saving ? t.common.saving : backupT.save}
								</button>
							{/if}
						</div>
						<p class="text-xs text-base-content/60">{backupT.retentionDaysHelp}</p>
					</div>

					<!-- Backups list (the only truly data-dependent region here) -->
					{#if !loaded}
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
									{#each SKELETON_ROWS as i (i)}
										<tr>
											<td colspan="3"><Skeleton class="h-5 w-full" /></td>
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
					{:else}
						<OfflinePlaceholder {t} />
					{/if}
				</div>
			{/if}
		</div>
	</NavPipelineHost>
</DualColumnLayout>
