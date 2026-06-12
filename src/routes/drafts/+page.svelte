<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import LinkButton from '$lib/components/atoms/LinkButton.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { DraftListItem } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const draftT = $derived(t.draft);
	const user = $derived(data.user);
	const drafts = $derived(data.drafts as DraftListItem[]);

	const userSlug = $derived(generateSlug(user?.username || ''));

	interface DraftView {
		draft: DraftListItem;
		label: string;
		href: string;
	}

	function buildView(draft: DraftListItem): DraftView {
		if (draft.contextType === 'discussion') {
			return { draft, label: draftT.discussionDraft, href: '/post/discussion' };
		}
		// reply draft - contextId is the discussionId; the ID-only route
		// redirects to the canonical slug.
		return {
			draft,
			label: draftT.replyDraft,
			href: `/discussion/${draft.contextId || ''}`
		};
	}

	const views = $derived(drafts.map(buildView));
</script>

<svelte:head>
	<title>{formatTitle(draftT.myDrafts)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar {user} {t} targetUserId={user.id} targetUserSlug={userSlug} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{draftT.myDrafts}</h1>

		{#if views.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{draftT.noDrafts}
			</div>
		{:else}
			<div class="space-y-3">
				{#each views as view (view.draft.id)}
					<div class="card bg-base-100 border border-base-200 rounded-xl p-4 shadow-sm space-y-3">
						<div class="flex items-center justify-between gap-2">
							<Badge variant="neutral">{view.label}</Badge>
							<DateComponent
								value={view.draft.updatedAt}
								{t}
								class="text-xs text-base-content/40"
							/>
						</div>
						<div class="text-sm text-base-content/80 max-h-32 overflow-hidden">
							<LexicalRenderer contentJson={view.draft.contentJson} />
						</div>
						<div class="flex justify-end">
							<LinkButton href={view.href} class="text-sm">{draftT.jumpTo} →</LinkButton>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</DualColumnLayout>
