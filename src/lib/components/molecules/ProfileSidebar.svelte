<script lang="ts">
	/**
	 * ProfileSidebar Molecule - Navigation sidebar for profile-related pages.
	 * Shows profile navigation with owner/visitor view guards.
	 * Owner sees: Activities, Notifications, Invitations, Mailbox, Discussions, Comments.
	 * Visitor sees: Activities, Discussions, Comments only.
	 * Guest sees: Same as visitor + Sign-in/Register links.
	 */
	import { invalidateAll } from '$app/navigation';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import type {
		AdminManageableGroupItem,
		ApiResult,
		AuthAdminGenerateResetResponse,
		FeedbackMessage,
		UserInfoSummary
	} from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface ProfileSidebarProps {
		user: UserInfoSummary | null;
		t: TranslationDict;
		activeItem?: string;
		targetUserId: number;
		targetUserSlug: string;
		targetUserGroupSlug?: string | null;
		targetUserEmail?: string | null;
		manageableGroups?: AdminManageableGroupItem[];
	}

	let {
		user,
		t,
		activeItem = '',
		targetUserId,
		targetUserSlug,
		targetUserGroupSlug = null,
		targetUserEmail = null,
		manageableGroups = []
	}: ProfileSidebarProps = $props();

	const profileT = $derived(t.profile);
	const tNav = $derived(t.nav);

	const isOwner = $derived(!!user && user.id === targetUserId);
	const isAdmin = $derived(!!user && user.groupSlug === 'admin');
	const isSuperAdmin = $derived(!!user && user.id === 0);
	const canManageTargetGroup = $derived(
		isAdmin &&
			targetUserGroupSlug !== null &&
			targetUserGroupSlug !== 'admin' &&
			targetUserGroupSlug !== 'system' &&
			user?.id !== targetUserId
	);
	const canPromoteToAdmin = $derived(
		isSuperAdmin &&
			targetUserGroupSlug !== null &&
			targetUserGroupSlug !== 'admin' &&
			user?.id !== targetUserId
	);
	// The reset-link button mirrors the server rule: only the super-admin may
	// reset another admin's password. Peers cannot (prevents account takeover).
	const canResetTarget = $derived(
		isAdmin && user?.id !== targetUserId && (isSuperAdmin || targetUserGroupSlug !== 'admin')
	);

	let generatedLink = $state('');
	let resetGuidance = $state('');
	let showResetConfirm = $state(false);
	let showResetLink = $state(false);
	let groupSaving = $state(false);
	let overrideGroupSlug = $state<string | null>(null);
	let selectedGroupSlug = $derived(overrideGroupSlug ?? targetUserGroupSlug ?? '');
	let feedback = $state<FeedbackMessage | null>(null);

	const resetCopyText = $derived(
		t.auth.resetLinkCopyText
			.replace('{email}', targetUserEmail ?? '')
			.replace('{link}', generatedLink)
	);

	async function generateResetLink() {
		showResetConfirm = false;
		feedback = null;
		try {
			const res = await fetch('/api/auth/admin-generate-reset', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId })
			});
			const data = (await res.json()) as AuthAdminGenerateResetResponse & ApiResult;
			if (res.ok && data.success) {
				generatedLink = data.resetLink;
				resetGuidance = data.guidance;
				showResetLink = true;
			} else {
				feedback = { type: 'error', text: data.error || t.common.error };
			}
		} catch {
			feedback = { type: 'error', text: t.auth.networkError };
		}
	}

	async function copyLink() {
		await navigator.clipboard.writeText(resetCopyText);
		feedback = { type: 'success', text: t.auth.resetLinkCopied };
	}

	async function handleGroupChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		overrideGroupSlug = value;
		if (!value || value === targetUserGroupSlug) return;
		groupSaving = true;
		feedback = null;
		try {
			const res = await fetch('/api/admin/users/group', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId, groupSlug: value })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				feedback = { type: 'success', text: t.permissions.userGroupUpdated };
				await invalidateAll();
				overrideGroupSlug = null;
			} else {
				overrideGroupSlug = null;
				feedback = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			overrideGroupSlug = null;
			feedback = { type: 'error', text: t.auth.networkError };
		}
		groupSaving = false;
	}

	async function promoteToAdmin() {
		if (!canPromoteToAdmin) return;
		groupSaving = true;
		feedback = null;
		try {
			const res = await fetch('/api/admin/users/group', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId, groupSlug: 'admin' })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				feedback = { type: 'success', text: t.permissions.userGroupUpdated };
				await invalidateAll();
			} else {
				feedback = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			feedback = { type: 'error', text: t.auth.networkError };
		}
		groupSaving = false;
	}
</script>

{#snippet adminControls()}
	{#if isAdmin}
		<li class="mt-2 pt-2 border-t border-base-content/10 space-y-2">
			{#if canResetTarget}
				<button
					onclick={() => (showResetConfirm = true)}
					class="btn btn-xs btn-outline btn-primary w-full text-center"
				>
					{t.auth.generateResetLink}
				</button>
			{/if}
			{#if canManageTargetGroup && manageableGroups.length > 0}
				<select
					class="select select-bordered select-xs w-full"
					value={selectedGroupSlug}
					onchange={handleGroupChange}
					disabled={groupSaving}
				>
					{#each manageableGroups as group (group.slug)}
						<option value={group.slug}>{group.title}</option>
					{/each}
				</select>
			{/if}
			{#if canPromoteToAdmin}
				<button
					onclick={promoteToAdmin}
					disabled={groupSaving}
					class="btn btn-xs btn-outline btn-warning w-full text-center"
				>
					{t.permissions.promoteToAdmin}
				</button>
			{/if}
			{#if feedback}
				<p class="text-xs {feedback.type === 'success' ? 'text-primary' : 'text-warning'}">
					{feedback.text}
				</p>
			{/if}
		</li>
	{/if}
{/snippet}

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
				{@render adminControls()}
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
				{@render adminControls()}
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

{#if showResetConfirm}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{t.auth.resetLinkModalTitle}</h3>
			<p class="py-2 text-sm text-base-content/80">{t.auth.confirmGenerateResetLink}</p>
			<div class="modal-action gap-2">
				<button class="btn btn-sm btn-primary" onclick={generateResetLink}>
					{t.common.confirm}
				</button>
				<button class="btn btn-sm btn-ghost" onclick={() => (showResetConfirm = false)}>
					{t.common.cancel}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showResetLink}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">{t.auth.resetLinkModalTitle}</h3>
			<p class="py-2 text-sm text-base-content/80">{resetGuidance}</p>
			<p
				class="py-3 text-sm break-all select-all whitespace-pre-line border border-dashed border-base-300 p-2 rounded bg-base-200"
			>
				{resetCopyText}
			</p>
			<div class="modal-action gap-2">
				<button class="btn btn-sm btn-primary" onclick={copyLink}>
					{t.auth.copyResetLink}
				</button>
				<button class="btn btn-sm btn-ghost" onclick={() => (showResetLink = false)}>
					{t.common.cancel}
				</button>
			</div>
		</div>
	</div>
{/if}
