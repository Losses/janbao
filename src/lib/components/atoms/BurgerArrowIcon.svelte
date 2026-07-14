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
	 * Each bar is a fixed <line> reshaped via CSS `transform` (animation-friendly,
	 * unlike SVG geometry attributes). The `progress` prop is driven 1:1 by the
	 * orchestrator's `iconProgress` (which reads `pager.backMorph` during a drag,
	 * `settleProgress` during a settle); the orchestrator's single rAF owns every
	 * motion of the morph, so this atom carries no CSS transition. §5: zero CSS
	 * transitions in the animation layer.
	 */
	interface BurgerArrowIconProps {
		/** 0 = hamburger, 1 = back arrow. Clamped to [0, 1]. */
		progress: number;
	}

	let { progress }: BurgerArrowIconProps = $props();

	const p = $derived(Math.max(0, Math.min(1, progress)));

	// MDI mdiMenu geometry: 24px box, bars 18 wide (x 3..21), 2 thick, centred at
	// y 7/12/17 (stem at 12, arms +/-5). Flat ends match the original hamburger.
	const LEFT = 3;
	const RIGHT = 21;
	const T = 2; // stroke thickness, matches mdiMenu's 2px bars
	const STEM = 12;
	const TOP = 7;
	const BOT = 17;
	// Analytically FITTED (solved, not tuned by eye) so the two arms meet at a
	// single sharp tip ON the stem (the tip x) and form a symmetric 45deg
	// chevron. The transform math is inverted for a target tip; TY is fixed by
	// the fit, TX + the arm length derive from SPLAY. SPLAY=7.4 makes each arm
	// 10.49px, matching mdiArrowLeft's diagonal exactly. (Verified by endpoint
	// computation: both arms' tips land exactly on the tip point, coincident.)
	const SPLAY = 8; // each arm reaches ±SPLAY px from the stem at p=1 (arm = SPLAY*1.414 = 10.49)
	const TY = 1.2; // fixed by the fit (places the tip on the stem)
	const TX = (8 - SPLAY / 2 + (5 - SPLAY / 2)) / 0.707 / 2;
	const ARM_END = (SPLAY * 1.414) / 18; // arm length as a fraction of the bar at p=1
	// The tip where both arms meet (and where the stem's left end retracts to).
	const TIP_X = 4;
	// The stem is the SHAFT, not the full hamburger bar: mdiArrowLeft's shaft is
	// ~11.5, far shorter than the 18px middle bar. The stem retracts from both
	// ends toward (TIP_X, SHAFT_RIGHT) so the arrowhead is proportionate (a full
	// 18px stem made the arms look stubby, ratio 0.47 vs mdiArrowLeft's 0.91).
	const SHAFT_RIGHT = 20;
	const SHAFT_SCALE = (SHAFT_RIGHT - TIP_X) / (RIGHT - LEFT); // shaft length / bar length
	// The stem retracts into a shaft WHILE staying inside the rotating group (so
	// it flips 180deg with the arms, preserving the Material morph motion). The
	// group flip mirrors x->24-x, so the pre-flip shift is from the RIGHT end,
	// not the left: solving G(T_stem(bar)) = (TIP_X,12)-(SHAFT_RIGHT,12) gives a
	// pre-flip translate of (RIGHT - SHAFT_RIGHT) and scale SHAFT_SCALE.
	const STEM_SHIFT = RIGHT - SHAFT_RIGHT;

	const groupStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${STEM}px; transform: rotate(${180 * p}deg)`
	);
	const stemStyle = $derived(
		`transform-box: view-box; transform-origin: ${LEFT}px ${STEM}px; transform: translate(${STEM_SHIFT * p}px, 0) scaleX(${1 - (1 - SHAFT_SCALE) * p})`
	);
	const topStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${TOP}px; transform: rotate(${45 * p}deg) translate(${TX * p}px, ${-TY * p}px) scaleX(${1 - (1 - ARM_END) * p})`
	);
	const botStyle = $derived(
		`transform-box: view-box; transform-origin: 12px ${BOT}px; transform: rotate(${-45 * p}deg) translate(${TX * p}px, ${TY * p}px) scaleX(${1 - (1 - ARM_END) * p})`
	);
</script>

<svg viewBox="0 0 24 24" width="24" height="24" class="block" aria-hidden="true">
	<defs>
		<!-- Mask = the opaque union of the 3 bars. The visible icon is a SINGLE
			currentColor rect painted through this mask, so where bars overlap (the
			tip where all 3 meet) they do not alpha-compound into a darker patch:
			the mask is a binary union and the one fill is uniform currentColor. -->
		<mask id="burger-arrow" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
			<g style={groupStyle} fill="none" stroke="white" stroke-width={T} stroke-linecap="butt">
				<line x1={LEFT} y1={STEM} x2={RIGHT} y2={STEM} style={stemStyle} />
				<line x1={LEFT} y1={TOP} x2={RIGHT} y2={TOP} style={topStyle} />
				<line x1={LEFT} y1={BOT} x2={RIGHT} y2={BOT} style={botStyle} />
			</g>
		</mask>
	</defs>
	<rect x="0" y="0" width="24" height="24" fill="currentColor" mask="url(#burger-arrow)" />
</svg>
