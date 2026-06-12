<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
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
	// svelte-ignore state_referenced_locally
	let avatarFileId = $state(data.avatarFileId);

	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let isDrawerOpen = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	const userSlug = $derived(generateSlug(user?.username || ''));

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!fileInput?.files || fileInput.files.length === 0) return;

		const file = fileInput.files[0];

		// Client-side validation: max 1MB
		if (file.size > 1024 * 1024) {
			message = { type: 'error', text: profileT.avatarTooLarge };
			return;
		}

		// Validate MIME type
		const allowedTypes = [
			'image/png',
			'image/jpeg',
			'image/webp',
			'image/gif',
			'image/avif',
			'image/bmp'
		];
		if (!allowedTypes.includes(file.type)) {
			message = { type: 'error', text: profileT.avatarInvalidType };
			return;
		}

		saving = true;
		message = null;

		try {
			// Upload the file
			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', 'avatar');

			const uploadRes = await fetch('/upload', { method: 'POST', body: formData });
			const uploadResult: ApiResult = await uploadRes.json();

			if (!uploadResult.fileId) {
				message = { type: 'error', text: uploadResult.error || t.common.error };
				saving = false;
				return;
			}

			// Update user's avatarFileId via profile edit endpoint
			const editRes = await fetch('/api/profile/edit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ avatarFileId: uploadResult.fileId })
			});

			const editResult: ApiResult = await editRes.json();
			if (editResult.success) {
				avatarFileId = uploadResult.fileId;
				message = { type: 'success', text: t.common.success };
			} else {
				message = { type: 'error', text: editResult.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.avatar)}</title>
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
				<li><a href="/profile/picture" class="active">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.avatar}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<div class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm space-y-6">
			<!-- Current Avatar Preview -->
			<div class="flex items-center gap-4">
				<Avatar
					src={avatarFileId ? `/img/${avatarFileId}` : null}
					displayName={user?.displayName || '?'}
					size="lg"
				/>
				<div>
					<p class="font-medium text-base-content">{profileT.currentAvatar}</p>
					<p class="text-sm text-base-content/50">
						{profileT.avatarRequirements}
					</p>
				</div>
			</div>

			<!-- Upload Form -->
			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="form-control">
					<label class="label" for="avatar-file">
						<span class="label-text font-medium">{profileT.selectFile}</span>
					</label>
					<input
						id="avatar-file"
						type="file"
						class="file-input file-input-bordered"
						accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
						bind:this={fileInput}
					/>
				</div>

				<div class="pt-2">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						{saving ? t.common.saving : profileT.uploadAvatar}
					</button>
				</div>
			</form>
		</div>
	</div>
</DualColumnLayout>
