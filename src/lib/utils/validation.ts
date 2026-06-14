export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,30}$/;

/**
 * Validates whether a username complies with the system requirements:
 * - Only alphanumeric characters, hyphens (-), and underscores (_)
 * - Length between 2 and 30 characters
 */
export function isValidUsername(username: string): boolean {
	return USERNAME_REGEX.test(username);
}
