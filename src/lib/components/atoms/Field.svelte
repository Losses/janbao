<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Field Atom — the chrome-only "label on top, control below" wrapper. This is
	 * the single source of truth for the stacked-field spacing used across auth
	 * and settings (the login/register layout the rest of the app adopts).
	 *
	 * Renders a label with an optional `description` hugging it, then the
	 * caller-supplied control via `children`, then an optional `hint` snippet
	 * and/or `error` message. Owns label/description/hint spacing only — it never
	 * renders the control itself, so any input/select/textarea/file/custom markup
	 * composes cleanly.
	 *
	 * `FormField` composes this for input/textarea; pages compose it directly for
	 * select/file controls where a bindable value isn't the whole story.
	 */
	interface FieldProps {
		id: string;
		label: string;
		description?: string;
		error?: string;
		class?: string;
		hint?: Snippet;
		children: Snippet;
	}

	let {
		id,
		label,
		description,
		error = '',
		class: className = '',
		hint,
		children
	}: FieldProps = $props();
</script>

<div class="form-control {className}">
	<div class="mb-1.5">
		<label class="block text-sm font-semibold text-base-content" for={id}>{label}</label>
		{#if description}
			<p class="text-xs text-base-content/60 mt-0.5">{description}</p>
		{/if}
	</div>

	{@render children()}

	{#if hint}
		<div class="mt-1.5">
			{@render hint()}
		</div>
	{/if}
	{#if error}
		<p class="text-xs text-error mt-1.5">{error}</p>
	{/if}
</div>
