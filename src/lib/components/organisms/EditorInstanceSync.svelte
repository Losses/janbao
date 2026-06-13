<script lang="ts">
	type UpdateCallback = (editor: unknown) => void;

	interface Props {
		activeEditor: unknown;
		update: UpdateCallback;
	}

	let { activeEditor, update }: Props = $props();

	$effect(() => {
		update(activeEditor);
	});
</script>
