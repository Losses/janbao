/**
 * Format a count for a compact icon badge: show the number verbatim, but cap
 * the display at "99+" so a large unread total does not overflow a small
 * corner badge. Shared by the notification and message tooltip badges.
 */
export function formatBadgeCount(count: number): string {
	return count > 99 ? '99+' : String(count);
}
