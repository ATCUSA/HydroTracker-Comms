// The whole app is a client-side SPA served from a cached shell: every
// operational route must cold-open offline, and all data lives in IndexedDB.
export const ssr = false;
export const prerender = false;
export const csr = true;
export const trailingSlash = 'ignore';
