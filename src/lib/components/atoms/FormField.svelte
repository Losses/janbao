<script lang="ts">
	/**
	 * FormField Atom - Label-on-top form control matching the register-page
	 * pattern: a `label text-sm font-semibold` above an `input input-bordered w-full`
	 * (or textarea). Label and control are separate elements so they can be styled
	 * and themed independently. Optional `hint` snippet renders below the control
	 * for per-field validation/strength hints.
	 */
	import type { Snippet } from 'svelte';

	type FieldElement = 'input' | 'textarea';

	interface FormFieldProps {
		label: string;
		id: string;
		type?: string;
		value: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		error?: string;
		as?: FieldElement;
		rows?: number;
		maxlength?: number;
		class?: string;
		hint?: Snippet;
	}

	let {
		label,
		id,
		type = 'text',
		value = $bindable(''),
		placeholder = '',
		required = false,
		disabled = false,
		error = '',
		as = 'input',
		rows = 2,
		maxlength,
		class: className = '',
		hint
	}: FormFieldProps = $props();
</script>

<div class="form-control {className}">
	<label class="label text-sm font-semibold" for={id}>
		<span class="label-text">{label}</span>
	</label>
	{#if as === 'textarea'}
		<textarea
			{id}
			{required}
			{disabled}
			{placeholder}
			{rows}
			{maxlength}
			bind:value
			class="textarea textarea-bordered w-full {error ? 'textarea-error' : ''}"
		></textarea>
	{:else}
		<input
			{id}
			{type}
			{required}
			{disabled}
			{placeholder}
			{maxlength}
			bind:value
			class="input input-bordered w-full {error ? 'input-error' : ''}"
		/>
	{/if}
	{#if hint}
		{@render hint()}
	{:else if error}
		<p class="text-xs text-error mt-1">{error}</p>
	{/if}
</div>
