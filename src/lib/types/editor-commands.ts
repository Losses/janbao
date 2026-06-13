/**
 * Shared Lexical editor commands used across editor components.
 * Placed in a separate .ts module to allow cross-component imports
 * (Svelte components cannot export named constants for import by other components).
 */
import { createCommand } from 'lexical';
import type { LexicalCommand } from 'lexical';

/** Custom Lexical command to toggle spoiler formatting on selected text */
export const TOGGLE_SPOILER_COMMAND: LexicalCommand<void> = createCommand('toggleSpoiler');
