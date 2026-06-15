<script lang="ts">
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiAccountPlus } from '@mdi/js';
	import { generateSlug } from '$lib/utils/slug';
	import type { JoinedMember } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface JoinedActivityRowProps {
		createdAt: Date;
		members: JoinedMember[];
		locale: string;
		t: TranslationDict;
	}

	let { createdAt, members, locale, t }: JoinedActivityRowProps = $props();

	// Language-specific list connectors.
	function connectors(count: number, loc: string): string[] {
		// Returns the separator BEFORE each name (index 0 = none).
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			if (i === 0) out.push('');
			else if (loc.startsWith('zh')) out.push(i === count - 1 ? '和' : '、');
			else out.push(i === count - 1 ? ' and ' : ', ');
		}
		return out;
	}

	const seps = $derived(connectors(members.length, locale));
	// "joined" verb tail (English "joined", Chinese "加入了").
	const joinedVerb = $derived(locale.startsWith('zh') ? ' 加入了' : ' joined');
	// Excerpt line ("欢迎加入!" / "Welcome!").
	const welcomeLine = $derived((t.activity as { welcome?: string }).welcome ?? '');
</script>

<div class="py-4 border-b border-base-300 last:border-b-0">
	<div class="flex gap-3">
		<div class="flex-shrink-0">
			<div
				class="w-10 h-10 rounded-full bg-base-200 flex items-center justify-center text-base-content/50"
			>
				<Icon path={mdiAccountPlus} size={1} />
			</div>
		</div>
		<div class="flex-1 min-w-0">
			<!-- Row 1: "{u1} and {u2} joined." with clickable member names -->
			<div class="flex items-center gap-1 flex-wrap text-sm">
				{#each members as m, i (m.userId)}
					{#if seps[i]}<span class="text-base-content/60">{seps[i]}</span>{/if}
					<a
						href="/profile/{m.userId}/{generateSlug(m.username)}"
						class="font-semibold text-base-content hover:text-primary transition-colors"
					>
						{m.displayName || m.username || `user-${m.userId}`}
					</a>
				{/each}
				<span class="text-base-content/70">{joinedVerb}</span>
			</div>

			<!-- Row 2: excerpt -->
			{#if welcomeLine}
				<div class="mt-1 text-base-content/80">
					{welcomeLine}
				</div>
			{/if}

			<!-- Row 3: timestamp -->
			<div class="flex justify-end items-center gap-2 mt-2">
				<div class="flex-1 text-sm text-base-content/50">
					<DateComponent value={createdAt} {t} class="text-sm" />
				</div>
			</div>
		</div>
	</div>
</div>
