<script lang="ts">
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiStar, mdiStarOutline } from '@mdi/js';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import type { TranslationDict } from '$lib/types/translation';

	/**
	 * BookmarkButton Atom - Star toggle that bookmarks a discussion.
	 * Reused by the discussion list rows and the discussion detail header.
	 *
	 * Offline behaviour: the star stays visible but is disabled, so cached
	 * offline reads still show the bookmarked state without attempting a
	 * server mutation that could not succeed.
	 */
	interface BookmarkButtonProps {
		discussionId: number;
		bookmarked: boolean;
		t: TranslationDict;
		size?: number;
		class?: string;
	}

	let {
		discussionId,
		bookmarked,
		t,
		size = 20,
		class: className = ''
	}: BookmarkButtonProps = $props();

	// A successful toggle is held as a local override of the load-time prop.
	// `current` re-derives from the prop when navigation/invalidate changes it,
	// so the star never goes stale across same-route navigations.
	let override = $state<boolean | null>(null);
	let loading = $state(false);

	const online = getOnlineStore();

	const current = $derived(override ?? bookmarked);

	async function toggle(event: Event) {
		event.preventDefault();
		event.stopPropagation();
		if (loading) return;
		if (!online.online) return;
		loading = true;
		const target = !current;
		override = target;
		try {
			if (target) {
				const res = await fetch('/api/bookmarks', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discussionId })
				});
				if (!res.ok) override = null;
			} else {
				const res = await fetch(`/api/bookmarks?discussionId=${discussionId}`, {
					method: 'DELETE'
				});
				if (!res.ok) override = null;
			}
		} catch (err) {
			override = null;
			console.error('Failed to toggle bookmark:', err);
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex-shrink-0 {className}">
	<button
		type="button"
		onclick={toggle}
		class="btn btn-ghost btn-circle btn-sm bookmark-btn {current
			? 'text-primary'
			: 'text-base-content/35 hover:text-primary'}"
		aria-label={t.bookmark.toggleAria}
		aria-pressed={current}
		disabled={loading || !online.online}
	>
		<Icon path={current ? mdiStar : mdiStarOutline} {size} />
	</button>
</div>
