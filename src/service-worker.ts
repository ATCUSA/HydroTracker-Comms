/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

/**
 * Every asset the app needs offline is bundled and precached here. Nothing is
 * fetched from a CDN at runtime, so a prepared device works with no network.
 *
 * The worker never takes over an open session on its own: it waits in the
 * 'installed' state until the page explicitly posts SKIP_WAITING, which the app
 * only does at an operator-chosen idle moment.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `safety-log-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			// Deliberately no skipWaiting(): an update must not reload a live log.
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') sw.skipWaiting();
	if (event.data?.type === 'CHECK_ASSETS') {
		event.waitUntil(
			(async () => {
				const cache = await caches.open(CACHE);
				const missing: string[] = [];
				for (const asset of PRECACHE) {
					if (!(await cache.match(asset))) missing.push(asset);
				}
				const source = event.source as Client | null;
				source?.postMessage({ type: 'ASSET_REPORT', total: PRECACHE.length, missing });
			})()
		);
	}
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Build output is content-hashed, so a cache hit is always correct.
			if (PRECACHE.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch {
				const cached = await cache.match(request);
				if (cached) return cached;
				// SPA navigation offline: serve the cached shell so any route
				// can be cold-opened with no network.
				if (request.mode === 'navigate') {
					const shell = (await cache.match('/index.html')) ?? (await cache.match('/'));
					if (shell) return shell;
				}
				return new Response('Offline and this resource is not cached.', {
					status: 503,
					headers: { 'content-type': 'text/plain' }
				});
			}
		})()
	);
});
