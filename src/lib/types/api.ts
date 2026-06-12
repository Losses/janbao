import type { CookieSerializeOptions } from 'cookie';

export interface AuthRegisterBody {
	invitationCode?: string;
	username?: string;
	email?: string;
	password?: string;
	confirmPassword?: string;
	displayName?: string;
}

export interface AuthLoginBody {
	usernameOrEmail?: string;
	password?: string;
	rememberMe?: boolean;
}

export interface ApiResponse {
	success?: boolean;
	error?: string;
	userId?: string;
}

export interface SessionCookieOptions extends CookieSerializeOptions {
	path: string;
}
