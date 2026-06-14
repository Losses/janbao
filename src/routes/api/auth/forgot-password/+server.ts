import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { sendEmail } from '$lib/server/mailer';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import type { AuthForgotPasswordBody } from '$lib/types/api';
import { getSiteName } from '$lib/utils/title';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthForgotPasswordBody;
		const { email } = body;

		if (!email) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}

		// Find user by email
		const userList = await db.select().from(users).where(eq(users.email, email)).limit(1);

		// To prevent user enumeration, return success even if email doesn't exist
		if (userList.length > 0) {
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

			// Construct email content based on localized language
			const isChinese = event.locals.lang === 'zh-CN';
			const subject = `[${siteName}] ${t.auth.resetPasswordSubject}`;

			let text = '';
			let html = '';

			if (isChinese) {
				text = `您好 ${user.displayName}，\n\n我们收到了您在 ${siteName} 论坛的重置密码请求。请访问以下链接以重新设置您的密码（链接将在 48 小时后失效）：\n\n${resetLink}\n\n如果您没有发起该请求，请忽略此邮件。`;
				html = `<p>您好 <strong>${user.displayName}</strong>，</p>
<p>我们收到了您在 ${siteName} 论坛的重置密码请求。请点击下面的链接重新设置您的密码（链接将在 48 小时后失效）：</p>
<p><a href="${resetLink}" target="_blank">${resetLink}</a></p>
<p>如果您没有发起该请求，请忽略此邮件。</p>`;
			} else {
				text = `Hello ${user.displayName},\n\nWe received a password reset request for your account on ${siteName}. Please visit the link below to reset your password (valid for 48 hours):\n\n${resetLink}\n\nIf you did not request this, please ignore this email.`;
				html = `<p>Hello <strong>${user.displayName}</strong>,</p>
<p>We received a password reset request for your account on ${siteName}. Please click the link below to reset your password (valid for 48 hours):</p>
<p><a href="${resetLink}" target="_blank">${resetLink}</a></p>
<p>If you did not request this, please ignore this email.</p>`;
			}

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
