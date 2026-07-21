<script lang="ts">
	/**
	 * ProfileHeader Molecule - The shared user-info header for all profile pages
	 * (activities, discussions, comments). Shows avatar, display name, bio, and a
	 * statistics row (group, joined, last-active, views, invited-by, email).
	 *
	 * `email` is already server-gated: it is null unless the target opted into
	 * showEmail AND the viewer is logged in (guests never see it). When null the
	 * email row is not rendered. `showLastActive` is computed by the caller
	 * (!isStealth || isOwner || isAdmin) so stealth rules live in one place.
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import {
		mdiAccountGroup,
		mdiAccountPlusOutline,
		mdiCalendarClock,
		mdiClockOutline,
		mdiEmailOutline,
		mdiEyeOutline
	} from '@mdi/js';
	import type { ProfileHeaderUser, UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	type UserData = NonNullable<App.Locals['user']>;

	interface ProfileHeaderProps {
		targetUser: ProfileHeaderUser | UserData;
		invitedBy: UserInfoSummary | null;
		email: string | null;
		showLastActive: boolean;
		/** Show the "send message" action. Caller-gated (e.g. viewer is logged in,
		 *  not the profile owner, and the target is a real user). */
		canMessage?: boolean;
		t: TranslationDict;
	}

	import { formatDisplayName } from '$lib/utils/user';

	let {
		targetUser,
		invitedBy,
		email,
		showLastActive,
		canMessage = false,
		t
	}: ProfileHeaderProps = $props();

	const displayUser = $derived(formatDisplayName(targetUser.displayName, targetUser.id, t));
	const profileT = $derived(t.profile);
	const sendMessageLabel = $derived(t.sidebar.sendMessage);
</script>

<div>
	<div class="flex items-center gap-4">
		<Avatar avatarUrl={targetUser.avatarUrl} displayName={displayUser} size="lg" />
		<div>
			<h1 class="user-display-name text-base">{displayUser}</h1>
			{#if targetUser.bio}
				<p class="text-base-content/70 mt-1 whitespace-pre-line">{targetUser.bio}</p>
			{/if}
		</div>
		{#if canMessage}
			<a
				href="/messages/add/{targetUser.id}"
				class="btn btn-ghost btn-circle ml-auto"
				aria-label={sendMessageLabel}
				title={sendMessageLabel}
			>
				<Icon path={mdiEmailOutline} size={20} />
			</a>
		{/if}
	</div>

	<!-- User Statistics -->
	<div class="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-base-content/70">
		<div class="flex items-center gap-1.5">
			<Icon path={mdiAccountGroup} size={16} class="text-base-content/50" />
			<span class="font-medium text-base-content">{profileT.group}</span>
			<span>{targetUser.groupTitle}</span>
		</div>
		<div class="flex items-center gap-1.5">
			<Icon path={mdiCalendarClock} size={16} class="text-base-content/50" />
			<span class="font-medium text-base-content">{profileT.joined}</span>
			<span>
				<DateComponent value={targetUser.signupTime} {t} />
			</span>
		</div>
		{#if showLastActive}
			<div class="flex items-center gap-1.5">
				<Icon path={mdiClockOutline} size={16} class="text-base-content/50" />
				<span class="font-medium text-base-content">{profileT.lastActive}</span>
				<span>
					<DateComponent value={targetUser.lastActiveTime} {t} />
				</span>
			</div>
		{/if}
		<div class="flex items-center gap-1.5">
			<Icon path={mdiEyeOutline} size={16} class="text-base-content/50" />
			<span class="font-medium text-base-content">{profileT.views}</span>
			<span>{targetUser.viewCount}</span>
		</div>
		{#if invitedBy}
			<div class="flex items-center gap-1.5">
				<Icon path={mdiAccountPlusOutline} size={16} class="text-base-content/50" />
				<span class="font-medium text-base-content">{profileT.invitedBy}</span>
				<a href="/profile/{invitedBy.id}/{generateSlug(invitedBy.username)}" class="hover:underline"
					>{invitedBy.displayName}</a
				>
			</div>
		{/if}
		{#if email}
			<div class="flex items-center gap-1.5">
				<Icon path={mdiEmailOutline} size={16} class="text-base-content/50" />
				<span class="font-medium text-base-content">{profileT.email}</span>
				<a href="mailto:{email}" class="hover:underline break-all">{email}</a>
			</div>
		{/if}
	</div>
</div>
