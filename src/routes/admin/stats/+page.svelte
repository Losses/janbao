<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import AdminMenuPanel from '$lib/components/panels/AdminMenuPanel.svelte';
	import { onMount, type Component } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import ContributorLineChart from './ContributorLineChart.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { PageData } from './$types';
	import { getIntervalBounds } from '$lib/utils/date';
	import type { Contributor, TimelineDataPoint } from '$lib/server/db/dao/stats';

	interface PageProps {
		data: PageData;
	}

	/** Shape of GET /api/admin/stats?interval=&range= (range overview mode). */
	interface StatsOverviewResponse {
		timeline: TimelineDataPoint[];
		contributors: Contributor[];
		startSec: number;
		endSec: number;
	}

	/** Shape of GET /api/admin/stats brush fetch (?interval=&start=&end=). */
	interface StatsContributorsResponse {
		contributors: Contributor[];
	}

	type StatsInterval = 'year' | 'month' | 'day';

	// Skeleton contributor cards mirroring the loaded card so the
	// skeleton-to-content swap doesn't reflow (tuned via MCP measurement).
	const SKELETON_CARDS = [0, 1, 2, 3] as const;

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

	// interval/range come from the URL (the page is CSR + skeleton; the selects
	// drive goto(), which changes the URL, which this $effect watches to reload).
	const interval = $derived(parseInterval(page.url.searchParams.get('interval')));
	const range = $derived(page.url.searchParams.get('range') || 'all');

	let loaded = $state(false);
	let timeline = $state<TimelineDataPoint[]>([]);

	// Draggable brush states: left & right positions as percentage values (0 to 1)
	let left = $state(0);
	let right = $state(1);

	let contributors = $state<Contributor[]>([]);
	let loadingContributors = $state(false);

	let sliderEl = $state<HTMLDivElement | null>(null);
	let dragType = $state<'left' | 'right' | 'middle' | null>(null);
	let startX = 0;
	let startLeft = 0;
	let startRight = 0;

	function parseInterval(raw: string | null): StatsInterval {
		return raw === 'year' || raw === 'day' ? raw : 'month';
	}

	// Fetch the range overview whenever interval/range change (incl. initial load).
	// Reads only interval/range; writes timeline/contributors/loaded which it does
	// not read back, so it cannot loop.
	async function reload() {
		try {
			const res = await fetch(`/api/admin/stats?interval=${interval}&range=${range}`);
			if (res.ok) {
				const result = (await res.json()) as StatsOverviewResponse;
				timeline = result.timeline;
				contributors = result.contributors;
			}
		} catch {
			// keep existing data
		}
		loaded = true;
	}

	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		interval;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		range;
		void reload();
	});

	// Reset local state when data changes (e.g. interval or range selector reload)
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		interval;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		range;
		left = 0;
		right = 1;
	});

	// Min width percentage of the selected range window (at least 3 data points)
	const minPercent = $derived(
		timeline.length > 0 ? Math.max(0.02, 3 / timeline.length) : 0.05
	);

	// Get active date keys currently enclosed in the [left, right] selection
	const activeTimelineRange = $derived.by(() => {
		if (timeline.length === 0) return [];
		const startIdx = Math.max(
			0,
			Math.min(timeline.length - 1, Math.round(left * (timeline.length - 1)))
		);
		const endIdx = Math.max(
			0,
			Math.min(timeline.length - 1, Math.round(right * (timeline.length - 1)))
		);
		return timeline.slice(startIdx, endIdx + 1);
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
		if (timeline.length === 0) return;

		const startIdx = Math.max(
			0,
			Math.min(timeline.length - 1, Math.round(l * (timeline.length - 1)))
		);
		const endIdx = Math.max(
			0,
			Math.min(timeline.length - 1, Math.round(r * (timeline.length - 1)))
		);

		const startPoint = timeline[startIdx];
		const endPoint = timeline[endIdx];

		const startBounds = getIntervalBounds(startPoint.date, interval);
		const endBounds = getIntervalBounds(endPoint.date, interval);

		clearTimeout(fetchTimeout);
		fetchTimeout = setTimeout(async () => {
			loadingContributors = true;
			try {
				const res = await fetch(
					`/api/admin/stats?interval=${interval}&start=${startBounds.start}&end=${endBounds.end}`
				);
				const json = (await res.json()) as StatsContributorsResponse;
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

	const displayTimeline = $derived.by(() => {
		return downsampleTimelinePoints(timeline, 200);
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

{#snippet leftPanel()}
	{#if user}
		<AdminMenuPanel {user} {t} lang={data.lang} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref="/admin" fallbackRoute="/admin">
		<div class="space-y-6">
			<!-- Header and Dropdown Selection -->
			<div class="flex items-center justify-between border-b border-base-300 pb-4">
				<h1 class="page-title">{adminT['stats'] || 'Statistics'}</h1>

				<div class="flex items-center gap-2">
					<select
						class="select select-bordered select-sm w-fit"
						value={range || 'all'}
						aria-label="Time Range"
						onchange={(e) =>
							goto(`/admin/stats?interval=${interval}&range=${e.currentTarget.value}`)}
					>
						<option value="2y">{adminT['range2y'] || 'Past 2 Years'}</option>
						<option value="1y">{adminT['range1y'] || 'Past 1 Year'}</option>
						<option value="6m">{adminT['range6m'] || 'Past 6 Months'}</option>
						<option value="3m">{adminT['range3m'] || 'Past 3 Months'}</option>
						<option value="current_month">{adminT['rangeCurrentMonth'] || 'This Month'}</option>
						<option value="all">{adminT['rangeAll'] || 'All Time'}</option>
					</select>

					<select
						class="select select-bordered select-sm w-fit"
						value={interval}
						aria-label={adminT['stats']}
						onchange={(e) =>
							goto(`/admin/stats?interval=${e.currentTarget.value}&range=${range || 'all'}`)}
					>
						<option value="year">{adminT['byYear']}</option>
						<option value="month">{adminT['byMonth']}</option>
						<option value="day">{adminT['byDay']}</option>
					</select>
				</div>
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
					{#if loaded && mounted && ClientChart}
						{#if timeline && timeline.length > 0}
							<ClientChart timeline={displayTimeline} {yAccessor} />
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-sm text-base-content/50"
							>
								No data available
							</div>
						{/if}
					{:else}
						<div class="skeleton h-full w-full"></div>
					{/if}
				</div>

				<!-- Draggable Brush Range Selector Slider -->
				<div class="space-y-1">
					<div class="text-xs text-base-content/50 font-medium px-1">
						{adminT['dateRange'] || 'Drag handles or selection area to select time window'}
					</div>
					<div
						class="relative h-14 w-full bg-base-200 border border-base-300 rounded-box select-none touch-none"
						data-gesture-disabled
						bind:this={sliderEl}
					>
						<!-- Sparkline timeline background of total activities -->
						<svg
							class="absolute inset-0 w-full h-full pointer-events-none opacity-20 rounded-box overflow-hidden"
							preserveAspectRatio="none"
						>
							{#if mounted && timeline && timeline.length > 0}
								{@const sampled = downsampleTimelinePoints(timeline, 120)}
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
								class="absolute left-0 top-0 bottom-0 w-2.5 -ml-1.5 bg-neutral border border-neutral-content/20 rounded-btn cursor-ew-resize flex items-center justify-center z-10"
								onmousedown={handleLeftMouseDown}
								ontouchstart={handleLeftTouchStart}
								role="button"
								aria-label="Left slider handle"
								tabindex="0"
							>
								<div class="w-[1px] h-3 bg-neutral-content/40"></div>
								<div class="absolute -inset-y-2 -inset-x-4"></div>
							</div>

							<!-- Right handle inside the block (GitHub style) -->
							<div
								class="absolute right-0 top-0 bottom-0 w-2.5 -mr-1.5 bg-neutral border border-neutral-content/20 rounded-btn cursor-ew-resize flex items-center justify-center z-10"
								onmousedown={handleRightMouseDown}
								ontouchstart={handleRightTouchStart}
								role="button"
								aria-label="Right slider handle"
								tabindex="0"
							>
								<div class="w-[1px] h-3 bg-neutral-content/40"></div>
								<div class="absolute -inset-y-2 -inset-x-4"></div>
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
				{#if !loaded}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#each SKELETON_CARDS as i (i)}
							<div class="card card-bordered border-base-300 bg-base-100 rounded-none">
								<div class="card-body p-4 gap-3">
									<div class="flex items-center gap-3">
										<div class="skeleton h-10 w-10 rounded-full"></div>
										<div class="space-y-1.5 flex-1">
											<div class="skeleton h-3 w-32"></div>
											<div class="skeleton h-2 w-20"></div>
										</div>
									</div>
									<div class="h-10 w-full mt-1 border-t border-base-200/50 pt-2 flex items-end">
										<div class="skeleton h-8 w-full"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else if contributors && contributors.length > 0}
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
									<!-- Contributor header detail: Left Avatar, Right Info -->
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
											<!-- Top: Nickname -->
											<h3 class="font-bold text-sm text-base-content hover:text-primary truncate">
												<a href="/profile/{c.id}/{profileSlug}">{c.displayName}</a>
											</h3>
											<!-- Bottom: P & R Contributions -->
											<p class="text-xs text-base-content/60 font-mono">
												{c.discussionsCount} P / {c.repliesCount} R
											</p>
										</div>
									</div>

									<!-- Bottom: Line Chart -->
									<div class="h-10 w-full mt-1 border-t border-base-200/50 pt-2 flex items-end">
										{#if mounted}
											<ContributorLineChart timeline={c.timeline} />
										{:else}
											<div class="w-full h-8 bg-base-200/50 animate-pulse rounded-box"></div>
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
	</GesturePageLayout>
</DualColumnLayout>
