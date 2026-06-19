<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { invalidateAll } from '$app/navigation';
	import type {
		InvitationItem,
		InvitationRequestResponse,
		ApiResult,
		FeedbackMessage
	} from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const online = getOnlineStore();

	const t = $derived(data.t);
	const invitationT = $derived(t.invitation);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const invitations = $derived(data.invitations as InvitationItem[]);
	let requesting = $state(false);
	let feedback = $state<FeedbackMessage | null>(null);
	let inviteLink = $state('');
	let showInviteModal = $state(false);

	const inviteCopyText = $derived(t.invitation.inviteLinkCopyText.replace('{link}', inviteLink));

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
		if (!online.online) return;
		requesting = true;
		feedback = null;
		try {
			const res = await fetch('/api/invitations/request', { method: 'POST' });
			const result = (await res.json()) as InvitationRequestResponse & ApiResult;
			if (result.success) {
				inviteLink = result.inviteLink;
				showInviteModal = true;
				await invalidateAll();
				requesting = false;
				return;
			}
			feedback = { type: 'error', text: result.error || t.common.error };
		} catch {
			feedback = { type: 'error', text: t.auth.networkError };
		}
		requesting = false;
	}

	async function copyInviteLink() {
		await navigator.clipboard.writeText(inviteCopyText);
		feedback = { type: 'success', text: invitationT.inviteLinkCopied };
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
	<div class="space-y-3">
		<PageTitle title={profileT.invitations} />

		{#if feedback}
			<div
				class="alert {feedback.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{feedback.text}
			</div>
		{/if}

		<div class="space-y-3">
			<p class="text-sm text-base-content/80">{allowanceText}</p>
			<button
				class="btn btn-primary btn-sm"
				onclick={requestCode}
				disabled={requesting || !data.canRequestMore || !online.online}
			>
				{#if requesting}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				{invitationT.requestCode}
			</button>
		</div>

		{#if invitations.length === 0}
			<EmptyState message={invitationT.noInvitations} />
		{:else}
			<div class="overflow-hidden">
				<div class="overflow-x-auto">
					<table class="table table-sm [&_tr]:border-base-300">
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
											<span class="text-base-content/40">{invitationT.statusUnused}</span>
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

{#if showInviteModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{invitationT.inviteLinkModalTitle}</h3>
			<p class="py-2 text-sm text-base-content/80">{invitationT.inviteLinkGuidance}</p>
			<p
				class="py-3 text-sm break-all select-all whitespace-pre-line border border-dashed border-base-300 p-2 rounded bg-base-200"
			>
				{inviteCopyText}
			</p>
			<div class="modal-action gap-2">
				<button class="btn btn-sm btn-primary" onclick={copyInviteLink}>
					{invitationT.copyInviteLink}
				</button>
				<button class="btn btn-sm btn-ghost" onclick={() => (showInviteModal = false)}>
					{t.common.cancel}
				</button>
			</div>
		</div>
	</div>
{/if}
