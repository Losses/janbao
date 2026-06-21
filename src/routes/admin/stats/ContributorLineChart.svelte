<script lang="ts">
	import { SvelteDate } from 'svelte/reactivity';
	import type { ContributorTimelinePoint } from '$lib/server/db/dao/stats';

	interface Props {
		timeline: ContributorTimelinePoint[];
	}

	interface FoldedTimelinePoint {
		date: string;
		count: number;
		tooltipDate: string;
	}

	interface GroupMap {
		[key: string]: ContributorTimelinePoint[];
	}

	let { timeline }: Props = $props();

	// Fold the timeline to at most 60 points
	const foldedTimeline = $derived.by(() => {
		return foldTimelinePoints(timeline, 60);
	});

	const maxVal = $derived(Math.max(...foldedTimeline.map((item) => item.count), 1));
	const count = $derived(foldedTimeline.length);

	// Generate paths
	const areaPath = $derived.by(() => {
		if (count === 0) return '';
		if (count === 1) {
			const y = 100 - (foldedTimeline[0].count / maxVal) * 85;
			return `M0,100 L0,${y} L1000,${y} L1000,100 Z`;
		}
		const points = foldedTimeline.map((pt, idx) => {
			const x = (idx / (count - 1)) * 1000;
			const y = 100 - (pt.count / maxVal) * 85;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `M0,100 L${points.join(' L')} L1000,100 Z`;
	});

	const linePath = $derived.by(() => {
		if (count === 0) return '';
		if (count === 1) {
			const y = 100 - (foldedTimeline[0].count / maxVal) * 85;
			return `M0,${y} L1000,${y}`;
		}
		const points = foldedTimeline.map((pt, idx) => {
			const x = (idx / (count - 1)) * 1000;
			const y = 100 - (pt.count / maxVal) * 85;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `M0,${(100 - (foldedTimeline[0].count / maxVal) * 85).toFixed(1)} L${points.join(' L')}`;
	});

	// Hover state
	let hoveredIdx = $state<number | null>(null);

	function foldTimelinePoints(
		points: ContributorTimelinePoint[],
		maxPoints = 60
	): FoldedTimelinePoint[] {
		if (!points || points.length === 0) return [];

		// Detect input format
		const firstDate = points[0].date;
		let inputType: 'day' | 'month' | 'year' = 'year';
		if (firstDate.includes('-')) {
			const parts = firstDate.split('-');
			if (parts.length === 3) {
				inputType = 'day';
			} else if (parts.length === 2) {
				inputType = 'month';
			}
		}

		const N = points.length;
		if (N <= maxPoints) {
			// No folding needed
			return points.map((pt) => ({
				date: pt.date,
				count: pt.count,
				tooltipDate: pt.date
			}));
		}

		// Determine target group type
		let targetType: 'week' | 'month' | 'year';
		if (inputType === 'day') {
			const weeksCount = Math.ceil(N / 7);
			if (weeksCount <= maxPoints) {
				targetType = 'week';
			} else {
				const monthsCount = Math.ceil(N / 30);
				if (monthsCount <= maxPoints) {
					targetType = 'month';
				} else {
					targetType = 'year';
				}
			}
		} else if (inputType === 'month') {
			targetType = 'year';
		} else {
			targetType = 'year';
		}

		// Perform grouping
		if (targetType === 'week') {
			const groups: GroupMap = {};
			const groupOrder: string[] = [];

			for (const pt of points) {
				const d = new SvelteDate(pt.date + 'T00:00:00Z');
				const day = d.getUTCDay();
				const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
				const monday = new SvelteDate(d.setDate(diff));
				const weekKey = monday.toISOString().split('T')[0];

				if (!groups[weekKey]) {
					groups[weekKey] = [];
					groupOrder.push(weekKey);
				}
				groups[weekKey].push(pt);
			}

			return groupOrder.map((key) => {
				const pts = groups[key];
				const total = pts.reduce((sum, p) => sum + p.count, 0);
				return {
					date: key,
					count: total,
					tooltipDate: `${pts[0].date} ~ ${pts[pts.length - 1].date}`
				};
			});
		} else if (targetType === 'month') {
			const groups: GroupMap = {};
			const groupOrder: string[] = [];

			for (const pt of points) {
				const monthKey = pt.date.substring(0, 7);
				if (!groups[monthKey]) {
					groups[monthKey] = [];
					groupOrder.push(monthKey);
				}
				groups[monthKey].push(pt);
			}

			return groupOrder.map((key) => {
				const pts = groups[key];
				const total = pts.reduce((sum, p) => sum + p.count, 0);
				return {
					date: key,
					count: total,
					tooltipDate: `${key}`
				};
			});
		} else {
			const groups: GroupMap = {};
			const groupOrder: string[] = [];

			for (const pt of points) {
				const yearKey = pt.date.substring(0, 4);
				if (!groups[yearKey]) {
					groups[yearKey] = [];
					groupOrder.push(yearKey);
				}
				groups[yearKey].push(pt);
			}

			return groupOrder.map((key) => {
				const pts = groups[key];
				const total = pts.reduce((sum, p) => sum + p.count, 0);
				return {
					date: key,
					count: total,
					tooltipDate: `${key}`
				};
			});
		}
	}
</script>

<div class="relative w-full h-full flex items-end">
	{#if foldedTimeline.length > 0}
		<svg class="w-full h-12 overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none">
			<!-- Area path -->
			<path d={areaPath} class="fill-primary/10 transition-all duration-300" />
			<!-- Line path -->
			<path d={linePath} class="stroke-primary/60 stroke-2 fill-none transition-all duration-300" />

			<!-- Highlight circle for hovered point -->
			{#if hoveredIdx !== null && foldedTimeline[hoveredIdx]}
				{@const pt = foldedTimeline[hoveredIdx]}
				{@const cx = count === 1 ? 500 : (hoveredIdx / (count - 1)) * 1000}
				{@const cy = 100 - (pt.count / maxVal) * 85}
				<circle
					{cx}
					{cy}
					r="5"
					class="fill-primary stroke-white stroke-[2px] transition-all duration-100"
				/>
			{/if}
		</svg>

		<!-- Hover overlay columns (transparent bars to trigger hover easily) -->
		<div class="absolute inset-0 flex">
			{#each foldedTimeline as pt, idx (pt.date)}
				<div
					class="h-full flex-1 cursor-crosshair opacity-0"
					onmouseenter={() => {
						hoveredIdx = idx;
					}}
					onmouseleave={() => {
						hoveredIdx = null;
					}}
					role="presentation"
					data-date={pt.date}
				></div>
			{/each}
		</div>

		<!-- Tooltip details overlay -->
		{#if hoveredIdx !== null && foldedTimeline[hoveredIdx]}
			{@const pt = foldedTimeline[hoveredIdx]}
			{@const pct = count === 1 ? 50 : (hoveredIdx / (count - 1)) * 100}
			<div
				class="absolute bottom-full mb-1 bg-neutral text-neutral-content text-[10px] font-mono py-1 px-2 rounded-box z-30 pointer-events-none whitespace-nowrap transition-all duration-100"
				style="left: {pct}%; transform: translateX(-50%);"
			>
				<span class="font-semibold">{pt.tooltipDate}</span>: {pt.count}
			</div>
		{/if}
	{:else}
		<div class="flex h-full w-full items-center justify-center text-[10px] text-base-content/40">
			No contributions
		</div>
	{/if}
</div>
