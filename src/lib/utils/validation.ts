export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,30}$/;

/** Email shape check (RFC-5321-ish): local@host.tld, no spaces. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared identity/validation limits — single source of truth across auth + profile. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_BIO_LENGTH = 100;

/**
 * Validates whether a username complies with the system requirements:
 * - Only alphanumeric characters, hyphens (-), and underscores (_)
 * - Length between 2 and 30 characters
 */
export function isValidUsername(username: string): boolean {
	return USERNAME_REGEX.test(username);
}

