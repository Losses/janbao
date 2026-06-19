<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import AlertMessage from '$lib/components/AlertMessage.svelte';
	import FormField from '$lib/components/atoms/FormField.svelte';
	import PasswordStrength from '$lib/components/atoms/PasswordStrength.svelte';
	import { goto } from '$app/navigation';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';
	import type { ApiResponse } from '$lib/types/api';
	import { isValidUsername, MIN_PASSWORD_LENGTH } from '$lib/utils/validation';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const t = $derived(data.t);

	let invitationCode = $state('');
	let username = $state('');
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let errorMessage = $state('');
	let loading = $state(false);

	const isPasswordStrong = $derived(password.length >= MIN_PASSWORD_LENGTH);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (!invitationCode || !username || !displayName || !email || !password || !confirmPassword) {
			errorMessage = t.auth.fillAllFields;
			return;
		}

		if (!isPasswordStrong) {
			errorMessage = t.auth.passwordTooShort;
			return;
		}

		if (!isValidUsername(username)) {
			errorMessage = t.auth.invalidUsername;
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = t.auth.passwordsMismatch;
			return;
		}

		loading = true;
		errorMessage = '';

		try {
			const res = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					invitationCode,
					username,
					displayName,
					email,
					password,
					confirmPassword
				})
			});

			const result = (await res.json()) as ApiResponse;
			if (res.ok && result.success) {
				await goto('/', { invalidateAll: true });
			} else {
				errorMessage = result.error || t.auth.registrationFailed;
			}
		} catch {
			errorMessage = t.auth.networkError;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{formatTitle(t.nav.register)}</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center">
		<h2 class="text-3xl font-bold tracking-tight text-base-content">{t.nav.register}</h2>
	</div>

	<form class="mt-8 space-y-4" onsubmit={handleSubmit}>
		<AlertMessage message={errorMessage} />

		<div class="space-y-3">
			<FormField
				id="invitationCode"
				label={t.auth.invitationCode}
				bind:value={invitationCode}
				placeholder="ABC-123-XYZ"
				required
			/>

			<FormField
				id="username"
				label={t.auth.username}
				bind:value={username}
				placeholder="username"
				required
				error={username && !isValidUsername(username) ? t.auth.invalidUsername : ''}
			/>

			<FormField
				id="displayName"
				label={t.auth.displayName}
				bind:value={displayName}
				placeholder={t.auth.displayName}
				required
			/>

			<FormField
				id="email"
				type="email"
				label={t.auth.email}
				bind:value={email}
				placeholder="name@example.com"
				required
			/>

			<FormField
				id="password"
				type="password"
				label={t.auth.password}
				bind:value={password}
				placeholder="••••••••"
				required
			>
				{#snippet hint()}
					<PasswordStrength
						{password}
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
				placeholder="••••••••"
				required
			/>
		</div>

		<div class="pt-2">
			<button
				type="submit"
				disabled={loading}
				class="btn btn-primary w-full text-base font-semibold"
			>
				{#if loading}
					<span class="loading loading-spinner"></span>
				{/if}
				{t.auth.registerBtn}
			</button>
		</div>
	</form>

	<div class="text-center text-sm">
		<span class="text-base-content/60">{t.auth.alreadyHaveAccount}</span>
		<a href="/entry/signin" class="link link-primary font-medium ml-1">{t.nav.signin}</a>
	</div>
</SingleColumnLayout>
