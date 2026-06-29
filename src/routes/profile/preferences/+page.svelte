<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import SettingsToggle from '$lib/components/molecules/SettingsToggle.svelte';
	import SettingGroup from '$lib/components/molecules/SettingGroup.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';
	import {
		subscribeToPush,
		unsubscribeFromPush,
		isPushSubscribed,
		type PushSubscribeOutcome
	} from '$lib/push.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const pushT = $derived(t.push);
	const user = $derived(data.user);
	const prefs = $derived(data.preferences);
	const vapidPublicKey = $derived(data.vapidPublicKey);
	// Browser-only capability check. Gated on `mounted` so it stays false during
	// SSR and the client's hydration pass - the first client render must match the
	// server HTML, otherwise the {#if !pushSupported} branches below diverge and
	// throw on hydration. Flips to the real value in onMount.
	let mounted = $state(false);
	const pushSupported = $derived(
		mounted &&
			typeof window !== 'undefined' &&
			'serviceWorker' in navigator &&
			'PushManager' in window &&
			typeof Notification !== 'undefined'
	);
	const online = getOnlineStore();

	// svelte-ignore state_referenced_locally
	let profileComment = $state(prefs.profileComment);
	// svelte-ignore state_referenced_locally
	let discussionReply = $state(prefs.discussionReply);
	// svelte-ignore state_referenced_locally
	let discussionComment = $state(prefs.discussionComment);
	// svelte-ignore state_referenced_locally
	let participatedComment = $state(prefs.participatedComment);
	// svelte-ignore state_referenced_locally
	let mention = $state(prefs.mention);
	// svelte-ignore state_referenced_locally
	let bookmarkedDiscussionComment = $state(prefs.bookmarkedDiscussionComment);
	// svelte-ignore state_referenced_locally
	let pushProfileComment = $state(prefs.pushProfileComment);
	// svelte-ignore state_referenced_locally
	let pushDiscussionReply = $state(prefs.pushDiscussionReply);
	// svelte-ignore state_referenced_locally
	let pushDiscussionComment = $state(prefs.pushDiscussionComment);
	// svelte-ignore state_referenced_locally
	let pushParticipatedComment = $state(prefs.pushParticipatedComment);
	// svelte-ignore state_referenced_locally
	let pushMention = $state(prefs.pushMention);
	// svelte-ignore state_referenced_locally
	let pushBookmarkedDiscussionComment = $state(prefs.pushBookmarkedDiscussionComment);
	// svelte-ignore state_referenced_locally
	let pushMessage = $state(prefs.pushMessage);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	let pushEnabled = $state(false);
	let pushBusy = $state(false);
	let pushMessageState = $state<FeedbackMessage | null>(null);
	let pushPermission = $state<NotificationPermission>('default');

	onMount(() => {
		mounted = true;
		if (typeof Notification !== 'undefined') {
			pushPermission = Notification.permission;
		}
	});

	$effect(() => {
		// Re-sync local push toggle state when preferences reload (e.g. after save)
		// or when the user navigates back. Also probe the browser for an existing
		// subscription so the enable/disable button reflects reality.
		void prefs;
		if (pushSupported && vapidPublicKey) {
			void isPushSubscribed().then((v) => {
				pushEnabled = v;
			});
		}
	});

	async function handleSave() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/preferences', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					profileComment,
					discussionReply,
					discussionComment,
					participatedComment,
					mention,
					bookmarkedDiscussionComment,
					pushProfileComment,
					pushDiscussionReply,
					pushDiscussionComment,
					pushParticipatedComment,
					pushMention,
					pushBookmarkedDiscussionComment,
					pushMessage
				})
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				message = { type: 'success', text: t.common.success };
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}

	function outcomeFeedback(outcome: PushSubscribeOutcome): FeedbackMessage | null {
		if (outcome === 'subscribed') return { type: 'success', text: pushT.subscribed };
		if (outcome === 'denied') return { type: 'error', text: pushT.permissionDenied };
		if (outcome === 'unsupported') return { type: 'error', text: pushT.unsupported };
		if (outcome === 'no-service-worker') return { type: 'error', text: pushT.noServiceWorker };
		return { type: 'error', text: t.common.error };
	}

	async function handleEnablePush() {
		if (!vapidPublicKey) return;
		pushBusy = true;
		pushMessageState = null;
		// Optimistically reflect the click; the re-probe below corrects it. A
		// failed enable then goes true→false, which is what makes Svelte revert
		// the toggle (a false→false no-op would leave the checkbox stuck on).
		pushEnabled = true;
		const outcome = await subscribeToPush(vapidPublicKey);
		// Re-probe the browser: pushEnabled must reflect the actual
		// subscription state, not just the subscribe() outcome, so the toggle
		// + tickboxes stay in sync with reality.
		pushEnabled = await isPushSubscribed();
		if (typeof Notification !== 'undefined') {
			pushPermission = Notification.permission;
		}
		pushMessageState = outcomeFeedback(outcome);
		pushBusy = false;
	}

	async function handleDisablePush() {
		pushBusy = true;
		pushMessageState = null;
		pushEnabled = false;
		const ok = await unsubscribeFromPush();
		// Re-probe the browser so pushEnabled reflects the actual subscription
		// state. The browser subscription is gone once `unsubscribe()` ran
		// (inside unsubscribeFromPush) even if the server-record delete fails,
		// so trusting the server call's `ok` would leave the toggle/tickboxes
		// stuck on. isPushSubscribed is the source of truth here.
		pushEnabled = await isPushSubscribed();
		if (!ok) {
			pushMessageState = { type: 'error', text: t.common.error };
		}
		pushBusy = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.preferences)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="preferences" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout fallbackRoute="/profile/settings">
		<div class="space-y-6">
			<PageTitle title={profileT.preferences} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<fieldset disabled={!online.online}>
				<div class="space-y-6">
					<SettingGroup
						title={profileT.notificationsSection}
						description={profileT.preferencesDescription}
					>
						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-profile-comment">
								<input
									id="pref-profile-comment"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={profileComment}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefProfileComment}</span>
									<p class="text-xs text-base-content/50">{profileT.prefProfileCommentDesc}</p>
								</div>
							</label>
						</div>

						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-discussion-reply">
								<input
									id="pref-discussion-reply"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={discussionReply}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefDiscussionReply}</span>
									<p class="text-xs text-base-content/50">{profileT.prefDiscussionReplyDesc}</p>
								</div>
							</label>
						</div>

						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-discussion-comment">
								<input
									id="pref-discussion-comment"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={discussionComment}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefDiscussionComment}</span>
									<p class="text-xs text-base-content/50">{profileT.prefDiscussionCommentDesc}</p>
								</div>
							</label>
						</div>

						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-participated">
								<input
									id="pref-participated"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={participatedComment}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefParticipated}</span>
									<p class="text-xs text-base-content/50">{profileT.prefParticipatedDesc}</p>
								</div>
							</label>
						</div>

						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-mention">
								<input
									id="pref-mention"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={mention}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefMention}</span>
									<p class="text-xs text-base-content/50">{profileT.prefMentionDesc}</p>
								</div>
							</label>
						</div>

						<div class="form-control">
							<label class="label cursor-pointer justify-start gap-3" for="pref-bookmarked">
								<input
									id="pref-bookmarked"
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									bind:checked={bookmarkedDiscussionComment}
								/>
								<div>
									<span class="label-text font-medium">{profileT.prefBookmarked}</span>
									<p class="text-xs text-base-content/50">{profileT.prefBookmarkedDesc}</p>
								</div>
							</label>
						</div>
					</SettingGroup>

					{#if vapidPublicKey}
						<SettingGroup title={pushT.sectionTitle} description={pushT.sectionDescription}>
							{#if pushMessageState}
								<div
									class="alert {pushMessageState.type === 'success'
										? 'alert-primary'
										: 'alert-warning'}"
									role="alert"
								>
									{pushMessageState.text}
								</div>
							{/if}

							{#if !pushSupported}
								<p class="text-sm text-base-content/50">{pushT.unsupported}</p>
							{:else if pushPermission === 'denied'}
								<p class="text-sm text-base-content/50">{pushT.permissionDenied}</p>
							{/if}

							<SettingsToggle
								label={pushT.enable}
								checked={pushEnabled}
								disabled={pushBusy || !pushSupported || pushPermission === 'denied'}
								onchange={(v) => (v ? handleEnablePush() : handleDisablePush())}
							/>

							{#if pushEnabled && !pushBusy}
								<div class="space-y-3">
									<div class="form-control">
										<label class="label cursor-pointer justify-start gap-3" for="pref-push-mention">
											<input
												id="pref-push-mention"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushMention}
											/>
											<div>
												<span class="label-text font-medium">{pushT.mention}</span>
												<p class="text-xs text-base-content/50">{pushT.mentionDesc}</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label class="label cursor-pointer justify-start gap-3" for="pref-push-reply">
											<input
												id="pref-push-reply"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushDiscussionReply}
											/>
											<div>
												<span class="label-text font-medium">{pushT.reply}</span>
												<p class="text-xs text-base-content/50">{pushT.replyDesc}</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label
											class="label cursor-pointer justify-start gap-3"
											for="pref-push-discussion-comment"
										>
											<input
												id="pref-push-discussion-comment"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushDiscussionComment}
											/>
											<div>
												<span class="label-text font-medium">{pushT.discussionComment}</span>
												<p class="text-xs text-base-content/50">{pushT.discussionCommentDesc}</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label
											class="label cursor-pointer justify-start gap-3"
											for="pref-push-participated"
										>
											<input
												id="pref-push-participated"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushParticipatedComment}
											/>
											<div>
												<span class="label-text font-medium">{pushT.participatedComment}</span>
												<p class="text-xs text-base-content/50">
													{pushT.participatedCommentDesc}
												</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label
											class="label cursor-pointer justify-start gap-3"
											for="pref-push-bookmarked"
										>
											<input
												id="pref-push-bookmarked"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushBookmarkedDiscussionComment}
											/>
											<div>
												<span class="label-text font-medium">
													{pushT.bookmarkedDiscussionComment}
												</span>
												<p class="text-xs text-base-content/50">
													{pushT.bookmarkedDiscussionCommentDesc}
												</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label
											class="label cursor-pointer justify-start gap-3"
											for="pref-push-profile-comment"
										>
											<input
												id="pref-push-profile-comment"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushProfileComment}
											/>
											<div>
												<span class="label-text font-medium">{pushT.profileComment}</span>
												<p class="text-xs text-base-content/50">{pushT.profileCommentDesc}</p>
											</div>
										</label>
									</div>

									<div class="form-control">
										<label class="label cursor-pointer justify-start gap-3" for="pref-push-message">
											<input
												id="pref-push-message"
												type="checkbox"
												class="checkbox checkbox-sm checkbox-primary"
												bind:checked={pushMessage}
											/>
											<div>
												<span class="label-text font-medium">{pushT.message}</span>
												<p class="text-xs text-base-content/50">{pushT.messageDesc}</p>
											</div>
										</label>
									</div>
								</div>
							{/if}
						</SettingGroup>
					{:else if !pushSupported}
						<!-- Push not configured on the server AND/OR unsupported on this client. Hide the section. -->
					{/if}
				</div>
			</fieldset>

			<div class="pt-2">
				<button class="btn btn-primary" onclick={handleSave} disabled={saving}>
					{saving ? t.common.saving : t.common.submit}
				</button>
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
