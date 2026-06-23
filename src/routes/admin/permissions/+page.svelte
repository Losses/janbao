<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type {
		AdminCategoryItem,
		AdminCategoryPermissionItem,
		AdminManageableGroupItem,
		ApiResult,
		FeedbackMessage
	} from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	interface PermissionFlags {
		canRead: boolean;
		canCreate: boolean;
		canUpdate: boolean;
		canDelete: boolean;
	}

	/** Shape of GET /api/admin/category-permissions. */
	interface CategoryPermissionsResponse {
		groups: AdminManageableGroupItem[];
		categories: AdminCategoryItem[];
		categoryPermissions: AdminCategoryPermissionItem[];
	}

	// Skeleton row placeholders - count/widths mirror the loaded table so the
	// skeleton-to-content swap doesn't reflow (tuned via MCP measurement).
	const SKELETON_ROWS = [0, 1, 2] as const;

	let { data }: PageProps = $props();
	const online = getOnlineStore();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const permissionsT = $derived(t.permissions);
	const user = $derived(data.user);

	let loaded = $state(false);
	let groups = $state<AdminManageableGroupItem[]>([]);
	let categories = $state<AdminCategoryItem[]>([]);
	let categoryPermissions = $state<AdminCategoryPermissionItem[]>([]);
	const enabledCategories = $derived(categories.filter((category) => category.disabledAt === null));

	let selectedGroupSlug = $state('');
	let overrideGroupSlug = $state<string | null>(null);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);
	let permissionDraft = $state<Record<string, PermissionFlags>>({});
	// Categories the admin has actually touched since the last save/load. Only these
	// are sent on save, so toggling one checkbox can't silently reset every other
	// category for the group to its draft default.
	let dirtyCategories = $state<string[]>([]);

	const activeGroupSlug = $derived(overrideGroupSlug || selectedGroupSlug || groups[0]?.slug || '');
	const hasDirty = $derived(dirtyCategories.length > 0);

	async function reload() {
		try {
			const res = await fetch('/api/admin/category-permissions');
			if (res.ok) {
				const result = (await res.json()) as CategoryPermissionsResponse;
				groups = result.groups;
				categories = result.categories;
				categoryPermissions = result.categoryPermissions;
			} else {
				message = { type: 'error', text: t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}
		loaded = true;
	}

	onMount(() => {
		void reload();
	});

	$effect(() => {
		if (
			!overrideGroupSlug &&
			groups.length > 0 &&
			!groups.some((group) => group.slug === selectedGroupSlug)
		) {
			selectedGroupSlug = groups[0].slug;
		}
	});

	$effect(() => {
		if (!activeGroupSlug) {
			permissionDraft = {};
			dirtyCategories = [];
			return;
		}
		const nextDraft: Record<string, PermissionFlags> = {};
		for (const category of enabledCategories) {
			const explicit = categoryPermissions.find(
				(permission) =>
					permission.groupSlug === activeGroupSlug && permission.categorySlug === category.slug
			);
			nextDraft[category.slug] = explicit
				? {
						canRead: explicit.canRead,
						canCreate: explicit.canCreate,
						canUpdate: explicit.canUpdate,
						canDelete: explicit.canDelete
					}
				: defaultPermissions(activeGroupSlug);
		}
		permissionDraft = nextDraft;
		// Rebuilding the draft means we just (re)loaded from the server - clear dirty.
		dirtyCategories = [];
	});

	function defaultPermissions(slug: string): PermissionFlags {
		if (slug === 'moderator')
			return { canRead: true, canCreate: true, canUpdate: true, canDelete: true };
		if (slug === 'member')
			return { canRead: true, canCreate: true, canUpdate: false, canDelete: false };
		return { canRead: true, canCreate: false, canUpdate: false, canDelete: false };
	}

	function setPermission(category: string, key: keyof PermissionFlags, value: boolean) {
		permissionDraft = {
			...permissionDraft,
			[category]: { ...permissionDraft[category], [key]: value }
		};
		dirtyCategories = dirtyCategories.includes(category)
			? dirtyCategories
			: [...dirtyCategories, category];
	}

	async function savePermissions() {
		if (!activeGroupSlug || !hasDirty) return;
		saving = true;
		message = null;
		try {
			// Only send categories the admin actually changed. Sending every enabled
			// category would overwrite untouched rows with their (possibly default)
			// draft values - a silent mass-lockout.
			const permissions: AdminCategoryPermissionItem[] = enabledCategories
				.filter((category) => dirtyCategories.includes(category.slug))
				.map((category) => ({
					categorySlug: category.slug,
					groupSlug: activeGroupSlug,
					canRead: permissionDraft[category.slug]?.canRead ?? false,
					canCreate: permissionDraft[category.slug]?.canCreate ?? false,
					canUpdate: permissionDraft[category.slug]?.canUpdate ?? false,
					canDelete: permissionDraft[category.slug]?.canDelete ?? false
				}));
			const res = await fetch('/api/admin/category-permissions', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ permissions })
			});
			const result = (await res.json()) as ApiResult;
			if (result.success) {
				message = { type: 'success', text: permissionsT.permissionsSaved };
				overrideGroupSlug = null;
				dirtyCategories = [];
				await reload();
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}
		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(adminT.categoryPermissions)}</title>
</svelte:head>

{#snippet sidebar()}
	<AdminSidebar {user} {t} activeItem="categoryPermissions" />
{/snippet}

{#snippet leftPanel()}
	{#if user}
		<AdminMenuPanel {user} {t} lang={data.lang} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref="/admin" fallbackRoute="/admin">
		<div class="space-y-3">
			<div class="border-b border-base-300 pb-4">
				<h1 class="page-title">{adminT.categoryPermissions}</h1>
			</div>

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<div class="space-y-3">
				{#if !loaded}
					<div class="skeleton h-8 w-full max-w-xs"></div>
				{:else}
					<select
						class="select select-bordered select-sm w-full max-w-xs"
						value={activeGroupSlug}
						onchange={(e) => (overrideGroupSlug = (e.currentTarget as HTMLSelectElement).value)}
					>
						{#each groups as group (group.slug)}
							<option value={group.slug}>{group.title}</option>
						{/each}
					</select>
				{/if}

				{#if !loaded}
					<div class="overflow-x-auto">
						<table class="table table-fixed table-sm [&_tr]:border-base-300">
							<colgroup>
								<col class="w-[40%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
							</colgroup>
							<thead>
								<tr>
									<th>{permissionsT.category}</th>
									<th>{permissionsT.canRead}</th>
									<th>{permissionsT.canCreate}</th>
									<th>{permissionsT.canUpdate}</th>
									<th>{permissionsT.canDelete}</th>
								</tr>
							</thead>
							<tbody>
								{#each SKELETON_ROWS as i (i)}
									<tr>
										<td>
											<div class="skeleton h-4 w-32"></div>
											<div class="skeleton h-3 w-20 mt-2"></div>
										</td>
										{#each [0, 1, 2, 3] as j (j)}
											<td><div class="skeleton h-5 w-5 rounded"></div></td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else if online.online}
					<div class="overflow-x-auto">
						<table class="table table-fixed table-sm [&_tr]:border-base-300">
							<colgroup>
								<col class="w-[40%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
								<col class="w-[15%]" />
							</colgroup>
							<thead>
								<tr>
									<th>{permissionsT.category}</th>
									<th>{permissionsT.canRead}</th>
									<th>{permissionsT.canCreate}</th>
									<th>{permissionsT.canUpdate}</th>
									<th>{permissionsT.canDelete}</th>
								</tr>
							</thead>
							<tbody>
								{#each enabledCategories as category (category.slug)}
									<tr>
										<td>
											<div class="font-medium">{category.title}</div>
											<div class="font-mono text-xs text-base-content/50">{category.slug}</div>
										</td>
										<td>
											<input
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												checked={permissionDraft[category.slug]?.canRead}
												onchange={(e) =>
													setPermission(category.slug, 'canRead', e.currentTarget.checked)}
											/>
										</td>
										<td>
											<input
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												checked={permissionDraft[category.slug]?.canCreate}
												onchange={(e) =>
													setPermission(category.slug, 'canCreate', e.currentTarget.checked)}
											/>
										</td>
										<td>
											<input
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												checked={permissionDraft[category.slug]?.canUpdate}
												onchange={(e) =>
													setPermission(category.slug, 'canUpdate', e.currentTarget.checked)}
											/>
										</td>
										<td>
											<input
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												checked={permissionDraft[category.slug]?.canDelete}
												onchange={(e) =>
													setPermission(category.slug, 'canDelete', e.currentTarget.checked)}
											/>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<OfflinePlaceholder {t} />
				{/if}

				{#if loaded && online.online}
					<button
						class="btn btn-primary btn-sm"
						onclick={savePermissions}
						disabled={saving || !activeGroupSlug || !hasDirty}
					>
						{saving ? t.common.saving : permissionsT.savePermissions}
					</button>
				{/if}
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
