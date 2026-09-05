import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

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
		version: {
			pollInterval: 0
		}
	}
};

export default config;
