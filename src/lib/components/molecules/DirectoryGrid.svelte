<script lang="ts">
	/**
	 * DirectoryGrid Molecule - A reusable, responsive layout for list/directory pages.
	 * Displays groups of links with icons.
	 * On Mobile: Left-aligned icon, right-aligned text with chevrons.
	 * On Desktop: Grid of cards with top icon and centered text.
	 */
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiChevronRight } from '@mdi/js';

	export interface DirectoryItem {
		label: string;
		href: string;
		icon: string;
		description?: string;
	}

	export interface DirectoryGroup {
		title: string;
		items: DirectoryItem[];
	}

	interface DirectoryGridProps {
		groups: DirectoryGroup[];
	}

	let { groups }: DirectoryGridProps = $props();
</script>

<div class="space-y-8">
	{#each groups as group}
		<div class="space-y-3">
			<h2 class="text-xs font-bold uppercase tracking-wider text-base-content/40 px-1">
				{group.title}
			</h2>

			<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
				{#each group.items as item}
					<a
						href={item.href}
						class="flex items-center gap-3.5 p-4 rounded-xl border border-base-300 bg-base-100 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md active:scale-[0.99] hover:scale-[1.01] transform transition-all duration-200 ease-out group md:flex-col md:items-center md:justify-center md:text-center md:py-6 md:px-4"
					>
						<!-- Icon Container -->
						<div
							class="flex items-center justify-center w-10 h-10 rounded-xl bg-base-200 text-base-content/70 group-hover:bg-primary group-hover:text-primary-content transition-all duration-200 ease-out md:w-12 md:h-12 md:mb-2"
						>
							<Icon path={item.icon} size={22} />
						</div>

						<!-- Label & Description -->
						<div class="flex-1 min-w-0 md:flex-initial">
							<div
								class="font-semibold text-base-content group-hover:text-primary transition-colors duration-200 truncate md:text-sm"
							>
								{item.label}
							</div>
							{#if item.description}
								<div class="text-xs text-base-content/50 mt-0.5 line-clamp-1 md:hidden">
									{item.description}
								</div>
							{/if}
						</div>

						<!-- Mobile Arrow -->
						<div
							class="text-base-content/30 group-hover:text-primary transition-all duration-200 ease-out md:hidden"
						>
							<Icon path={mdiChevronRight} size={18} />
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/each}
</div>
