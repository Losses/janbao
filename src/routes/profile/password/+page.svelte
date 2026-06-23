<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import SettingsMenuPanel from '$lib/components/panels/SettingsMenuPanel.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import PasswordStrength from '$lib/components/atoms/PasswordStrength.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { MIN_PASSWORD_LENGTH } from '$lib/utils/validation';
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

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		message = null;

		if (newPassword.length < MIN_PASSWORD_LENGTH) {
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
	{#if user}
		<SettingsSidebar {user} {t} activeItem="changePassword" />
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
			<PageTitle title={profileT.changePassword} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="space-y-4">
				<FormField
					id="currentPassword"
					type="password"
					label={profileT.currentPassword}
					bind:value={currentPassword}
					required
					autocomplete="current-password"
				/>

				<FormField
					id="newPassword"
					type="password"
					label={profileT.newPassword}
					bind:value={newPassword}
					required
					autocomplete="new-password"
				>
					{#snippet hint()}
						<PasswordStrength
							password={newPassword}
							minLength={MIN_PASSWORD_LENGTH}
							labelTooShort={t.auth.passwordTooShort}
							labelOk={t.auth.passwordStrengthOk}
						/>
					{/snippet}
				</FormField>

				<FormField
					id="confirmPassword"
					type="password"
					label={t.auth.confirmPassword}
					bind:value={confirmPassword}
					required
					autocomplete="new-password"
				/>

				<div class="pt-2">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						{saving ? t.common.saving : t.common.submit}
					</button>
				</div>
			</form>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
