/**
 * Determine whether a nav item should render as active given the current
 * pathname. The home route (`/`) is an exact match so it does not stay active on
 * every page; all other routes use a prefix match so sub-routes (e.g.
 * `/messages/inbox` under `/messages`) highlight their parent item.
 */
export function isNavActive(pathname: string, href: string): boolean {
	if (href === '/') return pathname === '/';
	return pathname.startsWith(href);
}
