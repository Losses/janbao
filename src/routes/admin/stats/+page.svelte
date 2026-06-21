<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { goto } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { PageData } from './$types';
	import type {
		Contributor,
		TimelineDataPoint,
		ContributorTimelinePoint
	} from '$lib/server/db/dao/stats';
	import type { IntervalBounds } from './+page.server';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const user = $derived(data.user);

	type YAccessorFn = (d: TimelineDataPoint) => number;
	interface ClientChartProps {
		timeline: TimelineDataPoint[];
		yAccessor: YAccessorFn;
	}
	let ClientChart = $state<Component<ClientChartProps> | null>(null);
	let mounted = $state(false);
	onMount(async () => {
		const module = await import('./ClientChart.svelte');
		ClientChart = module.default;
		mounted = true;
	});

	// Draggable brush states: left & right positions as percentage values (0 to 1)
	let left = $state(0);
	let right = $state(1);

	// svelte-ignore state_referenced_locally
	/* eslint-disable-next-line svelte/prefer-writable-derived */
	let contributors = $state<Contributor[]>(data.initialContributors);
	let loadingContributors = $state(false);

	let sliderEl = $state<HTMLDivElement | null>(null);
	let dragType = $state<'left' | 'right' | 'middle' | null>(null);
	let startX = 0;
	let startLeft = 0;
	let startRight = 0;

	// Reset local state when data changes (e.g. interval selector reload)
	$effect(() => {
		if (data.interval) {
			left = 0;
			right = 1;
		}
	});

	$effect(() => {
		contributors = data.initialContributors;
	});

	// Min width percentage of the selected range window (at least 3 data points)
	const minPercent = $derived(
		data.timeline.length > 0 ? Math.max(0.02, 3 / data.timeline.length) : 0.05
	);

	// Get active date keys currently enclosed in the [left, right] selection
	const activeTimelineRange = $derived.by(() => {
		if (data.timeline.length === 0) return [];
		const startIdx = Math.max(
			0,
			Math.min(data.timeline.length - 1, Math.round(left * (data.timeline.length - 1)))
		);
		const endIdx = Math.max(
			0,
			Math.min(data.timeline.length - 1, Math.round(right * (data.timeline.length - 1)))
		);
		return data.timeline.slice(startIdx, endIdx + 1);
	});

	const selectedRangeText = $derived.by(() => {
		if (activeTimelineRange.length === 0) return '';
		const startPoint = activeTimelineRange[0];
		const endPoint = activeTimelineRange[activeTimelineRange.length - 1];
		return `${startPoint.date} ~ ${endPoint.date}`;
	});

	let fetchTimeout: ReturnType<typeof setTimeout> | undefined;

	// Query top contributors from API for the selected range (debounced)
	function triggerContributorsFetch(l: number, r: number) {
		if (data.timeline.length === 0) return;

		const startIdx = Math.max(
			0,
			Math.min(data.timeline.length - 1, Math.round(l * (data.timeline.length - 1)))
		);
		const endIdx = Math.max(
			0,
			Math.min(data.timeline.length - 1, Math.round(r * (data.timeline.length - 1)))
		);

		const startPoint = data.timeline[startIdx];
		const endPoint = data.timeline[endIdx];

		const startBounds = getIntervalBounds(startPoint.date, data.interval);
		const endBounds = getIntervalBounds(endPoint.date, data.interval);

		clearTimeout(fetchTimeout);
		fetchTimeout = setTimeout(async () => {
			loadingContributors = true;
			try {
				const res = await fetch(
					`/api/admin/stats?interval=${data.interval}&start=${startBounds.start}&end=${endBounds.end}`
				);
				const json = (await res.json()) as { contributors: Contributor[] };
				if (json.contributors) {
					contributors = json.contributors;
				}
			} catch (e) {
				console.error(e);
			} finally {
				loadingContributors = false;
			}
		}, 250);
	}

	function getIntervalBounds(dateStr: string, interval: string): IntervalBounds {
		if (interval === 'day') {
			const start = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
			const end = Math.floor(Date.parse(dateStr + 'T23:59:59Z') / 1000);
			return { start, end };
		} else if (interval === 'month') {
			const [y, m] = dateStr.split('-').map(Number);
			const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
			const end = Math.floor(Date.UTC(y, m, 1) / 1000) - 1;
			return { start, end };
		} else {
			const y = Number(dateStr);
			const start = Math.floor(Date.UTC(y, 0, 1) / 1000);
			const end = Math.floor(Date.UTC(y + 1, 0, 1) / 1000) - 1;
			return { start, end };
		}
	}

	// Mouse Event Handlers
	function handleLeftMouseDown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragType = 'left';
		startX = e.clientX;
		startLeft = left;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleRightMouseDown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragType = 'right';
		startX = e.clientX;
		startRight = right;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMiddleMouseDown(e: MouseEvent) {
		e.preventDefault();
		dragType = 'middle';
		startX = e.clientX;
		startLeft = left;
		startRight = right;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(e: MouseEvent) {
		if (!sliderEl || !dragType) return;
		const rect = sliderEl.getBoundingClientRect();
		const dx = (e.clientX - startX) / rect.width;

		if (dragType === 'left') {
			left = Math.max(0, Math.min(startLeft + dx, right - minPercent));
		} else if (dragType === 'right') {
			right = Math.max(left + minPercent, Math.min(startRight + dx, 1));
		} else if (dragType === 'middle') {
			const span = startRight - startLeft;
			let newLeft = startLeft + dx;
			let newRight = startRight + dx;
			if (newLeft < 0) {
				newLeft = 0;
				newRight = span;
			} else if (newRight > 1) {
				newRight = 1;
				newLeft = 1 - span;
			}
			left = newLeft;
			right = newRight;
		}

		triggerContributorsFetch(left, right);
	}

	function handleMouseUp() {
		dragType = null;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	// Touch Event Handlers
	function handleLeftTouchStart(e: TouchEvent) {
		e.stopPropagation();
		if (e.touches.length !== 1) return;
		dragType = 'left';
		startX = e.touches[0].clientX;
		startLeft = left;
		window.addEventListener('touchmove', handleTouchMove, { passive: false });
		window.addEventListener('touchend', handleTouchEnd);
	}

	function handleRightTouchStart(e: TouchEvent) {
		e.stopPropagation();
		if (e.touches.length !== 1) return;
		dragType = 'right';
		startX = e.touches[0].clientX;
		startRight = right;
		window.addEventListener('touchmove', handleTouchMove, { passive: false });
		window.addEventListener('touchend', handleTouchEnd);
	}

	function handleMiddleTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		dragType = 'middle';
		startX = e.touches[0].clientX;
		startLeft = left;
		startRight = right;
		window.addEventListener('touchmove', handleTouchMove, { passive: false });
		window.addEventListener('touchend', handleTouchEnd);
	}

	function handleTouchMove(e: TouchEvent) {
		if (!sliderEl || !dragType || e.touches.length !== 1) return;
		e.preventDefault();
		const rect = sliderEl.getBoundingClientRect();
		const dx = (e.touches[0].clientX - startX) / rect.width;

		if (dragType === 'left') {
			left = Math.max(0, Math.min(startLeft + dx, right - minPercent));
		} else if (dragType === 'right') {
			right = Math.max(left + minPercent, Math.min(startRight + dx, 1));
		} else if (dragType === 'middle') {
			const span = startRight - startLeft;
			let newLeft = startLeft + dx;
			let newRight = startRight + dx;
			if (newLeft < 0) {
				newLeft = 0;
				newRight = span;
			} else if (newRight > 1) {
				newRight = 1;
				newLeft = 1 - span;
			}
			left = newLeft;
			right = newRight;
		}

		triggerContributorsFetch(left, right);
	}

	function handleTouchEnd() {
		dragType = null;
		window.removeEventListener('touchmove', handleTouchMove);
		window.removeEventListener('touchend', handleTouchEnd);
	}

	function downsampleTimeline(
		points: ContributorTimelinePoint[],
		maxPoints = 50
	): ContributorTimelinePoint[] {
		if (!points || points.length <= maxPoints) return points || [];

		const result: ContributorTimelinePoint[] = [];
		const bucketSize = points.length / maxPoints;

		for (let i = 0; i < maxPoints; i++) {
			const startIdx = Math.floor(i * bucketSize);
			const endIdx = Math.min(points.length, Math.floor((i + 1) * bucketSize));
			if (startIdx >= endIdx) continue;

			let sum = 0;
			for (let j = startIdx; j < endIdx; j++) {
				sum += points[j].count;
			}

			const midIdx = Math.floor((startIdx + endIdx) / 2);
			result.push({
				date: points[midIdx].date,
				count: sum
			});
		}
		return result;
	}

	function downsampleTimelinePoints(
		points: TimelineDataPoint[],
		maxPoints = 120
	): TimelineDataPoint[] {
		if (!points || points.length <= maxPoints) return points || [];

		const result: TimelineDataPoint[] = [];
		const bucketSize = points.length / maxPoints;

		for (let i = 0; i < maxPoints; i++) {
			const startIdx = Math.floor(i * bucketSize);
			const endIdx = Math.min(points.length, Math.floor((i + 1) * bucketSize));
			if (startIdx >= endIdx) continue;

			let discussions = 0;
			let replies = 0;
			for (let j = startIdx; j < endIdx; j++) {
				discussions += points[j].discussions;
				replies += points[j].replies;
			}

			const midIdx = Math.floor((startIdx + endIdx) / 2);
			result.push({
				date: points[midIdx].date,
				discussions: Math.round(discussions / (endIdx - startIdx)),
				replies: Math.round(replies / (endIdx - startIdx))
			});
		}
		return result;
	}

	function getContributorPath(c: Contributor): string {
		if (!c.timeline || c.timeline.length === 0) return '';
		const sampled = downsampleTimeline(c.timeline, 50);
		const maxVal = Math.max(...sampled.map((item) => item.count), 1);
		const timelineCount = sampled.length;
		if (timelineCount === 1) {
			const y = 100 - (sampled[0].count / maxVal) * 85;
			return `M0,100 L0,${y} L1000,${y} L1000,100 Z`;
		}
		const points = sampled.map((pt, idx) => {
			const x = (idx / (timelineCount - 1)) * 1000;
			const y = 100 - (pt.count / maxVal) * 85;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `M0,100 L${points.join(' L')} L1000,100 Z`;
	}

	function getContributorLinePath(c: Contributor): string {
		if (!c.timeline || c.timeline.length === 0) return '';
		const sampled = downsampleTimeline(c.timeline, 50);
		const maxVal = Math.max(...sampled.map((item) => item.count), 1);
		const timelineCount = sampled.length;
		if (timelineCount === 1) {
			const y = 100 - (sampled[0].count / maxVal) * 85;
			return `M0,${y} L1000,${y}`;
		}
		const points = sampled.map((pt, idx) => {
			const x = (idx / (timelineCount - 1)) * 1000;
			const y = 100 - (pt.count / maxVal) * 85;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `M0,${(100 - (sampled[0].count / maxVal) * 85).toFixed(1)} L${points.join(' L')}`;
	}

	const displayTimeline = $derived.by(() => {
		return downsampleTimelinePoints(data.timeline, 200);
	});

	const yAccessor = (d: TimelineDataPoint) => d.discussions + d.replies;
</script>

<svelte:head>
	<title>{formatTitle(adminT['stats'] || 'Stats')}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<AdminSidebar {user} {t} activeItem="stats" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<!-- Header and Dropdown Selection -->
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="page-title">{adminT['stats'] || 'Statistics'}</h1>

			<select
				class="select select-bordered select-sm w-fit"
				value={data.interval}
				aria-label={adminT['stats']}
				onchange={(e) => goto(`/admin/stats?interval=${e.currentTarget.value}`)}
			>
				<option value="year">{adminT['byYear']}</option>
				<option value="month">{adminT['byMonth']}</option>
				<option value="day">{adminT['byDay']}</option>
			</select>
		</div>

		<div class="card card-bordered border-base-300 bg-base-100 p-5 space-y-4">
			{#if selectedRangeText}
				<div class="flex justify-end">
					<span
						class="badge badge-sm badge-outline font-mono border-base-300 text-base-content/80 p-2"
					>
						{selectedRangeText}
					</span>
				</div>
			{/if}

			<!-- Main LayerCake Chart -->
			<div class="h-60 w-full relative">
				{#if mounted && ClientChart}
					{#if data.timeline && data.timeline.length > 0}
						<ClientChart timeline={displayTimeline} {yAccessor} />
					{:else}
						<div
							class="flex h-full w-full items-center justify-center text-sm text-base-content/50"
						>
							No data available
						</div>
					{/if}
				{:else}
					<div class="flex h-full w-full items-center justify-center text-sm text-base-content/50">
						<span class="loading loading-spinner loading-md"></span>
					</div>
				{/if}
			</div>

			<!-- Draggable Brush Range Selector Slider -->
			<div class="space-y-1">
				<div class="text-xs text-base-content/50 font-medium px-1">
					{adminT['dateRange'] || 'Drag handles or selection area to select time window'}
				</div>
				<div
					class="relative h-14 w-full bg-base-200 border border-base-300 rounded overflow-hidden select-none touch-none"
					bind:this={sliderEl}
				>
					<!-- Sparkline timeline background of total activities -->
					<svg
						class="absolute inset-0 w-full h-full pointer-events-none opacity-20"
						preserveAspectRatio="none"
					>
						{#if mounted && data.timeline && data.timeline.length > 0}
							{@const sampled = downsampleTimelinePoints(data.timeline, 120)}
							{@const maxVal = Math.max(...sampled.map((d) => d.discussions + d.replies), 1)}
							{@const count = sampled.length}
							{#each sampled as pt, idx (pt.date)}
								{@const w = 100 / count}
								{@const x = idx * w}
								{@const h = ((pt.discussions + pt.replies) / maxVal) * 80}
								{@const y = 100 - h}
								<rect
									x="{x}%"
									y="{y}%"
									width="calc({w}% - 0.5px)"
									height="{h}%"
									class="fill-base-content"
								/>
							{/each}
						{/if}
					</svg>

					<div
						class="absolute top-0 bottom-0 bg-primary/10 border-x border-primary cursor-grab active:cursor-grabbing flex items-center justify-between"
						style="left: {left * 100}%; right: {(1 - right) * 100}%"
						onmousedown={handleMiddleMouseDown}
						ontouchstart={handleMiddleTouchStart}
						role="slider"
						tabindex="0"
						aria-label="Selected range window"
						aria-valuenow={Math.round(left * 100)}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<!-- Left handle inside the block (GitHub style) -->
						<div
							class="absolute left-0 top-0 bottom-0 w-2.5 -ml-1.5 bg-neutral border border-neutral-content/20 rounded cursor-ew-resize flex items-center justify-center z-10"
							onmousedown={handleLeftMouseDown}
							ontouchstart={handleLeftTouchStart}
							role="button"
							aria-label="Left slider handle"
							tabindex="0"
						>
							<div class="w-[1px] h-3 bg-neutral-content/40"></div>
						</div>

						<!-- Right handle inside the block (GitHub style) -->
						<div
							class="absolute right-0 top-0 bottom-0 w-2.5 -mr-1.5 bg-neutral border border-neutral-content/20 rounded cursor-ew-resize flex items-center justify-center z-10"
							onmousedown={handleRightMouseDown}
							ontouchstart={handleRightTouchStart}
							role="button"
							aria-label="Right slider handle"
							tabindex="0"
						>
							<div class="w-[1px] h-3 bg-neutral-content/40"></div>
						</div>
					</div>
				</div>
			</div>

			<!-- Legend of stack colors -->
			<div
				class="flex items-center gap-4 text-xs font-medium text-base-content/70 pt-2 border-t border-base-200"
			>
				<div class="flex items-center gap-1.5">
					<div class="w-3 h-3 bg-primary/75 rounded-sm"></div>
					<span>{adminT['discussions'] || 'Discussions'}</span>
				</div>
				<div class="flex items-center gap-1.5">
					<div class="w-3 h-3 bg-secondary/75 rounded-sm"></div>
					<span>{adminT['replies'] || 'Replies'}</span>
				</div>
			</div>
		</div>

		<!-- Top Contributors Section (GitHub Contributors Style layout) -->
		<div class="space-y-4">
			{#if contributors && contributors.length > 0}
				<!-- Grid layout: 2 columns in larger screens -->
				<div
					class="grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200"
					class:opacity-50={loadingContributors}
				>
					{#each contributors as c (c.id)}
						{@const profileSlug = generateSlug(c.username)}
						<div
							class="card card-bordered border-base-300 bg-base-100 hover:bg-base-200/20 transition-colors rounded-none"
						>
							<div class="card-body p-4 gap-3">
								<!-- Contributor header detail -->
								<div class="flex items-center gap-3">
									<a href="/profile/{c.id}/{profileSlug}">
										<Avatar
											userId={c.id}
											avatarFileId={c.avatarFileId}
											displayName={c.displayName}
											size="md"
										/>
									</a>
									<div class="min-w-0 flex-1">
										<h3 class="font-bold text-sm text-base-content hover:text-primary truncate">
											<a href="/profile/{c.id}/{profileSlug}">{c.displayName}</a>
										</h3>
										<p class="text-xs text-base-content/50 font-mono truncate">
											@{c.username}
										</p>
									</div>
									<div class="text-right">
										<div class="text-sm font-semibold text-base-content font-mono">
											{c.totalCount}
											{adminT['contributions'] || 'Contributions'}
										</div>
										<div class="text-[10px] text-base-content/65 font-mono">
											{c.discussionsCount} P / {c.repliesCount} R
										</div>
									</div>
								</div>

								<!-- Mini SVG Timeline Chart representing their contributions over the selected range -->
								<div class="h-10 w-full mt-1 border-t border-base-200/50 pt-2 flex items-end">
									{#if mounted}
										{#if c.timeline && c.timeline.length > 0}
											{@const areaPath = getContributorPath(c)}
											{@const linePath = getContributorLinePath(c)}
											<svg
												class="w-full h-8 overflow-visible"
												viewBox="0 0 1000 100"
												preserveAspectRatio="none"
											>
												<!-- Area path -->
												<path d={areaPath} class="fill-primary/10" />
												<!-- Line path -->
												<path d={linePath} class="stroke-primary/60 stroke-2 fill-none" />
											</svg>
										{:else}
											<div
												class="flex h-full w-full items-center justify-center text-[10px] text-base-content/40"
											>
												No contributions
											</div>
										{/if}
									{:else}
										<div class="w-full h-8 bg-base-200/50 animate-pulse rounded"></div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div
					class="card card-bordered border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/50"
				>
					No active contributors found in this time range.
				</div>
			{/if}
		</div>
	</div>
</DualColumnLayout>
