<script lang="ts">
	/**
	 * Date Atom — Renders a human-friendly relative date (e.g. "3 minutes ago").
	 * Hovering displays the exact browser-localized date and time via native `title` attribute.
	 */
	interface DateProps {
		value: Date | string | number;
		class?: string;
	}

	let { value, class: className = '' }: DateProps = $props();

	const dateObj = $derived(new Date(value));

	const absoluteString = $derived(
		dateObj.toLocaleString(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
	);

	// Compute relative time string
	const relativeString = $derived.by(() => {
		const now = Date.now();
		const then = dateObj.getTime();
		const diffMs = now - then;

		if (diffMs < 0) return formatFuture(diffMs);

		const seconds = Math.floor(diffMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const months = Math.floor(days / 30);
		const years = Math.floor(days / 365);

		if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
		if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
		if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
		if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
		if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
		return 'just now';
	});

	function formatFuture(diffMs: number): string {
		const absDiff = Math.abs(diffMs);
		const seconds = Math.floor(absDiff / 1000);
		const minutes = Math.floor(seconds / 60);
		if (minutes > 0) return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
		return 'just now';
	}
</script>

<time
	datetime={dateObj.toISOString()}
	title={absoluteString}
	class="text-sm text-base-content/60 {className}"
>
	{relativeString}
</time>
