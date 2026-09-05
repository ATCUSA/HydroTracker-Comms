import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Set BASE_PATH when the app is served from a subdirectory rather than a domain
 * root — a GitHub Pages project site lives at /<repo>, for example. Left unset
 * for local development and the test suites, which serve from the root.
 */
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Static SPA: every operational route is served by the same cached shell,
		// so cold-opening any screen works offline.
		adapter: adapter({ fallback: 'index.html', strict: false }),
		serviceWorker: {
			// We register manually at an operator-chosen moment; see src/lib/sw-client.ts.
			register: false
		},
		alias: {
			$lib: 'src/lib'
		},
		paths: {
			// Absolute, not relative: one document serves every route in this SPA, so
			// a path relative to "the current page" would resolve differently
			// depending on which URL the operator opened.
			base,
			relative: false
		},
		version: {
			pollInterval: 0
		}
	}
};

export default config;
