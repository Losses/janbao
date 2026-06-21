<script lang="ts">
	/**
	 * PasswordStrength Atom - a real-time, length-only strength indicator that
	 * sits below a password input. A fill bar grows with the input (capped at
	 * `minLength`) and turns from red to green once the minimum is met; the
	 * reason text (`labelTooShort`) shows only while the requirement is unmet,
	 * and a quiet `labelOk` confirms once it passes. Length-only by design - the
	 * server enforces only `MIN_PASSWORD_LENGTH`, so this stays in lockstep with
	 * real validation rather than inventing stricter rules in the UI.
	 *
	 * Decoupled from `TranslationDict`: callers pass the two label strings.
	 */
	interface PasswordStrengthProps {
		password: string;
		minLength: number;
		labelTooShort: string;
		labelOk: string;
	}

	let { password, minLength, labelTooShort, labelOk }: PasswordStrengthProps = $props();

	const meetsMin = $derived(password.length >= minLength);
	const pct = $derived((Math.min(password.length, minLength) / minLength) * 100);
</script>

{#if password.length > 0}
	<div class="mt-1.5 w-full">
		<div class="h-1.5 w-full overflow-hidden rounded-full bg-base-content/10">
			<div
				class="h-full rounded-full transition-all {meetsMin ? 'bg-success' : 'bg-error'}"
				style="width: {pct}%"
			></div>
		</div>
		<p class="text-xs mt-1 {meetsMin ? 'text-success' : 'text-error'}">
			{meetsMin ? labelOk : labelTooShort}
		</p>
	</div>
{/if}
