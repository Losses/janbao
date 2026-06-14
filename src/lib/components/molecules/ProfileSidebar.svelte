<script lang="ts">
	/**
	 * ProfileSidebar Molecule - Navigation sidebar for profile-related pages.
	 * Shows profile navigation with owner/visitor view guards.
	 * Owner sees: Activities, Notifications, Invitations, Mailbox, Discussions, Comments.
	 * Visitor sees: Activities, Discussions, Comments only.
	 * Guest sees: Same as visitor + Sign-in/Register links.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface ProfileSidebarProps {
		user: UserInfoSummary | null;
		t: TranslationDict;
		activeItem?: string;
		targetUserId: number;
		targetUserSlug: string;
	}

	let { user, t, activeItem = '', targetUserId, targetUserSlug }: ProfileSidebarProps = $props();

	const profileT = $derived(t.profile);
	const tNav = $derived(t.nav);

	const isOwner = $derived(!!user && user.id === targetUserId);
	const isAdmin = $derived(!!user && user.groupSlug === 'admin');

	let generatedLink = $state('');
	let showModal = $state(false);

	interface ResetLinkResponse {
		resetLink: string;
	}

	interface ResetLinkErrorResponse {
		error: string;
	}

	async function handleGenerateResetLink() {
		const confirmed = confirm(t.auth.confirmGenerateResetLink);
		if (!confirmed) return;

		try {
			const res = await fetch('/api/auth/admin-generate-reset', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId })
			});
			if (res.ok) {
				const data = (await res.json()) as ResetLinkResponse;
				generatedLink = data.resetLink;
				showModal = true;
			} else {
				const err = (await res.json()) as ResetLinkErrorResponse;
				alert(err.error || t.common.error);
			}
		} catch {
			alert(t.auth.networkError);
		}
	}

	function copyLink() {
		navigator.clipboard.writeText(generatedLink);
		alert(t.common.saved || 'Copied!');
	}
</script>

<div class="space-y-4">
	{#if user}
		<UserInfoBlock {user} {t} />
		{#if isOwner}
			<!-- Owner View: Full profile navigation -->
			<ul class="menu menu-sm w-full gap-1">
				<li>
					<a
						href="/profile/{user.id}/{targetUserSlug}"
						class={activeItem === 'activities' ? 'active' : ''}
					>
						{profileT['activities']}
					</a>
				</li>
				<li>
					<a href="/notifications" class={activeItem === 'notifications' ? 'active' : ''}>
						{profileT['notifications']}
					</a>
				</li>
				<li>
					<a href="/profile/invitations" class={activeItem === 'invitations' ? 'active' : ''}>
						{profileT['invitations']}
					</a>
				</li>
				<li>
					<a href="/messages/inbox" class={activeItem === 'mailbox' ? 'active' : ''}>
						{profileT['mailbox']}
					</a>
				</li>
				<li>
					<a
						href="/profile/discussions/{user.id}/{targetUserSlug}"
						class={activeItem === 'discussions' ? 'active' : ''}
					>
						{profileT['discussions']}
					</a>
				</li>
				<li>
					<a
						href="/profile/comments/{user.id}/{targetUserSlug}"
						class={activeItem === 'comments' ? 'active' : ''}
					>
						{profileT['comments']}
					</a>
				</li>
				{#if isAdmin}
					<li class="mt-2 pt-2 border-t border-base-content/10">
						<button
							onclick={handleGenerateResetLink}
							class="btn btn-xs btn-outline btn-primary w-full text-center"
						>
							{t.auth.generateResetLink}
						</button>
					</li>
				{/if}
			</ul>
		{:else}
			<!-- Visitor View: Public navigation only -->
			<ul class="menu menu-sm w-full gap-1">
				<li>
					<a
						href="/profile/{targetUserId}/{targetUserSlug}"
						class={activeItem === 'activities' ? 'active' : ''}
					>
						{profileT['activities']}
					</a>
				</li>
				<li>
					<a
						href="/profile/discussions/{targetUserId}/{targetUserSlug}"
						class={activeItem === 'discussions' ? 'active' : ''}
					>
						{profileT['discussions']}
					</a>
				</li>
				<li>
					<a
						href="/profile/comments/{targetUserId}/{targetUserSlug}"
						class={activeItem === 'comments' ? 'active' : ''}
					>
						{profileT['comments']}
					</a>
				</li>
				{#if isAdmin}
					<li class="mt-2 pt-2 border-t border-base-content/10">
						<button
							onclick={handleGenerateResetLink}
							class="btn btn-xs btn-outline btn-primary w-full text-center"
						>
							{t.auth.generateResetLink}
						</button>
					</li>
				{/if}
			</ul>
		{/if}
	{:else}
		<!-- Guest View: Public navigation + Sign-in/Register -->
		<ul class="menu menu-sm w-full gap-1">
			<li>
				<a
					href="/profile/{targetUserId}/{targetUserSlug}"
					class={activeItem === 'activities' ? 'active' : ''}
				>
					{profileT['activities']}
				</a>
			</li>
			<li>
				<a
					href="/profile/discussions/{targetUserId}/{targetUserSlug}"
					class={activeItem === 'discussions' ? 'active' : ''}
				>
					{profileT['discussions']}
				</a>
			</li>
			<li>
				<a
					href="/profile/comments/{targetUserId}/{targetUserSlug}"
					class={activeItem === 'comments' ? 'active' : ''}
				>
					{profileT['comments']}
				</a>
			</li>
		</ul>
		<div class="flex gap-2">
			<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{tNav['signin']}</a>
			<a href="/entry/register" class="btn btn-sm btn-outline flex-1">
				{tNav['register']}
			</a>
		</div>
	{/if}
</div>

{#if showModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{t.auth.resetPassword}</h3>
			<p
				class="py-4 text-sm break-all select-all border border-dashed border-base-300 p-2 rounded bg-base-200"
			>
				{generatedLink}
			</p>
			<div class="modal-action gap-2">
				<button class="btn btn-sm btn-primary" onclick={copyLink}>
					{t.common.confirm || 'Copy'}
				</button>
				<button class="btn btn-sm btn-ghost" onclick={() => (showModal = false)}>
					{t.common.cancel || 'Close'}
				</button>
			</div>
		</div>
	</div>
{/if}
