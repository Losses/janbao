<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage, ProfileEditBody } from '$lib/types/api';
	import type { PageData } from './$types';
	import { isValidUsername } from '$lib/utils/validation';

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

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		message = null;

		try {
			const payload: ProfileEditBody = {
				displayName,
				email,
				showEmail,
				languagePreference
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
	<div class="space-y-3">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.editAccount}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-4">
			<!-- Username -->
			<div class="form-control">
				<label class="label" for="username">
					<span class="label-text font-medium">{t.auth.username}</span>
				</label>
				<input
					id="username"
					type="text"
					class="input input-bordered {username && !isValidUsername(username) ? 'input-error' : ''}"
					bind:value={username}
					disabled={!allowSlugChange || !isAdmin}
					aria-describedby={allowSlugChange && !isAdmin ? 'username-hint' : undefined}
				/>
				{#if username && !isValidUsername(username)}
					<p class="text-xs text-error mt-1">
						{t.auth.invalidUsername}
					</p>
				{/if}
				{#if allowSlugChange && !isAdmin}
					<label class="label" id="username-hint" for="username">
						<span class="label-text-alt text-base-content/50">
							{profileT.usernameAdminOnly}
						</span>
					</label>
				{/if}
			</div>

			<!-- Display Name -->
			<div class="form-control">
				<label class="label" for="displayName">
					<span class="label-text font-medium">{t.auth.displayName}</span>
				</label>
				<input
					id="displayName"
					type="text"
					class="input input-bordered"
					bind:value={displayName}
					required
				/>
			</div>

			<!-- Email -->
			<div class="form-control">
				<label class="label" for="email">
					<span class="label-text font-medium">{t.auth.email}</span>
				</label>
				<input id="email" type="email" class="input input-bordered" bind:value={email} required />
			</div>

			<!-- Show Email Toggle -->
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

			<!-- Language Preference -->
			<div class="form-control">
				<label class="label" for="language">
					<span class="label-text font-medium">{profileT.language}</span>
				</label>
				<select id="language" class="select select-bordered" bind:value={languagePreference}>
					<option value="en">{t.profile.languageEnglish}</option>
					<option value="zh-CN">{t.profile.languageChinese}</option>
				</select>
			</div>

			<div class="pt-2">
				<button type="submit" class="btn btn-primary" disabled={saving}>
					{saving ? t.common.saving : t.common.submit}
				</button>
			</div>
		</form>
	</div>
</DualColumnLayout>
