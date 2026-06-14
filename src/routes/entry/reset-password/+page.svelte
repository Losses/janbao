<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import AlertMessage from '$lib/components/AlertMessage.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiCheck } from '@mdi/js';
	import { goto } from '$app/navigation';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResponse } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const t = $derived(data.t);
	const token = $derived(data.token);

	let password = $state('');
	let confirmPassword = $state('');
	let errorMessage = $state('');
	let successMessage = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (!password || !confirmPassword) {
			errorMessage = t.auth.fillAllFields;
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = t.auth.passwordsMismatch;
			return;
		}

		if (password.length < 5) {
			errorMessage = t.auth.passwordTooShort;
			return;
		}

		loading = true;
		errorMessage = '';
		successMessage = '';

		try {
			const res = await fetch('/api/auth/reset-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, password })
			});

			const result = (await res.json()) as ApiResponse;
			if (res.ok && result.success) {
				successMessage = t.auth.resetPasswordSuccess;
				password = '';
				confirmPassword = '';
				setTimeout(() => {
					goto('/entry/signin');
				}, 2000);
			} else {
				errorMessage = result.error || t.common.error;
			}
		} catch {
			errorMessage = t.auth.networkError;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{formatTitle(t.auth.resetPassword)}</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center">
		<h2 class="text-3xl font-bold tracking-tight text-base-content">{t.auth.resetPassword}</h2>
	</div>

	{#if !token}
		<div class="mt-8">
			<AlertMessage message={t.auth.invalidOrExpiredToken} />
			<div class="text-center text-sm mt-4">
				<a href="/entry/forgot" class="link link-primary font-medium">{t.auth.forgotPassword}</a>
			</div>
		</div>
	{:else}
		<form class="mt-8 space-y-3" onsubmit={handleSubmit}>
			{#if errorMessage}
				<AlertMessage message={errorMessage} />
			{/if}

			{#if successMessage}
				<div class="alert alert-success shadow-sm rounded-field justify-start">
					<Icon path={mdiCheck} size={24} class="shrink-0" />
					<span>{successMessage}</span>
				</div>
			{/if}

			<div class="space-y-4 rounded-field shadow-sm">
				<div class="form-control">
					<label class="label text-sm font-semibold" for="password">
						<span class="label-text">{t.profile.newPassword}</span>
					</label>
					<input
						id="password"
						type="password"
						required
						bind:value={password}
						class="input input-bordered w-full"
						placeholder="••••••••"
					/>
				</div>

				<div class="form-control">
					<label class="label text-sm font-semibold" for="confirmPassword">
						<span class="label-text">{t.auth.confirmPassword}</span>
					</label>
					<input
						id="confirmPassword"
						type="password"
						required
						bind:value={confirmPassword}
						class="input input-bordered w-full"
						placeholder="••••••••"
					/>
				</div>
			</div>

			<div>
				<button
					type="submit"
					disabled={loading || !!successMessage}
					class="btn btn-primary w-full text-base font-semibold"
				>
					{#if loading}
						<span class="loading loading-spinner"></span>
					{/if}
					{t.common.submit}
				</button>
			</div>
		</form>
	{/if}
</SingleColumnLayout>
