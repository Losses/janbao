<script lang="ts">
	import NavPipelineHost from '$lib/components/templates/NavPipelineHost.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import Field from '$lib/components/atoms/Field.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage, ProfileEditBody } from '$lib/types/api';
	import type { PageData } from './$types';
	import { isValidUsername, MAX_BIO_LENGTH } from '$lib/utils/validation';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);

	// svelte-ignore state_referenced_locally
	let displayName = $state(data.user.displayName);
	// svelte-ignore state_referenced_locally
	let bio = $state(data.user.bio ?? '');
	// svelte-ignore state_referenced_locally
	let email = $state(data.user.email);
	// svelte-ignore state_referenced_locally
	let showEmail = $state(data.user.showEmail);
	// svelte-ignore state_referenced_locally
	let languagePreference = $state(data.user.languagePreference);
	// svelte-ignore state_referenced_locally
	let username = $state(data.user.username);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	const isAdmin = $derived(data.user.groupSlug === 'admin');
	const allowSlugChange = $derived(data.allowSlugChange);
	const online = getOnlineStore();

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		message = null;

		try {
			const payload: ProfileEditBody = {
				displayName,
				email,
				showEmail,
				languagePreference,
				bio
			};

			if (allowSlugChange && isAdmin && username !== data.user.username) {
				const trimmedUsername = username.trim();
				if (!isValidUsername(trimmedUsername)) {
					message = { type: 'error', text: t.auth.invalidUsername };
					saving = false;
					return;
				}
				payload.username = trimmedUsername;
			}

			const res = await fetch('/api/profile/edit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result: ApiResult = await res.json();
			if (result.success) {
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
	<title>{formatTitle(profileT.editAccount)}</title>
</svelte:head>

{#snippet sidebar()}
	<SettingsSidebar {user} {t} activeItem="editAccount" />
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<NavPipelineHost leftHref="/profile/settings">
		<div class="space-y-3">
			<PageTitle title={profileT.editAccount} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<form onsubmit={handleSubmit}>
				<fieldset disabled={!online.online} class="space-y-4">
					<FormField
						id="username"
						label={t.auth.username}
						bind:value={username}
						disabled={!allowSlugChange || !isAdmin}
						error={username && !isValidUsername(username) ? t.auth.invalidUsername : ''}
						hintId={allowSlugChange && !isAdmin ? 'username-hint' : undefined}
					>
						{#snippet hint()}
							{#if allowSlugChange && !isAdmin}
								<span class="block mt-1.5 text-xs text-base-content/50">
									{profileT.usernameAdminOnly}
								</span>
							{/if}
						{/snippet}
					</FormField>

					<FormField
						id="displayName"
						label={t.auth.displayName}
						bind:value={displayName}
						required
					/>

					<FormField
						id="bio"
						label={t.auth.bio}
						bind:value={bio}
						as="textarea"
						rows={2}
						maxlength={MAX_BIO_LENGTH}
					>
						{#snippet hint()}
							<span class="block mt-1.5 text-xs text-base-content/50">
								{bio.length}/{MAX_BIO_LENGTH}
							</span>
						{/snippet}
					</FormField>

					<FormField id="email" type="email" label={t.auth.email} bind:value={email} required />

					<div class="form-control">
						<label class="label cursor-pointer justify-start gap-3" for="showEmail">
							<input
								id="showEmail"
								type="checkbox"
								class="checkbox checkbox-sm"
								bind:checked={showEmail}
							/>
							<span class="label-text">{profileT.showEmail}</span>
						</label>
					</div>

					<Field id="language" label={profileT.language}>
						<select
							id="language"
							class="select select-bordered w-full"
							bind:value={languagePreference}
						>
							<option value="en">{t.profile.languageEnglish}</option>
							<option value="zh-CN">{t.profile.languageChinese}</option>
						</select>
					</Field>

					<div class="pt-2">
						<button type="submit" class="btn btn-primary" disabled={saving}>
							{saving ? t.common.saving : t.common.submit}
						</button>
					</div>
				</fieldset>
			</form>
		</div>
	</NavPipelineHost>
</DualColumnLayout>
