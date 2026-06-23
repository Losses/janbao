<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { VoidHandler } from '$lib/types/handlers';
	import type {
		MaintenanceOp,
		MaintenanceOverview,
		MaintenanceOpsStatus
	} from '$lib/types/maintenance';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	/** Shape of GET /api/admin/maintenance, used by the detached poll loop. */
	interface MaintenancePollResponse {
		ops: MaintenanceOpsStatus;
		run: MaintenanceOverview['run'];
	}

	/** Shape of POST /api/admin/maintenance for a sync op (analyze/statsRebuild/statsFreeze). */
	interface MaintenanceSyncResponse {
		success?: boolean;
		error?: string;
		result?: string | null;
	}

	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

	// One skeleton card per maintenance op, mirroring the loaded card so the
	// skeleton-to-content swap doesn't reflow (tuned via MCP measurement).
	const SKELETON_CARDS = [0, 1, 2, 3, 4] as const;

	let { data }: PageProps = $props();
	const online = getOnlineStore();
	const t = $derived(data.t);
	const maintenanceT = $derived(t.maintenance);
	const user = $derived(data.user);

	let loaded = $state(false);
	let overview = $state<MaintenanceOverview | null>(null);

	// ANALYZE / statsRebuild / statsFreeze run synchronously (shared busy flag);
	// integrity_check / fts_rebuild run detached and share a single busy flag
	// (the server allows only one detached maintenance run at a time).
	let syncBusy = $state(false);
	let detachedBusy = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	function setMessage(type: 'success' | 'error', text: string) {
		message = { type, text };
	}

	async function reload() {
		try {
			const res = await fetch('/api/admin/maintenance');
			if (res.ok) {
				overview = (await res.json()) as MaintenanceOverview;
			} else {
				setMessage('error', t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		loaded = true;
		// Resume polling if a detached run was already in progress (e.g. the daily
		// run started while the admin was elsewhere). Mirrors the old onMount check,
		// now deferred until the overview actually arrives.
		if (!detachedBusy && overview?.run?.state === 'running') {
			detachedBusy = true;
			void pollDetached();
		}
	}

	onMount(() => {
		void reload();
	});

	async function runSync(op: MaintenanceOp, doneText: string) {
		if (syncBusy) return;
		syncBusy = true;
		message = null;
		try {
			const res = await fetch('/api/admin/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ op })
			});
			const result = (await res.json()) as MaintenanceSyncResponse;
			if (result.success) {
				// Stats ops return an informative result string ("rebuilt N buckets…");
				// fall back to the localized done text when there is none (analyze).
				setMessage('success', result.result ? String(result.result) : doneText);
				await reload();
			} else {
				setMessage('error', result.error || t.common.error);
			}
		} catch {
			setMessage('error', t.auth.networkError);
		}
		syncBusy = false;
	}

	async function runDetached(op: MaintenanceOp) {
		if (detachedBusy) return;
		detachedBusy = true;
		message = null;
		try {
			const res = await fetch('/api/admin/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ op })
			});
			// 409 = another detached run is in flight; poll it the same as a fresh start.
			if (res.ok || res.status === 409) {
				await pollDetached();
				return;
			}
			const result = (await res.json()) as ApiResult;
			detachedBusy = false;
			setMessage('error', result.error || t.common.error);
		} catch {
			detachedBusy = false;
			setMessage('error', t.auth.networkError);
		}
	}

	// Poll GET /api/admin/maintenance until the in-flight detached run reaches a
	// terminal state (or the safety deadline elapses). The server runs the op in
	// the background, so this loop only transfers the tiny overview object.
	async function pollDetached() {
		const POLL_MS = 3000;
		const MAX_MS = 10 * 60 * 1000;
		const deadline = Date.now() + MAX_MS;
		while (Date.now() < deadline) {
			await sleep(POLL_MS);
			try {
				const res = await fetch('/api/admin/maintenance', { method: 'GET' });
				const poll = (await res.json()) as MaintenancePollResponse;
				const run = poll.run;
				if (run && run.state === 'running') continue;
				await reload();
				setMessage(
					run?.state === 'succeeded' ? 'success' : 'error',
					run?.state === 'succeeded' ? maintenanceT.success : maintenanceT.failed
				);
				detachedBusy = false;
				return;
			} catch {
				// transient network blip mid-poll - keep going until the deadline
			}
		}
		await reload();
		setMessage('error', maintenanceT.timedOut);
		detachedBusy = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(maintenanceT.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="maintenance" />
{/snippet}

{#snippet leftPanel()}
	{#if user}
		<AdminMenuPanel {user} {t} lang={data.lang} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref="/admin" fallbackRoute="/admin">
		<div class="space-y-3">
			<div class="border-b border-base-300 pb-4">
				<h1 class="page-title">{maintenanceT.title}</h1>
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
				<div class="space-y-3">
					{#each SKELETON_CARDS as i (i)}
						<div class="rounded-box border border-base-300 p-4 space-y-2">
							<div class="flex items-start justify-between gap-3">
								<div class="space-y-1.5 flex-1">
									<div class="skeleton h-4 w-40"></div>
									<div class="skeleton h-3 w-64"></div>
								</div>
								<div class="skeleton h-8 w-20 shrink-0"></div>
							</div>
							<div class="skeleton h-3 w-48"></div>
						</div>
					{/each}
				</div>
			{:else if online.online && overview}
				<div class="space-y-3">
					{#snippet opCard(
						op: MaintenanceOp,
						label: string,
						desc: string,
						busy: boolean,
						onRun: VoidHandler
					)}
						{@const status = overview!.ops[op]}
						<div class="rounded-box border border-base-300 p-4 space-y-2">
							<div class="flex items-start justify-between gap-3">
								<div>
									<div class="font-medium">{label}</div>
									<p class="text-xs text-base-content/60">{desc}</p>
								</div>
								{#if status.available}
									<button class="btn btn-primary btn-sm shrink-0" onclick={onRun} disabled={busy}>
										{busy ? maintenanceT.running : maintenanceT.runNow}
									</button>
								{/if}
							</div>

							{#if !status.available}
								<p class="text-xs text-warning">{maintenanceT.notAvailable}</p>
							{:else}
								<div class="text-xs text-base-content/60 flex flex-wrap items-center gap-x-3">
									<span>
										{maintenanceT.lastRun}:
										{#if status.lastRunIso}
											<DateAtom value={status.lastRunIso} {t} />
										{:else}
											{maintenanceT.never}
										{/if}
									</span>
									{#if status.lastResult}
										<span
											>{maintenanceT.lastResult}:
											<span class="font-mono">{status.lastResult}</span></span
										>
									{/if}
								</div>
							{/if}
						</div>
					{/snippet}

					{@render opCard(
						'analyze',
						maintenanceT.analyzeLabel,
						maintenanceT.analyzeDesc,
						syncBusy,
						() => runSync('analyze', maintenanceT.analyzeDone)
					)}
					{@render opCard(
						'integrityCheck',
						maintenanceT.integrityLabel,
						maintenanceT.integrityDesc,
						detachedBusy,
						() => runDetached('integrityCheck')
					)}
					{@render opCard(
						'ftsRebuild',
						maintenanceT.ftsLabel,
						maintenanceT.ftsDesc,
						detachedBusy,
						() => runDetached('ftsRebuild')
					)}
					{@render opCard(
						'statsRebuild',
						maintenanceT.statsRebuildLabel,
						maintenanceT.statsRebuildDesc,
						syncBusy,
						() => runSync('statsRebuild', maintenanceT.success)
					)}
					{@render opCard(
						'statsFreeze',
						maintenanceT.statsFreezeLabel,
						maintenanceT.statsFreezeDesc,
						syncBusy,
						() => runSync('statsFreeze', maintenanceT.success)
					)}
				</div>
			{:else}
				<OfflinePlaceholder {t} />
			{/if}
		</div>
	</GesturePageLayout>
</DualColumnLayout>
