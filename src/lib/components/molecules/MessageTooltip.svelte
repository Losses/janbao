<script lang="ts">
	/**
	 * MessageTooltip Molecule — Popover displaying the 5 most recently active
	 * PM conversations. Lazily fetches `/api/messages/recent?limit=5` when opened.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { mdiEmail, mdiEmailPlus } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { ConversationListItem } from '$lib/types/api';

	interface TranslationDict {
		[key: string]: string | Record<string, string>;
	}

	interface MessageTooltipProps {
		isOpen: boolean;
		onToggle: VoidHandler;
		onClose: VoidHandler;
		t: TranslationDict;
	}

	let { isOpen, onToggle, onClose, t }: MessageTooltipProps = $props();

	const tSidebar = $derived((t['sidebar'] as Record<string, string> | undefined) ?? {});
	const tMessage = $derived((t['message'] as Record<string, string> | undefined) ?? {});

	let conversations = $state<ConversationListItem[]>([]);
	let loaded = $state(false);

	$effect(() => {
		if (!isOpen || loaded) return;
		void load();
	});

	async function load() {
		try {
			const res = await fetch('/api/messages/recent?limit=5');
			if (res.ok) {
				const data = (await res.json()) as { conversations: ConversationListItem[] };
				conversations = data.conversations ?? [];
			}
		} catch {
			conversations = [];
		}
		loaded = true;
	}
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs"
		aria-label={tSidebar['messages'] ?? ''}
		title={tSidebar['messages'] ?? ''}
		aria-expanded={isOpen}
		aria-haspopup="dialog"
	>
		<Icon path={mdiEmail} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['messages']}</span>
				<a
					href="/messages/new"
					class="text-xs text-primary hover:font-bold"
					aria-label={tSidebar['sendMessage'] ?? ''}
				>
					<Icon path={mdiEmailPlus} size={14} />
				</a>
			</div>
			<!-- Conversation List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each conversations as conv (conv.id)}
					<li
						class="border-b border-base-200 px-4 py-2 transition-colors duration-150 hover:bg-base-200"
					>
						<a href="/messages/{conv.id}" class="flex items-center justify-between gap-2">
							<div class="min-w-0">
								<p
									class="text-xs {conv.unreadCount > 0
										? 'font-medium text-base-content'
										: 'text-base-content/60'} truncate"
								>
									{conv.title}
								</p>
								{#if conv.lastMessagePreview}
									<p class="text-xs text-base-content/40 truncate">{conv.lastMessagePreview}</p>
								{/if}
							</div>
							<div class="flex items-center gap-1 flex-shrink-0">
								{#if conv.unreadCount > 0}
									<Badge variant="primary">{conv.unreadCount}</Badge>
								{/if}
							</div>
						</a>
					</li>
				{:else}
					<li class="px-4 py-3 text-xs text-base-content/40">{tMessage['noConversations']}</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/messages/inbox" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll']}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
