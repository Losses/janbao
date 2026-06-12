<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
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
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const drafts = $derived(data.drafts as DraftListItem[]);
	let isDrawerOpen = $state(false);

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
		// reply draft — contextId is the discussionId; the ID-only route
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
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.dynamics}</a></li>
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
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
