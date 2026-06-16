<script lang="ts">
	/**
	 * AdminSidebar Molecule - Navigation for the /admin area.
	 * Mirrors SettingsSidebar: UserInfoBlock + a menu of nav items.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface AdminSidebarProps {
		user: UserInfoSummary;
		t: TranslationDict;
		activeItem?: string;
	}

	let { user, t, activeItem = '' }: AdminSidebarProps = $props();

	const adminT = $derived(t.admin);
</script>

<div class="space-y-4">
	<UserInfoBlock {user} {t} />
	<ul class="menu menu-sm w-full gap-1">
		<li>
			<a href="/admin/user-groups" class={activeItem === 'userGroups' ? 'active' : ''}>
				{adminT['userGroups']}
			</a>
		</li>
		<li>
			<a href="/admin/categories" class={activeItem === 'categories' ? 'active' : ''}>
				{adminT['categories']}
			</a>
		</li>
		<li>
			<a href="/admin/permissions" class={activeItem === 'categoryPermissions' ? 'active' : ''}>
				{adminT['categoryPermissions']}
			</a>
		</li>
	</ul>
</div>
