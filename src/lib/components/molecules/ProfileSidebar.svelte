<script lang="ts">
	/**
	 * ProfileSidebar Molecule - Navigation sidebar for profile-related pages.
	 * Shows profile navigation with owner/visitor view guards.
	 * Owner sees: Activities, Notifications, Invitations, Mailbox, Discussions, Comments + Account Settings button.
	 * Visitor sees: Activities, Discussions, Comments only.
	 * Guest sees: Same as visitor + Sign-in/Register links.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import type { UserInfoSummary } from '$lib/types/api';

	interface ProfileSidebarProps {
		user: UserInfoSummary | null;
		t: Record<string, Record<string, string> | string>;
		activeItem?: string;
		targetUserId: string;
		targetUserSlug: string;
	}

	let { user, t, activeItem = '', targetUserId, targetUserSlug }: ProfileSidebarProps = $props();

	const profileT = $derived((t as Record<string, Record<string, string>>).profile ?? {});
	const tNav = $derived((t as Record<string, Record<string, string>>).nav ?? {});

	const isOwner = $derived(!!user && user.id === targetUserId);
</script>

<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
	{#if user}
		<UserInfoBlock {user} {t} />
		<div class="divider my-1"></div>
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
			</ul>
			<a href="/profile/edit" class="btn btn-outline btn-sm w-full">
				{profileT['accountSettings']}
			</a>
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
		<div class="divider my-1"></div>
		<div class="flex gap-2">
			<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{tNav['signin']}</a>
			<a href="/entry/register" class="btn btn-sm btn-outline flex-1">
				{tNav['register']}
			</a>
		</div>
	{/if}
</div>
