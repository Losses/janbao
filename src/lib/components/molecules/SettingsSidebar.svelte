<script lang="ts">
	/**
	 * SettingsSidebar Molecule - Navigation sidebar for account settings pages.
	 * Shows settings-specific navigation links.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface SettingsSidebarProps {
		user: UserInfoSummary;
		t: TranslationDict;
		activeItem?: string;
	}

	let { user, t, activeItem = '' }: SettingsSidebarProps = $props();

	const profileT = $derived(t.profile);

	const userSlug = $derived(generateSlug(user.username));
</script>

<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
	<UserInfoBlock {user} {t} />
	<ul class="menu menu-sm w-full gap-1">
		<li>
			<a href="/profile/edit" class={activeItem === 'editAccount' ? 'active' : ''}>
				{profileT['editAccount']}
			</a>
		</li>
		<li>
			<a href="/profile/password" class={activeItem === 'changePassword' ? 'active' : ''}>
				{profileT['changePassword']}
			</a>
		</li>
		<li>
			<a href="/profile/preferences" class={activeItem === 'preferences' ? 'active' : ''}>
				{profileT['preferences']}
			</a>
		</li>
		<li>
			<a href="/profile/picture" class={activeItem === 'avatar' ? 'active' : ''}>
				{profileT['avatar']}
			</a>
		</li>
		<li>
			<a href="/profile/onlineNow" class={activeItem === 'stealthSettings' ? 'active' : ''}>
				{profileT['stealthSettings']}
			</a>
		</li>
	</ul>
</div>
