<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { InvitationItem, ApiResult } from '$lib/types/api';
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
	let isDrawerOpen = $state(false);
	let requesting = $state(false);

	const userSlug = $derived(generateSlug(user?.username || ''));
	const remaining = $derived(Math.max(0, data.monthlyLimit - data.requestedThisMonth));
	const allowanceText = $derived(
		invitationT.thisMonthAllowance.replace('{count}', String(remaining))
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
		try {
			const res = await fetch('/api/invitations/request', { method: 'POST' });
			const result: ApiResult = await res.json();
			if (result.success) {
				goto(window.location.pathname);
			}
		} catch {
			// silently fail
		}
		requesting = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.invitations)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.dynamics}</a></li>
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations" class="active">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/onlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{profileT.invitations}</h1>

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
