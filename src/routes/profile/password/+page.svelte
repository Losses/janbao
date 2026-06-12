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
	const profileT = $derived(t.profile);
	const user = $derived(data.user);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let isDrawerOpen = $state(false);

	const userSlug = $derived(generateSlug(user?.username || ''));

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		message = null;

		if (newPassword.length < 5) {
			message = { type: 'error', text: t.auth.passwordTooShort };
			return;
		}

		if (newPassword !== confirmPassword) {
			message = { type: 'error', text: t.auth.passwordsMismatch };
			return;
		}

		saving = true;

		try {
			const res = await fetch('/api/profile/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				message = { type: 'success', text: t.common.success };
				currentPassword = '';
				newPassword = '';
				confirmPassword = '';
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
	<title>{formatTitle(profileT.changePassword)}</title>
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
				<li><a href="/profile/password" class="active">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.changePassword}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<form
			onsubmit={handleSubmit}
			class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm space-y-4"
		>
			<div class="form-control">
				<label class="label" for="currentPassword">
					<span class="label-text font-medium">{profileT.currentPassword}</span>
				</label>
				<input
					id="currentPassword"
					type="password"
					class="input input-bordered"
					bind:value={currentPassword}
					required
					autocomplete="current-password"
				/>
			</div>

			<div class="form-control">
				<label class="label" for="newPassword">
					<span class="label-text font-medium">{profileT.newPassword}</span>
				</label>
				<input
					id="newPassword"
					type="password"
					class="input input-bordered"
					bind:value={newPassword}
					required
					autocomplete="new-password"
				/>
				<label class="label" for="newPassword">
					<span class="label-text-alt text-base-content/50">{t.auth.passwordTooShort}</span>
				</label>
			</div>

			<div class="form-control">
				<label class="label" for="confirmPassword">
					<span class="label-text font-medium">{t.auth.confirmPassword}</span>
				</label>
				<input
					id="confirmPassword"
					type="password"
					class="input input-bordered"
					bind:value={confirmPassword}
					required
					autocomplete="new-password"
				/>
			</div>

			<div class="pt-2">
				<button type="submit" class="btn btn-primary" disabled={saving}>
					{saving ? t.common.saving : t.common.submit}
				</button>
			</div>
		</form>
	</div>
</DualColumnLayout>
