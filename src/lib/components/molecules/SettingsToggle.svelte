<script lang="ts">
	// A flat settings toggle row: label (+ optional description) on the left, a
	// daisyUI toggle on the right. This is a *pure* toggle — sub-options are no
	// longer nested as children; pages render them as siblings inside a
	// `SettingGroup` gated by their own `{#if checked}`. Follows the settings
	// flat-design convention (plain spacing, no card bg/rounded/padding).
	//
	// Shared by the offline-reading master enable + read-passthrough toggles,
	// the push "enable on this device" toggle, and the stealth toggle, so they
	// stay visually consistent.

	type SettingsToggleChangeHandler = (next: boolean) => void;

	interface SettingsToggleProps {
		label: string;
		description?: string;
		checked: boolean;
		disabled?: boolean;
		onchange: SettingsToggleChangeHandler;
	}

	let { label, description, checked, disabled = false, onchange }: SettingsToggleProps = $props();
</script>

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
