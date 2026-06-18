<script lang="ts">
	/**
	 * OfflinePlaceholder Molecule - the shared "you are offline" stand-in for
	 * server-dependent UI that has no cached fallback (admin tables, composer
	 * entry points, search). Wraps EmptyState with the offline cloud icon and the
	 * canonical offline message so every surface reads the same.
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { mdiCloudOffOutline } from '@mdi/js';
	import type { TranslationDict } from '$lib/types/translation';

	interface OfflinePlaceholderProps {
		t: TranslationDict;
		bordered?: boolean;
	}

	let { t, bordered = true }: OfflinePlaceholderProps = $props();
</script>

<EmptyState message={t.offline.disabled.title} {bordered} icon={mdiCloudOffOutline} />
