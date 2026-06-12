<script lang="ts">
	import type { VoidHandler } from '$lib/types/handlers';

	interface ConfirmationModalProps {
		open: boolean;
		title: string;
		message: string;
		confirmLabel: string;
		cancelLabel: string;
		onconfirm: VoidHandler;
		oncancel: VoidHandler;
	}

	let {
		open,
		title,
		message,
		confirmLabel,
		cancelLabel,
		onconfirm,
		oncancel
	}: ConfirmationModalProps = $props();
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<div class="modal-box">
			<h3 id="modal-title" class="text-lg font-bold">{title}</h3>
			<p class="py-4">{message}</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={oncancel} aria-label={cancelLabel}>
					{cancelLabel}
				</button>
				<button class="btn btn-warning" onclick={onconfirm} aria-label={confirmLabel}>
					{confirmLabel}
				</button>
			</div>
		</div>
		<div
			class="modal-backdrop"
			onclick={oncancel}
			onkeydown={() => {}}
			role="button"
			tabindex="-1"
			aria-label={cancelLabel}
		></div>
	</div>
{/if}
