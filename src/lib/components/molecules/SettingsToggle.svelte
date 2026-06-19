<script lang="ts">
	// A flat settings toggle row: label (+ optional description) on the left, a
	// daisyUI toggle on the right. When `checked`, the optional `children` snippet
	// renders below (sub-options); when off, children are hidden entirely (not
	// greyed out). Follows the settings-body flat-design convention (plain
	// `space-y-*`, no card bg/rounded/padding, no divider lines).
	//
	// Shared by the offline-reading master enable + read-passthrough toggles and
	// the push "enable on this device" toggle so they stay visually consistent.
	import type { Snippet } from 'svelte';

	type SettingsToggleChangeHandler = (next: boolean) => void;

	interface SettingsToggleProps {
		label: string;
		description?: string;
		checked: boolean;
		disabled?: boolean;
		onchange: SettingsToggleChangeHandler;
		children?: Snippet;
	}

	let {
		label,
		description,
		checked,
		disabled = false,
		onchange,
		children
	}: SettingsToggleProps = $props();
</script>

<div class="space-y-3">
	<label class="flex items-center justify-between gap-3 {disabled ? '' : 'cursor-pointer'}">
		<div class="space-y-0.5">
			<span class="font-medium text-base-content">{label}</span>
			{#if description}
				<p class="text-sm text-base-content/60">{description}</p>
			{/if}
		</div>
		<input
			type="checkbox"
			class="toggle toggle-primary"
			{checked}
			{disabled}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
	</label>
	{#if checked && children}
		<div class="space-y-4">
			{@render children()}
		</div>
	{/if}
</div>
