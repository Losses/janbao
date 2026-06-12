<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import AlertMessage from '$lib/components/AlertMessage.svelte';
	import { goto } from '$app/navigation';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';
	import type { ApiResponse } from '$lib/types/api';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const t = $derived(data.t);

	let usernameOrEmail = $state('');
	let password = $state('');
	let rememberMe = $state(false);
	let errorMessage = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!usernameOrEmail || !password) {
			errorMessage = t.auth.fillAllFields;
			return;
		}

		loading = true;
		errorMessage = '';

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ usernameOrEmail, password, rememberMe })
			});

			const result = (await res.json()) as ApiResponse;
			if (res.ok && result.success) {
				await goto('/', { invalidateAll: true });
			} else {
				errorMessage = result.error || t.auth.invalidCredentials;
			}
		} catch {
			errorMessage = t.auth.networkError;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{formatTitle(t.nav.signin)}</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center">
		<h2 class="text-3xl font-bold tracking-tight text-neutral-content">{t.nav.signin}</h2>
	</div>

	<form class="mt-8 space-y-6" onsubmit={handleSubmit}>
		<AlertMessage message={errorMessage} />

		<div class="space-y-4 rounded-md shadow-sm">
			<div class="form-control">
				<label class="label text-sm font-semibold" for="usernameOrEmail">
					<span class="label-text">{t.auth.usernameOrEmail}</span>
				</label>
				<input
					id="usernameOrEmail"
					type="text"
					required
					bind:value={usernameOrEmail}
					class="input input-bordered w-full"
					placeholder="name@example.com"
				/>
			</div>

			<div class="form-control">
				<label class="label text-sm font-semibold" for="password">
					<span class="label-text">{t.auth.password}</span>
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
		</div>

		<div class="flex items-center justify-between">
			<label class="label cursor-pointer justify-start gap-2">
				<input
					type="checkbox"
					bind:checked={rememberMe}
					class="checkbox checkbox-primary checkbox-sm"
				/>
				<span class="label-text text-sm">{t.auth.rememberMe}</span>
			</label>
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
				{t.auth.signinBtn}
			</button>
		</div>
	</form>

	<div class="text-center text-sm">
		<span class="text-base-content/60">{t.auth.newHere}</span>
		<a href="/entry/register" class="link link-primary font-medium ml-1">{t.nav.register}</a>
	</div>
</SingleColumnLayout>
