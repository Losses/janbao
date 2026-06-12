<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
	const t = $derived(data.t);

	let invitationCode = $state('');
	let username = $state('');
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let errorMessage = $state('');
	let loading = $state(false);

	// Client-side strength indicator: check if password length is at least 5
	const isPasswordStrong = $derived(password.length >= 5);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (!invitationCode || !username || !displayName || !email || !password || !confirmPassword) {
			errorMessage = 'All fields are required.';
			return;
		}

		if (!isPasswordStrong) {
			errorMessage = 'Password must be at least 5 characters long.';
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
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

			const result = await res.json();
			if (res.ok && result.success) {
				await goto('/', { invalidateAll: true });
			} else {
				errorMessage = result.error || 'Registration failed.';
			}
		} catch {
			errorMessage = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{t.nav.register} - Janbao</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center">
		<h2 class="text-3xl font-bold tracking-tight text-neutral-content">{t.nav.register}</h2>
	</div>

	<form class="mt-8 space-y-4" onsubmit={handleSubmit}>
		{#if errorMessage}
			<div class="alert alert-error text-sm rounded-lg py-2">
				<span>{errorMessage}</span>
			</div>
		{/if}

		<div class="space-y-3">
			<div class="form-control">
				<label class="label text-sm font-semibold" for="invitationCode">
					<span class="label-text">{t.auth.invitationCode}</span>
				</label>
				<input
					id="invitationCode"
					type="text"
					required
					bind:value={invitationCode}
					class="input input-bordered w-full"
					placeholder="ABC-123-XYZ"
				/>
			</div>

			<div class="form-control">
				<label class="label text-sm font-semibold" for="username">
					<span class="label-text">{t.auth.username}</span>
				</label>
				<input
					id="username"
					type="text"
					required
					bind:value={username}
					class="input input-bordered w-full"
					placeholder="username"
				/>
			</div>

			<div class="form-control">
				<label class="label text-sm font-semibold" for="displayName">
					<span class="label-text">Display Name</span>
				</label>
				<input
					id="displayName"
					type="text"
					required
					bind:value={displayName}
					class="input input-bordered w-full"
					placeholder="Display Name"
				/>
			</div>

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
				<!-- Password Strength Indicator -->
				{#if password.length > 0}
					<span class="text-xs mt-1 {isPasswordStrong ? 'text-success' : 'text-error'}">
						{isPasswordStrong
							? 'Password length meets requirements'
							: 'Password must be at least 5 characters long'}
					</span>
				{/if}
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
		<span class="text-base-content/60">Already have an account?</span>
		<a href="/entry/signin" class="link link-primary font-medium ml-1">{t.nav.signin}</a>
	</div>
</SingleColumnLayout>
