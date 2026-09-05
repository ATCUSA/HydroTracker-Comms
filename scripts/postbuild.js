import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GitHub Pages has no SPA rewrite rule: a request for /timeline is a missing
 * file and it serves 404.html. Copying the app shell to 404.html means a deep
 * link still boots the app, which then routes client-side.
 *
 * Once the service worker is installed it answers navigations from the cache,
 * so this only matters for the very first visit to a deep link (and for anyone
 * who has cleared their cache).
 */
const dir = 'build';
const shell = join(dir, 'index.html');

if (!existsSync(shell)) {
	console.error(`postbuild: ${shell} not found — did the build run?`);
	process.exit(1);
}

copyFileSync(shell, join(dir, '404.html'));
console.log('postbuild: wrote build/404.html (SPA fallback for static hosts)');
