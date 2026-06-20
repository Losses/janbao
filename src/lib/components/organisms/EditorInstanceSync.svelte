<script lang="ts">
	import { getEditor } from 'svelte-lexical';

	type UpdateCallback = (editor: unknown) => void;

	interface Props {
		update: UpdateCallback;
	}

	let { update }: Props = $props();

	const editor = getEditor();

	$effect(() => {
		update(editor);
	});
</script>
