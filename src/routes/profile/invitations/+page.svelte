<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { invalidateAll } from '$app/navigation';
	import type { InvitationItem, ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const invitationT = $derived(t.invitation);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const invitations = $derived(data.invitations as InvitationItem[]);
	let requesting = $state(false);
	let feedback = $state<FeedbackMessage | null>(null);

	const userSlug = $derived(generateSlug(user?.username || ''));
	const remaining = $derived(Math.max(0, data.monthlyLimit - data.requestedThisMonth));
	const allowanceText = $derived(
		data.isAdmin
			? invitationT.adminUnlimited
			: invitationT.thisMonthAllowance.replace('{count}', String(remaining))
	);

	function statusVariant(status: InvitationItem['status']): 'primary' | 'neutral' | 'warning' {
		if (status === 'used') return 'primary';
		if (status === 'expired') return 'warning';
		return 'neutral';
	}

	function statusLabel(status: InvitationItem['status']): string {
		if (status === 'used') return invitationT.statusUsed;
		if (status === 'expired') return invitationT.statusExpired;
		return invitationT.statusUnused;
	}

	async function requestCode() {
		requesting = true;
		feedback = null;
		try {
			const res = await fetch('/api/invitations/request', { method: 'POST' });
			const result: ApiResult = await res.json();
			if (result.success) {
				goto(window.location.pathname);
				return;
			}
			feedback = { type: 'error', text: result.error || t.common.error };
		} catch {
			feedback = { type: 'error', text: t.auth.networkError };
		}
		requesting = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.invitations)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar
			{user}
			{t}
			activeItem="invitations"
			targetUserId={user.id}
			targetUserSlug={userSlug}
		/>
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{profileT.invitations}</h1>

		{#if feedback}
			<div
				class="alert {feedback.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{feedback.text}
			</div>
		{/if}

		<div class="card bg-base-100 border border-base-200 rounded-xl p-5 shadow-sm space-y-3">
			<p class="text-sm text-base-content/80">{allowanceText}</p>
			<button
				class="btn btn-primary btn-sm"
				onclick={requestCode}
				disabled={requesting || !data.canRequestMore}
			>
				{#if requesting}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				{invitationT.requestCode}
			</button>
		</div>

		{#if invitations.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{invitationT.noInvitations}
			</div>
		{:else}
			<div class="card bg-base-100 border border-base-200 rounded-xl shadow-sm overflow-hidden">
				<div class="overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th>{invitationT.code}</th>
								<th>{invitationT.usedBy}</th>
								<th>{invitationT.requestedAt}</th>
								<th>{invitationT.status}</th>
								<th>{invitationT.expiresAt}</th>
							</tr>
						</thead>
						<tbody>
							{#each invitations as inv (inv.code)}
								<tr>
									<td class="font-mono text-xs">{inv.code}</td>
									<td>
										{#if inv.usedByUsername}
											{inv.usedByUsername}
										{:else}
											<span class="text-base-content/40">{invitationT.unused}</span>
										{/if}
									</td>
									<td>
										<DateComponent value={inv.createdAt} {t} class="text-xs text-base-content/60" />
									</td>
									<td>
										<Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
									</td>
									<td>
										<DateComponent value={inv.expiresAt} {t} class="text-xs text-base-content/60" />
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
</DualColumnLayout>
