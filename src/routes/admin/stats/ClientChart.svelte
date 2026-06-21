<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleBand } from 'd3-scale';
	import TimelineChart from './TimelineChart.svelte';
	import type { TimelineDataPoint } from '$lib/server/db/dao/stats';

	type YAccessorFn = (d: TimelineDataPoint) => number;

	interface ClientChartProps {
		timeline: TimelineDataPoint[];
		yAccessor: YAccessorFn;
	}

	let { timeline, yAccessor }: ClientChartProps = $props();
</script>

<LayerCake
	padding={{ top: 10, right: 10, bottom: 25, left: 45 }}
	x="date"
	y={yAccessor}
	data={timeline}
	xScale={scaleBand().paddingInner(0.15)}
	yDomain={[0, null]}
>
	<Svg>
		<TimelineChart />
	</Svg>
</LayerCake>
