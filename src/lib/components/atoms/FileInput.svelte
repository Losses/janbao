<script lang="ts">
	/**
	 * FileInput Atom - an i18n-friendly replacement for DaisyUI's native
	 * `.file-input`. The stock `<input type="file">` draws its "Choose file"
	 * button through the browser-controlled `::file-selector-button`, so the
	 * text follows the OS locale, not the app locale (e.g. the button keeps
	 * showing an OS-locale label even when the app is in English). This atom hides the
	 * native input and renders a button (translated `label`) plus a filename box
	 * (translated `placeholder` when empty), so the control tracks the app
	 * language instead.
	 *
	 * The underlying `<input type="file">` is forwarded via the bindable
	 * `inputEl` so a parent form can still read `.files` and validate at submit
	 * time - the same surface the raw input exposed.
	 */
	interface FileInputProps {
		id: string;
		label: string;
		placeholder?: string;
		accept?: string;
		disabled?: boolean;
		class?: string;
		inputEl?: HTMLInputElement;
	}

	let {
		id,
		label,
		placeholder = '',
		accept,
		disabled = false,
		class: className = '',
		inputEl = $bindable()
	}: FileInputProps = $props();

	let fileName = $state('');

	function openPicker() {
		inputEl?.click();
	}

	function handleChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		fileName = target.files?.[0]?.name ?? '';
	}
</script>

<div class="join w-full {className}">
	<button type="button" class="btn join-item" {disabled} onclick={openPicker}>
		{label}
	</button>
	<span class="input input-bordered join-item flex-1 min-w-0 truncate text-sm text-base-content/60">
		{fileName || placeholder}
	</span>
	<input
		{id}
		type="file"
		{accept}
		{disabled}
		bind:this={inputEl}
		onchange={handleChange}
		class="hidden"
	/>
</div>
