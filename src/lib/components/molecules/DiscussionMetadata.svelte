<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import { generateSlug } from '$lib/utils/slug';

	/**
	 * DiscussionMetadata Molecule — Displays a unified header for threads and replies.
	 * Layout: Left is Avatar; right is a vertical stack:
	 *   - Top: User Display Name (links to /profile/:userId/:userSlug)
	 *   - Bottom: Relative date (via Date component), last edited indicator, and optional Category link.
	 */
	interface DiscussionMetadataProps {
		userId: string;
		username: string;
		displayName: string;
		avatarFileId?: string | null;
		createdAt: string | number | Date;
		updatedAt?: string | number | Date | null;
		categoryName?: string | null;
		categorySlug?: string | null;
		/** Translation dictionary */
		t?: Record<string, Record<string, string> | string> | null;
		class?: string;
	}

	let {
		userId,
		username,
		displayName,
		avatarFileId = null,
		createdAt,
		updatedAt = null,
		categoryName = null,
		categorySlug = null,
		t = null,
		class: className = ''
	}: DiscussionMetadataProps = $props();

	const userSlug = $derived(generateSlug(username || displayName || 'user'));
	const isEdited = $derived.by(() => {
		if (!updatedAt) return false;
		const created = new Date(createdAt).getTime();
		const updated = new Date(updatedAt).getTime();
		return updated - created > 1000; // Consider edited if > 1s difference
	});

	// Get translation for "edited" (falls back to "edited" or "已编辑")
	const editedText = $derived.by(() => {
		const common = (t as Record<string, Record<string, string>> | null)?.common ?? {};
		return common.edited ?? 'edited';
	});
</script>

<div class="flex items-center gap-3 {className}">
	<a href="/profile/{userId}/{userSlug}" class="flex-shrink-0">
		<Avatar src={avatarFileId ? `/img/${avatarFileId}` : null} {displayName} size="sm" />
	</a>

	<div class="flex flex-col min-w-0">
		<div class="flex items-center gap-1.5 flex-wrap">
			<a
				href="/profile/{userId}/{userSlug}"
				class="font-semibold text-sm hover:underline truncate text-base-content"
			>
				{displayName}
			</a>
			<span class="text-xs text-base-content/40 truncate">@{username}</span>
		</div>

		<div class="flex items-center gap-2 text-xs text-base-content/50 flex-wrap">
			<DateAtom value={createdAt} {t} />

			{#if isEdited}
				<span class="text-base-content/40">({editedText})</span>
			{/if}

			{#if categoryName && categorySlug}
				<span class="text-base-content/30">•</span>
				<a
					href="/category/{categorySlug}"
					class="badge badge-sm badge-outline hover:badge-primary transition-colors"
				>
					{categoryName}
				</a>
			{/if}
		</div>
	</div>
</div>
