import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { AuthType } from 'worker-mailer';

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	username?: string;
	password?: string;
	authType?: AuthType;
	fromName: string;
	fromEmail: string;
}

export interface MailOptions {
	to: string;
	toName?: string;
	subject: string;
	text: string;
	html: string;
}

export function resolveSmtpConfig(platformEnv: App.Platform['env'] | undefined): SmtpConfig {
	const envSource = {
		...privateEnv,
		...publicEnv,
		...(platformEnv || {}),
		...process.env
	} as Record<string, unknown>;

	const host = (envSource.SMTP_HOST as string) || '';
	const port = parseInt((envSource.SMTP_PORT as string) || '587', 10);
	const secure = (envSource.SMTP_SECURE as string) === 'true';
	const username = (envSource.SMTP_USERNAME as string) || undefined;
	const password = (envSource.SMTP_PASSWORD as string) || undefined;
	const authType = (envSource.SMTP_AUTH_TYPE as AuthType) || 'plain';
	const fromName =
		(envSource.SMTP_FROM_NAME as string) || (envSource.PUBLIC_SITE_NAME as string) || 'Janbao';
	const fromEmail = (envSource.SMTP_FROM_EMAIL as string) || username || 'noreply@janbao.local';

	return {
		host,
		port,
		secure,
		username,
		password,
		authType,
		fromName,
		fromEmail
	};
}

export async function sendEmail(
	options: MailOptions,
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	const config = resolveSmtpConfig(platformEnv);

	if (!config.host) {
		console.warn('SMTP_HOST is not configured. Email will be logged to console instead.');
		console.log('--- Send Email (Dry Run) ---');
		console.log(`To: ${options.toName || ''} <${options.to}>`);
		console.log(`Subject: ${options.subject}`);
		console.log(`Text:\n${options.text}`);
		console.log('----------------------------');
		return;
	}

	// SvelteKit local dev runs in Node/Bun process.
	// Production (Cloudflare Workers) does not have standard net sockets, so it uses worker-mailer.
	const isDev =
		typeof process !== 'undefined' &&
		!process.env.MINIFLARE &&
		(!!process.versions?.node || !!process.versions?.bun);

	if (isDev) {
		const nodemailer = await import('nodemailer');
		const transporter = nodemailer.createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth:
				config.username && config.password
					? {
							user: config.username,
							pass: config.password
						}
					: undefined
		});

		await transporter.sendMail({
			from: `"${config.fromName}" <${config.fromEmail}>`,
			to: options.toName ? `"${options.toName}" <${options.to}>` : options.to,
			subject: options.subject,
			text: options.text,
			html: options.html
		});
	} else {
		const { WorkerMailer } = await import('worker-mailer');
		const mailer = await WorkerMailer.connect({
			host: config.host,
			port: config.port,
			secure: config.secure,
			credentials:
				config.username && config.password
					? {
							username: config.username,
							password: config.password
						}
					: undefined,
			authType: config.authType
		});

		await mailer.send({
			from: { name: config.fromName, email: config.fromEmail },
			to: { name: options.toName || '', email: options.to },
			subject: options.subject,
			text: options.text,
			html: options.html
		});
	}
}
