<script lang="ts">
	/**
	 * Date Atom - Renders a human-friendly relative date (e.g. "3 minutes ago").
	 * Hovering displays the exact date and time via the native `title` attribute,
	 * formatted in the app locale (read from the 'app:lang' context set by the
	 * root layout). Accepts a `t` translation dictionary for i18n relative time.
	 */
	import { getContext } from 'svelte';
	import type { TranslationDict, LocaleGetter } from '$lib/types/translation';

	interface DateProps {
		value: Date | string | number;
		/** Translation dictionary (from locals.t). */
		t: TranslationDict;
		class?: string;
		/** Override the default hover title (the absolute timestamp). */
		title?: string;
	}

	let { value, t, class: className = '', title: customTitle }: DateProps = $props();

	/** App locale ('en' | 'zh-CN') published by the root layout via context. */
	const getLang = getContext<LocaleGetter>('app:lang');

	const dateObj = $derived(new Date(value));
	const isValid = $derived(!isNaN(dateObj.getTime()));

	const tDate = $derived(t.date as Record<string, string>);

	const absoluteString = $derived(
		isValid
			? dateObj.toLocaleString(getLang?.() ?? undefined, {
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit'
				})
			: ''
	);

	// Build a relative time string from the i18n date templates (e.g. "3 minutes ago").
	function rel(n: number, singularKey: string, pluralKey: string): string {
		const template = n === 1 ? tDate[singularKey] : tDate[pluralKey];
		return `${n} ${template}`;
	}

	// Compute relative time string (supports both past and future)
	const relativeString = $derived.by(() => {
		if (!isValid) return '';

		const now = Date.now();
		const then = dateObj.getTime();
		const diffMs = now - then;

		if (diffMs >= 0) {
			// Past dates
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
			return t.date.justNow;
		} else {
			// Future dates
			const absDiff = Math.abs(diffMs);
			const seconds = Math.floor(absDiff / 1000);
			const minutes = Math.floor(seconds / 60);
			const hours = Math.floor(minutes / 60);
			const days = Math.floor(hours / 24);
			const months = Math.floor(days / 30);
			const years = Math.floor(days / 365);

			if (years > 0) return rel(years, 'yearLater', 'yearsLater');
			if (months > 0) return rel(months, 'monthLater', 'monthsLater');
			if (days > 0) return rel(days, 'dayLater', 'daysLater');
			if (hours > 0) return rel(hours, 'hourLater', 'hoursLater');
			if (minutes > 0) return rel(minutes, 'minuteLater', 'minutesLater');
			return t.date.justNow;
		}
	});
</script>

{#if isValid}
	<time
		datetime={dateObj.toISOString()}
		title={customTitle ?? absoluteString}
		class="text-xs text-base-content/60 {className}"
	>
		{relativeString}
	</time>
{:else}
	<span class="text-xs text-base-content/40 {className}">-</span>
{/if}
