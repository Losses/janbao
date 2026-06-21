<script lang="ts">
	import { getContext } from 'svelte';
	import type { Readable } from 'svelte/store';
	import type { TimelineDataPoint } from '$lib/server/db/dao/stats';

	interface XScaleFn {
		(val: string): number;
		domain(): string[];
		bandwidth(): number;
	}
	interface YScaleFn {
		(val: number): number;
		domain(): number[];
	}

	interface LayerCakeContext {
		data: Readable<TimelineDataPoint[]>;
		xScale: Readable<XScaleFn>;
		yScale: Readable<YScaleFn>;
		width: Readable<number>;
		height: Readable<number>;
	}

	const { data, xScale, yScale, width, height } = getContext('LayerCake') as LayerCakeContext;

	// Compute X ticks (dates) to show nice evenly-spaced labels
	const xTicks = $derived.by(() => {
		const rawData = $data;
		if (rawData.length === 0) return [];

		const targetCount = 6;
		if (rawData.length <= targetCount) {
			return rawData.map((d) => d.date);
		}

		const ticks = [];
		for (let i = 0; i < targetCount; i++) {
			const idx = Math.round((i / (targetCount - 1)) * (rawData.length - 1));
			ticks.push(rawData[idx].date);
		}
		return ticks;
	});

	// Compute Y ticks (counts)
	const yTicks = $derived.by(() => {
		const domain = $yScale.domain();
		const min = domain[0] ?? 0;
		const max = domain[1] ?? 10;
		const step = (max - min) / 4;
		return [min, min + step, min + 2 * step, min + 3 * step, max].map(Math.round);
	});
</script>

<svg class="w-full h-full overflow-visible">
	<!-- Y Axis Grid Lines & Labels -->
	<g class="y-axis">
		{#each yTicks as tick (tick)}
			{@const y = $yScale(tick)}
			{#if !Number.isNaN(y)}
				<line
					x1={0}
					y1={y}
					x2={$width}
					y2={y}
					class="stroke-base-content/10"
					stroke-dasharray="2 2"
				/>
				<text
					x={-8}
					y={y + 4}
					text-anchor="end"
					class="text-[10px] fill-base-content/60 font-mono select-none"
				>
					{tick}
				</text>
			{/if}
		{/each}
	</g>

	<!-- X Axis Tick Marks & Labels -->
	<g class="x-axis">
		{#each xTicks as tick, idx (tick)}
			{@const x = $xScale(tick)}
			{#if !Number.isNaN(x)}
				{@const xCenter = x + $xScale.bandwidth() / 2}
				{@const textAnchor = idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'}
				<line
					x1={xCenter}
					y1={$height}
					x2={xCenter}
					y2={$height + 4}
					class="stroke-base-content/20"
				/>
				<text
					x={xCenter}
					y={$height + 16}
					text-anchor={textAnchor}
					class="text-[10px] fill-base-content/60 font-mono select-none"
				>
					{tick}
				</text>
			{/if}
		{/each}
	</g>

	<!-- Stacked Bar Chart -->
	<g class="bars">
		{#each $data as d (d.date)}
			{@const x = $xScale(d.date)}
			{@const barWidth = $xScale.bandwidth()}

			{@const valDisc = d.discussions}
			{@const valTotal = d.discussions + d.replies}

			{@const yDisc = $yScale(valDisc)}
			{@const yTotal = $yScale(valTotal)}
			{@const yZero = $yScale(0)}

			{#if !Number.isNaN(x) && !Number.isNaN(yDisc) && !Number.isNaN(yTotal) && !Number.isNaN(yZero)}
				<!-- Discussions bar (bottom of the stack) -->
				<rect
					{x}
					y={yDisc}
					width={barWidth}
					height={Math.max(0, yZero - yDisc)}
					class="fill-primary/70 hover:fill-primary transition-colors cursor-pointer"
				>
					<title>{d.date}: {valDisc} discussions</title>
				</rect>

				<!-- Replies bar (top of the stack) -->
				<rect
					{x}
					y={yTotal}
					width={barWidth}
					height={Math.max(0, yDisc - yTotal)}
					class="fill-secondary/70 hover:fill-secondary transition-colors cursor-pointer"
				>
					<title>{d.date}: {d.replies} replies</title>
				</rect>
			{/if}
		{/each}
	</g>
</svg>
