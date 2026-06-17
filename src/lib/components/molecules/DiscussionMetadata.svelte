<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { getContext } from 'svelte';

	/**
	 * DiscussionMetadata Molecule - Displays a unified header for threads and replies.
	 * Layout: Left is Avatar; right is a vertical stack:
	 *   - Top: User Display Name (links to /profile/:userId/:userSlug)
	 *   - Bottom: Relative date (via Date component), last edited indicator.
	 */
	import type { TranslationDict, LocaleGetter } from '$lib/types/translation';

	interface DiscussionMetadataProps {
		userId: number;
		username: string;
		displayName: string;
		avatarFileId?: string | null;
		createdAt: string | number | Date;
		/** When the body was last edited (null/absent = never edited). */
		editedAt?: string | number | Date | null;
		/** Display name of the user who last edited (may differ from the author). */
		editedByDisplayName?: string | null;
		/** Translation dictionary */
		t: TranslationDict;
		class?: string;
	}

	let {
		userId,
		username,
		displayName,
		avatarFileId = null,
		createdAt,
		editedAt = null,
		editedByDisplayName = null,
		t,
		class: className = ''
	}: DiscussionMetadataProps = $props();

	/** App locale ('en' | 'zh-CN') published by the root layout via context. */
	const getLang = getContext<LocaleGetter>('app:lang');

	const userSlug = $derived(generateSlug(username || displayName || 'user'));

	// "Last edited" label shown before the edit timestamp.
	const lastEditedLabel = $derived(t.common.lastEdited);

	// Single unified tooltip for the whole "last edited" marker: the editor
	// (if known) plus the absolute edit timestamp. Applied to both the wrapper
	// span and the <time> element so hovering any part shows the same full
	// text instead of two fragmentary titles.
	const editFullTitle = $derived.by(() => {
		if (!editedAt) return undefined;
		const d = new Date(editedAt);
		if (isNaN(d.getTime())) return undefined;
		const abs = d.toLocaleString(getLang?.() ?? undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		if (editedByDisplayName) {
			return t.common.editedFull.replace('{name}', editedByDisplayName).replace('{time}', abs);
		}
		return abs;
	});
</script>

<div class="flex items-center gap-3 {className}">
	<a href="/profile/{userId}/{userSlug}" class="flex-shrink-0">
		<Avatar {userId} {avatarFileId} {displayName} size="sm" />
	</a>
	<div class="flex flex-col min-w-0">
		<div class="flex items-center gap-1.5 flex-wrap">
			<a
				href="/profile/{userId}/{userSlug}"
				class="font-semibold text-sm hover:underline truncate text-base-content"
			>
				{displayName}
			</a>
		</div>
		<div class="flex items-center gap-2 text-xs text-base-content/50 flex-wrap">
			<DateAtom value={createdAt} {t} />

			{#if editedAt}
				<span class="inline-flex items-center gap-1" title={editFullTitle}>
					<span class="text-base-content/40">{lastEditedLabel}</span>
					<DateAtom value={editedAt} {t} title={editFullTitle} />
				</span>
			{/if}
		</div>
	</div>
</div>
