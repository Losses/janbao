<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import ActivityComments from '$lib/components/organisms/ActivityComments.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { JoinedMember } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface JoinedActivityRowProps {
		id: number;
		createdAt: Date;
		members: JoinedMember[];
		locale: string;
		commentCount: number;
		authorId: number;
		currentUserId?: number | null;
		isAdmin?: boolean;
		t: TranslationDict;
	}

	let {
		id,
		createdAt,
		members,
		locale,
		commentCount = 0,
		authorId,
		currentUserId = null,
		isAdmin = false,
		t
	}: JoinedActivityRowProps = $props();

	// Avatar = first member's avatar (matches how Vanilla shows the OP of the
	// "who joined" event).
	const first = $derived(members[0]);
	const isZh = $derived(locale.startsWith('zh'));

	// Separator rendered BEFORE each name (index 0 = none). Matches the requested
	// format: en "A, B and C", zh "A、B 和 C".
	function sepBefore(i: number, count: number): string {
		if (i === 0) return '';
		const last = i === count - 1;
		if (isZh) return last ? '和' : '、';
		return last ? 'and' : ',';
	}

	// "joined" verb tail.
	const verb = $derived(isZh ? '加入了' : 'joined');
	// Excerpt line ("欢迎加入!" / "Welcome!").
	const welcomeLine = $derived((t.activity as { welcome?: string }).welcome ?? '');
</script>

<div class="py-4 border-b border-base-300 last:border-b-0">
	<div class="flex gap-3">
		{#if first}
			<div class="flex-shrink-0">
				<a href="/profile/{first.userId}/{generateSlug(first.username)}">
					<Avatar
						userId={first.userId}
						avatarFileId={first.avatarFileId}
						displayName={first.displayName}
						size="md"
					/>
				</a>
			</div>
		{/if}
		<div class="flex-1 min-w-0">
			<!-- Row 1: "{u1} and {u2} joined." — inline, same size as ActivityRow title -->
			<div class="flex items-center gap-1 flex-wrap">
				{#each members as m, i (m.userId)}
					{#if sepBefore(i, members.length)}<span class="text-base-content/60"
							>{sepBefore(i, members.length)}</span
						>{/if}
					<a
						href="/profile/{m.userId}/{generateSlug(m.username)}"
						class="font-semibold text-base-content hover:text-primary transition-colors"
					>
						{m.displayName || m.username || `user-${m.userId}`}
					</a>
				{/each}
				<span class="text-base-content/70">{verb}</span>
			</div>

			<!-- Row 2: excerpt -->
			{#if welcomeLine}
				<div class="mt-1">
					{welcomeLine}
				</div>
			{/if}

			<!-- Row 3: timestamp -->
			<div class="flex justify-end items-center gap-2 mt-2">
				<div class="flex-1 text-sm text-base-content/50">
					<DateComponent value={createdAt} {t} class="text-sm" />
				</div>
			</div>

			<!-- Comment thread (shared with ActivityRow) -->
			<ActivityComments
				activityId={id}
				{commentCount}
				{currentUserId}
				{isAdmin}
				activityAuthorId={authorId}
				{t}
			/>
		</div>
	</div>
</div>
