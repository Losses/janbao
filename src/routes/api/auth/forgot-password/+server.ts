import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { sendEmail } from '$lib/server/mailer';
import { jsonError } from '$lib/server/errors';
import { escapeHtml } from '$lib/utils/escape';
import {
	enforceThrottle,
	getClientAddressSafe,
	tooManyRequests,
	FORGOT_IP_THROTTLE,
	FORGOT_EMAIL_THROTTLE
} from '$lib/server/throttle';
import { getSiteName } from '$lib/utils/title';
import type { RequestHandler } from './$types';
import type { AuthForgotPasswordBody } from '$lib/types/api';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthForgotPasswordBody;
		const { email } = body;

		if (!email) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}

		// Cap email length (RFC 5321 max is 254) so it cannot bloat the throttle
		// table or the lower() expression index.
		if (email.length > 254) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}

		// Rate limit: per-IP and per-email fixed windows (shared across isolates).
		const ip = getClientAddressSafe(event);
		const ipResult = await enforceThrottle(db, 'forgot:ip', ip, FORGOT_IP_THROTTLE);
		if (ipResult.blocked) return tooManyRequests(t.auth.tooManyAttempts, ipResult.retryAfter);
		const emailResult = await enforceThrottle(
			db,
			'forgot:email',
			email.toLowerCase(),
			FORGOT_EMAIL_THROTTLE
		);
		if (emailResult.blocked) return tooManyRequests(t.auth.tooManyAttempts, emailResult.retryAfter);

		// Find user by email (case-insensitive; columns use BINARY collation).
		const userList = await db
			.select()
			.from(users)
			.where(sql`lower(${users.email}) = lower(${email})`)
			.limit(1);

		// To prevent user enumeration, return success even if the email does not
		// exist. The system sentinel is also skipped: it must never receive a
		// password-reset token (parity with admin-generate-reset).
		if (userList.length > 0 && userList[0].groupSlug !== 'system') {
			const user = userList[0];
			const token = crypto.randomUUID();
			const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

			// Save to database
			await db.insert(passwordRecoveries).values({
				userId: user.id,
				token: token,
				expiresAt: expiresAt
			});

			const resetLink = `${event.url.origin}/entry/reset-password?token=${token}`;
			const siteName = getSiteName();
			// Escape user-controlled values before interpolating into the HTML body.
			const displayNameHtml = escapeHtml(user.displayName);
			const siteNameHtml = escapeHtml(siteName);

			// Email copy comes from the i18n dictionary; `t` is already resolved
			// to the recipient's locale, so no language branching is needed.
			// Function replacers keep any $ in interpolated values literal.
			const subject = `[${siteName}] ${t.auth.resetPasswordSubject}`;
			const footer = t.auth.resetEmailFooter;
			const greetingText = t.auth.resetEmailGreeting.replace('{name}', () => user.displayName);
			const introText = t.auth.resetEmailIntro.replace('{site}', () => siteName);
			const greetingHtml = t.auth.resetEmailGreeting.replace(
				'{name}',
				() => `<strong>${displayNameHtml}</strong>`
			);
			const introHtml = t.auth.resetEmailIntro.replace('{site}', () => siteNameHtml);

			const text = `${greetingText}\n\n${introText}\n\n${resetLink}\n\n${footer}`;
			const html = `<p>${greetingHtml}</p>
<p>${introHtml}</p>
<p><a href="${resetLink}" target="_blank">${resetLink}</a></p>
<p>${footer}</p>`;

			await sendEmail(
				{
					to: user.email,
					toName: user.displayName,
					subject,
					text,
					html
				},
				event.platform?.env
			);
		}

		return json({ success: true });
	} catch (e) {
		console.error('Forgot password error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
