// Admin pages are admin-only, data-heavy, and slow to query (pCloud WebDAV
// lists, DB aggregations). They render their own skeleton on entry and fetch
// data client-side, so SSR buys nothing and only delays the response while the
// server runs the slow query. The admin + root layout server loads still run
// (auth redirect, user/t/lang) and ship their data for hydration, so login
// state and titles never flash. See the per-page +page.svelte for the skeleton.
export const ssr = false;
