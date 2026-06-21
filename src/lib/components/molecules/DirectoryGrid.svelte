<script lang="ts">
	/**
	 * DirectoryGrid Molecule - A reusable list of grouped navigation links.
	 * Follows the flat list design language: no rounded corners, no shadows,
	 * rows separated by horizontal divider lines (divide-y on border-base-300).
	 * Each row is an icon + label + chevron; destructive items use the error tone.
	 */
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiChevronRight } from '@mdi/js';

	type DirectoryItemTone = 'error';

	export interface DirectoryItem {
		label: string;
		href: string;
		icon: string;
		/** Destructive accent (e.g. sign out): error-colored icon, label, and chevron. */
		tone?: DirectoryItemTone;
	}

	export interface DirectoryGroup {
		title: string;
		items: DirectoryItem[];
	}

	interface DirectoryGridProps {
		groups: DirectoryGroup[];
	}

	interface DirectoryRowToneClasses {
		icon: string;
		label: string;
		chevron: string;
	}

	let { groups }: DirectoryGridProps = $props();

	function directoryRowToneClasses(tone: DirectoryItemTone | undefined): DirectoryRowToneClasses {
		if (tone === 'error') {
			return {
				icon: 'text-error/80 group-hover:text-error',
				label: 'text-error group-hover:text-error',
				chevron: 'text-error/40 group-hover:text-error'
			};
		}
		return {
			icon: 'text-base-content/70 group-hover:text-primary',
			label: 'text-base-content group-hover:text-primary',
			chevron: 'text-base-content/30 group-hover:text-primary'
		};
	}
</script>

<div class="space-y-6">
	{#each groups as group (group.title)}
		<div class="space-y-3">
			<h2 class="px-1 text-xs font-bold uppercase tracking-wider text-base-content/40">
				{group.title}
			</h2>

			<div class="overflow-hidden border-y border-base-300 bg-base-100">
				<div class="divide-y divide-base-300">
					{#each group.items as item (item.href)}
						{@const toneClasses = directoryRowToneClasses(item.tone)}
						<a
							href={item.href}
							class="group flex items-center gap-3.5 p-4 transition-colors hover:bg-base-200/20"
						>
							<Icon path={item.icon} size={22} class={toneClasses.icon} />
							<span class="min-w-0 flex-1 truncate font-semibold {toneClasses.label}">
								{item.label}
							</span>
							<Icon path={mdiChevronRight} size={18} class={toneClasses.chevron} />
						</a>
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>
