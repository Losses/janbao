<script lang="ts">
	/**
	 * Date Atom - Renders a human-friendly relative date (e.g. "3 minutes ago").
	 * Hovering displays the exact browser-localized date and time via native `title` attribute.
	 * Accepts a `t` translation dictionary to support i18n relative time strings.
	 */
	interface DateProps {
		value: Date | string | number;
		/** Translation dictionary (from locals.t). Falls back to English if not provided. */
		t?: Record<string, Record<string, string> | string> | null;
		class?: string;
	}

	let { value, t = null, class: className = '' }: DateProps = $props();

	const dateObj = $derived(new Date(value));
	const isValid = $derived(!isNaN(dateObj.getTime()));

	const tDate = $derived((t as Record<string, Record<string, string>> | null)?.date ?? {});

	const absoluteString = $derived(
		isValid
			? dateObj.toLocaleString(undefined, {
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit'
				})
			: ''
	);

	// Helper: build relative string using i18n keys with number prefix, degrading gracefully to English
	function rel(n: number, singularKey: string, pluralKey: string): string {
		const template = n === 1 ? tDate[singularKey] : tDate[pluralKey];
		if (template) {
			return `${n} ${template}`;
		}
		// Fallback to English if translation is missing:
		const unitMap: Record<string, string> = {
			yearAgo: 'year ago',
			yearsAgo: 'years ago',
			monthAgo: 'month ago',
			monthsAgo: 'months ago',
			dayAgo: 'day ago',
			daysAgo: 'days ago',
			hourAgo: 'hour ago',
			hoursAgo: 'hours ago',
			minuteAgo: 'minute ago',
			minutesAgo: 'minutes ago'
		};
		const key = n === 1 ? singularKey : pluralKey;
		const unit = unitMap[key] ?? key;
		return `${n} ${unit}`;
	}

	// Compute relative time string
	const relativeString = $derived.by(() => {
		if (!isValid) return '';

		const now = Date.now();
		const then = dateObj.getTime();
		const diffMs = now - then;

		// Handle future dates (client clock skew) as "just now"
		if (diffMs < 0) return tDate['justNow'] ?? 'just now';

		const seconds = Math.floor(diffMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const months = Math.floor(days / 30);
		const years = Math.floor(days / 365);

		if (years > 0) return rel(years, 'yearAgo', 'yearsAgo');
		if (months > 0) return rel(months, 'monthAgo', 'monthsAgo');
		if (days > 0) return rel(days, 'dayAgo', 'daysAgo');
		if (hours > 0) return rel(hours, 'hourAgo', 'hoursAgo');
		if (minutes > 0) return rel(minutes, 'minuteAgo', 'minutesAgo');
		return tDate['justNow'] ?? 'just now';
	});
</script>

{#if isValid}
	<time
		datetime={dateObj.toISOString()}
		title={absoluteString}
		class="text-sm text-base-content/60 {className}"
	>
		{relativeString}
	</time>
{:else}
	<span class="text-sm text-base-content/40 {className}">-</span>
{/if}
