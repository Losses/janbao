<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import AlertMessage from '$lib/components/AlertMessage.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiCheck } from '@mdi/js';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResponse } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const t = $derived(data.t);

	let email = $state('');
	let errorMessage = $state('');
	let successMessage = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!email) {
			errorMessage = t.auth.fillAllFields;
			return;
		}

		loading = true;
		errorMessage = '';
		successMessage = '';

		try {
			const res = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});

			const result = (await res.json()) as ApiResponse;
			if (res.ok && result.success) {
				successMessage = t.auth.forgotPasswordEmailSent;
				email = '';
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
	<title>{formatTitle(t.auth.forgotPassword)}</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center">
		<h2 class="text-3xl font-bold tracking-tight text-base-content">{t.auth.forgotPassword}</h2>
	</div>

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
				<label class="label text-sm font-semibold" for="email">
					<span class="label-text">{t.auth.email}</span>
				</label>
				<input
					id="email"
					type="email"
					required
					bind:value={email}
					class="input input-bordered w-full"
					placeholder="name@example.com"
				/>
			</div>
		</div>

		<div>
			<button
				type="submit"
				disabled={loading}
				class="btn btn-primary w-full text-base font-semibold"
			>
				{#if loading}
					<span class="loading loading-spinner"></span>
				{/if}
				{t.common.submit}
			</button>
		</div>
	</form>

	<div class="text-center text-sm mt-4">
		<a href="/entry/signin" class="link link-primary font-medium">{t.nav.signin}</a>
	</div>
</SingleColumnLayout>
