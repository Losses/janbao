<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import FileInput from '$lib/components/atoms/FileInput.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	// svelte-ignore state_referenced_locally
	let avatarFileId = $state(data.avatarFileId);
	const online = getOnlineStore();

	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

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
			// Upload the file (raw body  - streamed server-side; X-Upload-Type marks avatar)
			const uploadRes = await fetch('/upload', {
				method: 'POST',
				headers: { 'X-Upload-Type': 'avatar' },
				body: file
			});
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
	{#if user}
		<SettingsSidebar {user} {t} activeItem="avatar" />
	{/if}
{/snippet}

{#snippet leftPanel()}
	{#if user}
		<SettingsMenuPanel {user} {t} lang={data.lang} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout
		left={leftPanel}
		leftHref="/profile/settings"
		fallbackRoute="/profile/settings"
	>
		<div class="space-y-3">
			<PageTitle title={profileT.avatar} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<div class="space-y-3">
				<!-- Current Avatar Preview -->
				<div class="flex items-center gap-4">
					<Avatar
						userId={user?.id ?? null}
						{avatarFileId}
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
				<form onsubmit={handleSubmit}>
					<fieldset disabled={!online.online} class="space-y-4">
						<FileInput
							id="avatar-file"
							label={profileT.selectFile}
							placeholder={t.upload.noFile}
							accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
							bind:inputEl={fileInput}
						/>

						<div class="pt-2">
							<button type="submit" class="btn btn-primary" disabled={saving}>
								{saving ? t.common.saving : profileT.uploadAvatar}
							</button>
						</div>
					</fieldset>
				</form>
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
