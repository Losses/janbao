# RV00-C02-Audit-02: Cycle 2 Round 2 Audit Report

**Date:** 2026-06-12
**Auditors:** 5 Independent Agents
**Verdict:** FAIL (to be resolved)

---

## Summary of Findings

The five independent auditor agents conducted a comprehensive audit of the Cycle 2 (C02) implementations. While the code represents high compile-time safety and structure, the agents identified 2 CRITICAL defects, 6 MAJOR defects, and several MINOR defects.

---

## Defects Identified

### CRITICAL (2)

| ID     | File                                   | Description                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | `src/lib/components/atoms/Date.svelte` | **Fatal Runtime Render Crash:** calling `.toISOString()` on an `Invalid Date` throws `RangeError: Invalid time value` directly inside Svelte template rendering when `value` is invalid/empty.                                                                                                                                                                                          |
| **C2** | `src/lib/server/db/schema.ts`          | **Seconds vs Milliseconds Timestamp Mismatch:** Schema uses `strftime('%s', 'now')` (seconds) for default values, but Drizzle integer mode timestamp expects milliseconds. This causes: 1) users to show signup in 1970; 2) mix of seconds/milliseconds in the same database table; 3) online users wall queries comparing milliseconds to database default seconds to fail completely. |

### MAJOR (6)

| ID     | File                                                      | Description                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | `src/lib/components/atoms/Tooltip.svelte`                 | **Accessibility Violation:** trigger wrapper uses `role="button"` and `tabindex="0"`, while child slots in molecules pass `<button>`. This nests interactive elements, causing screen-reader confusion and requiring double tab-stops in keyboard navigation. |
| **M2** | `src/lib/components/atoms/Date.svelte`                    | **Typo in Minutes Plural Key:** calls `rel(minutes, 'minuteAgo', 'minuteAgo')` instead of `'minutesAgo'`, showing `"5 minute ago"` instead of `"5 minutes ago"`.                                                                                              |
| **M3** | `src/lib/components/atoms/Date.svelte`                    | **Future Skew Display Bug:** future dates due to server-client clock drift are formatted as past tense (e.g. `"5 minutes ago"`) instead of `"just now"`.                                                                                                      |
| **M4** | `src/lib/components/organisms/LexicalEditor.svelte`       | **Data Loss and Dynamic Unmount Bug:** setting `disabled` to true sets `isLoading = true` and unmounts the Svelte-Lexical composer block. This deletes the editor instance and causes total user input loss on lock/submit.                                   |
| **M5** | `src/hooks.server.ts`                                     | **Missing `event.waitUntil`:** updating `lastActiveTime` is an unawaited background promise. In Cloudflare Workers, this promise will get aborted mid-flight after response is returned unless wrapped in `event.waitUntil`.                                  |
| **M6** | `src/lib/components/molecules/NotificationTooltip.svelte` | **Non-Interactive Notifications:** Notification items are static text rows without links, whereas Messages and Bookmarks are correctly wrapped in links.                                                                                                      |

### MINOR (5)

| ID     | File                                                | Description                                                                                                                                                        |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **m1** | `src/lib/components/organisms/LexicalEditor.svelte` | **Case-Sensitive protocol check:** `validateUrl()` rejects uppercase scheme variants like `HTTPS://`. Also blocks valid relative URLs.                             |
| **m2** | `src/routes/api/users/online/+server.ts`            | **Missing Cache-Control Header:** API endpoint returns real-time data but does not prevent browser/edge caching.                                                   |
| **m3** | `src/routes/api/users/online/+server.ts`            | **Magic String System User ID:** Hardcoded UUID for the system user instead of using a unified constant.                                                           |
| **m4** | `src/lib/components/atoms/Date.svelte`              | **Duplicate Fallback Prepending:** the `rel` function prepends the number `n` twice (e.g. `"1 1 minuteAgo"`) when translation dictionary `t` is missing.           |
| **m5** | `src/lib/components/atoms/Avatar.svelte`            | **Broken Size Layout:** Maps size to classes like `avatar-xs` / `avatar-lg` which are not defined in DaisyUI. Width/height must be set on the inner wrapper `div`. |

---

## Planned Actions

1. **C1 & M2 & M3 & m4 (Date.svelte):** Add invalid date guard to prevent RangeError; correct duplicate fallback prepending in `rel()`; return `"just now"` on future drift; correct minutes plural key argument.
2. **C2 (schema.ts):** Change all database timestamp default expressions to use `(strftime('%s', 'now') * 1000)` to force millisecond integers.
3. **M1 (Tooltip.svelte & Molecules):** Remove interactive role/tabindex from the trigger wrapper div. Place `aria-haspopup="dialog"` and `aria-expanded` attributes on the inner buttons in the molecule files. Remove `e.stopPropagation()` from click handlers to allow clean click-outside bubbles.
4. **M4 & m1 (LexicalEditor.svelte):** Prevent unmounting of Svelte-Lexical Composer when disabled. Instead, lock input visually using a blurred container overlay with pointer-events-none. Enhance `validateUrl()` to support case-insensitive checks and relative links. Add image validation inside a Lexical node transform hook.
5. **M5 (hooks.server.ts):** Wrap the active time update promise in `event.platform.context.waitUntil` (if available).
6. **M6 (NotificationTooltip.svelte):** Wrap notification items in link components (`<a>`) targeting `/notifications`.
7. **m2 & m3 (online user API):** Add `Cache-Control` header to prevent edge caching. Define and import a shared `SYSTEM_USER_ID` constant.
8. **m5 (Avatar.svelte):** Map sizes `xs`/`sm`/`md`/`lg` to correct DaisyUI/Tailwind width/height classes on the inner wrapper `div`.
