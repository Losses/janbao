<script lang="ts">
	/**
	 * Paginator Atom - Minimalist page navigation using text-link style.
	 * Self-conditional rendering: renders nothing if totalPages <= 1.
	 */
	type PageChangeHandler = (page: number) => void;

	interface PaginatorProps {
		currentPage: number;
		totalPages: number;
		onPageChange: PageChangeHandler;
		/** Translation dictionary for i18n aria-labels */
		t?: Record<string, Record<string, string> | string> | null;
		class?: string;
	}

	let {
		currentPage,
		totalPages,
		onPageChange,
		t = null,
		class: className = ''
	}: PaginatorProps = $props();

	const tPagination = $derived(
		(t as Record<string, Record<string, string>> | null)?.pagination ?? {}
	);

	// Build page number list with ellipsis for large ranges
	const pageNumbers = $derived.by(() => {
		if (totalPages <= 7) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		const pages: (number | '...')[] = [];
		pages.push(1);

		if (currentPage > 3) {
			pages.push('...');
		}

		const start = Math.max(2, currentPage - 1);
		const end = Math.min(totalPages - 1, currentPage + 1);

		for (let i = start; i <= end; i++) {
			pages.push(i);
		}

		if (currentPage < totalPages - 2) {
			pages.push('...');
		}

		pages.push(totalPages);
		return pages;
	});

	function goTo(page: number) {
		if (page !== currentPage && page >= 1 && page <= totalPages) {
			onPageChange(page);
		}
	}
</script>

{#if totalPages > 1}
	<nav class="flex items-center gap-1 text-sm {className}" aria-label="Pagination">
		<!-- Previous button -->
		<button
			type="button"
			class="px-2 py-1 text-base-content/60 transition-colors duration-150 hover:text-base-content disabled:opacity-30"
			disabled={currentPage <= 1}
			onclick={() => goTo(currentPage - 1)}
			aria-label={tPagination['previous'] ?? 'Previous page'}
		>
			‹
		</button>

		{#each pageNumbers as page, i (i)}
			{#if page === '...'}
				<span class="px-1 text-base-content/40">…</span>
			{:else}
				<button
					type="button"
					class="px-2 py-1 transition-colors duration-150 {page === currentPage
						? 'font-bold text-primary'
						: 'text-base-content/60 hover:text-base-content'}"
					onclick={() => goTo(page)}
					aria-current={page === currentPage ? 'page' : undefined}
				>
					{page}
				</button>
			{/if}
		{/each}

		<!-- Next button -->
		<button
			type="button"
			class="px-2 py-1 text-base-content/60 transition-colors duration-150 hover:text-base-content disabled:opacity-30"
			disabled={currentPage >= totalPages}
			onclick={() => goTo(currentPage + 1)}
			aria-label={tPagination['next'] ?? 'Next page'}
		>
			›
		</button>
	</nav>
{/if}
