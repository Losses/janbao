<script lang="ts">
	/**
	 * MessageTooltip Molecule — Popover displaying the 5 most recent PM conversations.
	 * During Cycle 2, uses mock data.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiEmail, mdiEmailPlus } from '@mdi/js';

	import type { VoidHandler } from '$lib/types/handlers';

	interface MessageTooltipProps {
		isOpen: boolean;
		onToggle: VoidHandler;
		onClose: VoidHandler;
		t: Record<string, Record<string, string> | string>;
	}

	let { isOpen, onToggle, onClose, t }: MessageTooltipProps = $props();

	const tSidebar = $derived((t as Record<string, Record<string, string>>).sidebar ?? {});

	// Mock conversation data for Cycle 2
	const mockConversations = [
		{ id: '1', title: 'Project Discussion with Alice', time: '10 min ago', unread: true },
		{ id: '2', title: 'Bug Report Follow-up', time: '2 hours ago', unread: true },
		{ id: '3', title: 'Feature Ideas', time: '1 day ago', unread: false },
		{ id: '4', title: 'Welcome Message from Bob', time: '3 days ago', unread: false },
		{ id: '5', title: 'Meeting Notes', time: '1 week ago', unread: false }
	];
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs"
		aria-label={tSidebar['messages'] ?? 'Messages'}
		title={tSidebar['messages'] ?? 'Messages'}
		aria-expanded={isOpen}
		aria-haspopup="dialog"
	>
		<Icon path={mdiEmail} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['messages'] ?? 'Messages'}</span>
				<a
					href="/messages/new"
					class="text-xs text-primary hover:font-bold"
					aria-label={tSidebar['sendMessage'] ?? 'Send Message'}
				>
					<Icon path={mdiEmailPlus} size={14} />
				</a>
			</div>
			<!-- Conversation List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each mockConversations as conv (conv.id)}
					<li
						class="border-b border-base-200 px-4 py-2 transition-colors duration-150 hover:bg-base-200"
					>
						<a href="/messages/{conv.id}" class="block">
							<p
								class="text-xs {conv.unread
									? 'font-medium text-base-content'
									: 'text-base-content/60'}"
							>
								{conv.title}
							</p>
							<span class="text-xs text-base-content/40">{conv.time}</span>
						</a>
					</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/messages/inbox" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll'] ?? 'Show All'}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
