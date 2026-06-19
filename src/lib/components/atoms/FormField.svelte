<script lang="ts">
	/**
	 * FormField Atom — a `Field` (label-on-top chrome) wrapping a bound
	 * input/textarea. The public API is unchanged (label/id/type/value/
	 * placeholder/required/disabled/error/as/rows/maxlength/class/hint) so the
	 * register + admin consumers keep working untouched; only the chrome is now
	 * delegated to `Field` so label/description/hint spacing has one source of
	 * truth. The `error` both tints the control (input-error/textarea-error) and,
	 * via `Field`, renders the message below it.
	 */
	import type { Snippet } from 'svelte';
	import type { FullAutoFill } from 'svelte/elements';
	import Field from './Field.svelte';

	type FieldElement = 'input' | 'textarea';

	interface FormFieldProps {
		label: string;
		id: string;
		type?: string;
		value: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		autocomplete?: FullAutoFill;
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
		autocomplete,
		error = '',
		as = 'input',
		rows = 2,
		maxlength,
		class: className = '',
		hint
	}: FormFieldProps = $props();
</script>

<Field {label} {id} {error} class={className} {hint}>
	{#if as === 'textarea'}
		<textarea
			{id}
			{required}
			{disabled}
			{placeholder}
			{rows}
			{maxlength}
			{autocomplete}
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
			{autocomplete}
			bind:value
			class="input input-bordered w-full {error ? 'input-error' : ''}"
		/>
	{/if}
</Field>
