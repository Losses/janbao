<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const profileT = $derived(t.profile);

	// svelte-ignore state_referenced_locally
	let isStealth = $state(data.isStealth);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let isDrawerOpen = $state(false);

	const userSlug = $derived(generateSlug(user?.username || ''));

	async function toggleStealth() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/stealth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isStealth: !isStealth })
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				isStealth = !isStealth;
				message = { type: 'success', text: t.common.success };
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.stealthSettings)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.dynamics}</a></li>
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow" class="active">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.stealthSettings}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<div class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm space-y-4">
			<p class="text-sm text-base-content/70">
				{profileT.stealthDescription}
			</p>

			<div class="flex items-center justify-between p-4 bg-base-200/50 rounded-lg">
				<div>
					<p class="font-medium text-base-content">
						{profileT.stealthMode}
					</p>
					<p class="text-sm text-base-content/60">
						{isStealth ? profileT.stealthActive : profileT.stealthInactive}
					</p>
				</div>
				<button
					class="btn btn-sm {isStealth ? 'btn-warning' : 'btn-primary'}"
					onclick={toggleStealth}
					disabled={saving}
				>
					{isStealth ? profileT.disableStealth : profileT.enableStealth}
				</button>
			</div>
		</div>
	</div>
</DualColumnLayout>
