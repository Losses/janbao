<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import SettingsToggle from '$lib/components/molecules/SettingsToggle.svelte';
	import SettingGroup from '$lib/components/molecules/SettingGroup.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getEditorPrefsStore } from '$lib/stores/editor-prefs.svelte';
	import { EDITOR_FEATURE_KEYS, type EditorPreferences } from '$lib/editor/prefs';

	interface PageProps {
		data: PageData;
	}

	type FeatureKey = (typeof EDITOR_FEATURE_KEYS)[number];

	interface FeatureToggle {
		key: FeatureKey;
		label: string;
		description: string;
	}

	interface FeatureSection {
		title: string;
		items: FeatureToggle[];
	}

	type SectionTitleKey =
		| 'sectionInline'
		| 'sectionBlocks'
		| 'sectionLists'
		| 'sectionMedia'
		| 'sectionShortcuts';

	interface SectionGroup {
		titleKey: SectionTitleKey;
		keys: FeatureKey[];
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const editorT = $derived(profileT.editorSettings);
	const user = $derived(data.user);
	const online = getOnlineStore();
	const editorPrefsStore = getEditorPrefsStore();

	// Local editable copy of the saved prefs. Bound to the toggles; submitted as
	// a whole on Save. state_referenced_locally: seeded from server data.
	// svelte-ignore state_referenced_locally
	let prefs = $state<EditorPreferences>({ ...data.editorPreferences });
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	// Group the feature toggles by the editor's own toolbar sections so the list
	// mirrors the toolbar layout (inline / block / lists / media / shortcuts)
	// instead of one undifferentiated run.
	const SECTION_GROUPS: SectionGroup[] = [
		{
			titleKey: 'sectionInline',
			keys: ['bold', 'italic', 'underline', 'strikethrough', 'highlight', 'spoiler']
		},
		{ titleKey: 'sectionBlocks', keys: ['headings', 'quote', 'codeBlock'] },
		{ titleKey: 'sectionLists', keys: ['bulletList', 'numberedList', 'checklist'] },
		{ titleKey: 'sectionMedia', keys: ['link', 'autolink', 'image'] },
		{ titleKey: 'sectionShortcuts', keys: ['markdown'] }
	];

	const featureSections = $derived<FeatureSection[]>(
		SECTION_GROUPS.map((group) => ({
			title: editorT[group.titleKey],
			items: group.keys.map((key) => ({
				key,
				label: editorT[key],
				description: editorT[`${key}Desc`]
			}))
		}))
	);

	async function handleSave() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/editor-preferences', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(prefs)
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				message = { type: 'success', text: t.common.success };
				// Refresh every live editor's feature flags without a reload.
				editorPrefsStore.update({ ...prefs });
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(editorT.title)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="editorSettings" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<PageTitle title={editorT.title} />

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
				<!-- Master switch. No group title: the page title already says "Editor",
				     and the toggle's own label + description carry the plain-mode meaning. -->
				<SettingsToggle
					label={editorT.plainMode}
					description={editorT.plainModeDesc}
					checked={prefs.plainMode}
					disabled={saving}
					onchange={(v) => (prefs.plainMode = v)}
				/>

				{#if !prefs.plainMode}
					{#each featureSections as section (section.title)}
						<SettingGroup title={section.title}>
							{#each section.items as ft (ft.key)}
								<SettingsToggle
									label={ft.label}
									description={ft.description}
									checked={prefs[ft.key]}
									disabled={saving}
									onchange={(v) => (prefs[ft.key] = v)}
								/>
							{/each}
						</SettingGroup>
					{/each}
				{/if}
			</div>
		</fieldset>

		<div class="pt-2">
			<button class="btn btn-primary" onclick={handleSave} disabled={saving}>
				{saving ? t.common.saving : t.common.submit}
			</button>
		</div>
	</div>
</DualColumnLayout>
