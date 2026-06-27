<script lang="ts">
	/**
	 * BurgerArrowIcon - a 3-bar icon that morphs from a hamburger (progress 0)
	 * to a back arrow (progress 1), driven by a 0..1 value so it can bind 1:1 to
	 * the swipe-back gesture (consumed by the Header on deep pages).
	 *
	 * At rest (progress 0) the bars match the app's existing hamburger exactly:
	 * the same MDI `mdiMenu` geometry (24px box, bars 18px wide, 2px thick, flat
	 * ends, centred at y 7/12/17), so root-mode pages look identical to before.
	 *
	 * The morph is a faithful port of docs/material-burger.sass (rescaled, and
	 * driven by progress instead of its time loop). The structure mirrors the
	 * reference: the stem bar is the rotating container (anim-icon: rotate
	 * 0 -> 180deg, the Material signature flip) and the two arms are its
	 * children, so they inherit the flip and THEN apply their own rotate
	 * (+/-45deg) + translate + shorten (anim-before / anim-after). The 180deg
	 * flip is load-bearing: without it the arms land on the RIGHT (a forward
	 * arrow); the flip swings them to the LEFT to form the back arrow. The arm
	 * translate/length are ANALYTICALLY FITTED (not eye-tuned) so both arms meet
	 * at one sharp tip on the stem; only SPLAY (arrowhead size) is a free knob.
	 *
	 * Each bar is a fixed <line> reshaped via CSS `transform` (transitionable,
	 * unlike SVG geometry attributes), so the morph settles with the same 200ms
	 * ease-out discipline as the tab-pill clip when `dragging` is false, and
	 * tracks the finger with no transition while dragging.
	 */
	interface BurgerArrowIconProps {
		/** 0 = hamburger, 1 = back arrow. Clamped to [0, 1]. */
		progress: number;
		/** True while a pointer is dragging: drop the CSS transition for 1:1 follow. */
		dragging: boolean;
	}

	let { progress, dragging }: BurgerArrowIconProps = $props();

	const p = $derived(Math.max(0, Math.min(1, progress)));
	const transition = $derived(dragging ? 'none' : 'transform 200ms ease-out');

	// MDI mdiMenu geometry: 24px box, bars 18 wide (x 3..21), 2 thick, centred at
	// y 7/12/17 (stem at 12, arms +/-5). Flat ends match the original hamburger.
	const LEFT = 3;
	const RIGHT = 21;
	const T = 2; // stroke thickness, matches mdiMenu's 2px bars
	const STEM = 12;
	const TOP = 7;
	const BOT = 17;
	// Analytically FITTED (solved, not tuned by eye) so the two arms meet at a
	// single sharp tip ON the stem (≈(4,12)) and form a symmetric 45deg chevron.
	// The transform math is inverted for a target tip at (4,12): TY is fixed by
	// the fit, and TX + the arm length derive from SPLAY (how far each arm
	// reaches from the stem). SPLAY is the only knob: smaller = tighter
	// arrowhead; 6 matches mdiArrowLeft. (Verified: endpoints computed in the
	// bun check, both arms' tips land exactly on (4,12), coincident.)
	const SPLAY = 6; // each arm reaches ±SPLAY px from the stem at p=1
	const TY = 2.12; // fixed by the fit (places the tip on the stem)
	const TX = (8 - SPLAY / 2 + (5 - SPLAY / 2)) / 0.707 / 2;
	const ARM_END = (SPLAY * 1.414) / 18; // arm length as a fraction of the bar at p=1

	const groupStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${STEM}px; transform: rotate(${180 * p}deg); transition: ${transition}`
	);
	const topStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${TOP}px; transform: rotate(${45 * p}deg) translate(${TX * p}px, ${-TY * p}px) scaleX(${1 - (1 - ARM_END) * p}); transition: ${transition}`
	);
	const botStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${BOT}px; transform: rotate(${-45 * p}deg) translate(${TX * p}px, ${TY * p}px) scaleX(${1 - (1 - ARM_END) * p}); transition: ${transition}`
	);
</script>

<svg
	viewBox="0 0 24 24"
	width="24"
	height="24"
	class="block"
	fill="none"
	stroke="currentColor"
	stroke-width={T}
	stroke-linecap="butt"
	aria-hidden="true"
>
	<g style={groupStyle}>
		<line x1={LEFT} y1={STEM} x2={RIGHT} y2={STEM} />
		<line x1={LEFT} y1={TOP} x2={RIGHT} y2={TOP} style={topStyle} />
		<line x1={LEFT} y1={BOT} x2={RIGHT} y2={BOT} style={botStyle} />
	</g>
</svg>
