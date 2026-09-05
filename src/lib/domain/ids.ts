import type { Id } from './types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length);
	const c = globalThis.crypto;
	if (c && typeof c.getRandomValues === 'function') {
		c.getRandomValues(out);
		return out;
	}
	for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
	return out;
}

/**
 * Time-ordered unique id: 8 chars of base36 timestamp then 10 random chars.
 * Sorting by id therefore roughly matches creation order, which keeps
 * backup diffs and archive listings readable.
 */
export function newId(prefix = ''): Id {
	const stamp = Date.now().toString(36).padStart(9, '0');
	const bytes = randomBytes(10);
	let tail = '';
	for (const b of bytes) tail += ALPHABET[b % ALPHABET.length];
	return `${prefix}${stamp}${tail}`;
}

/** Stable per-install device identity, persisted in localStorage. */
const DEVICE_ID_KEY = 'hydrotracker.deviceId';

export function getDeviceId(): string {
	try {
		const existing = localStorage.getItem(DEVICE_ID_KEY);
		if (existing) return existing;
		const created = newId('dev-');
		localStorage.setItem(DEVICE_ID_KEY, created);
		return created;
	} catch {
		// Private mode with storage blocked: fall back to a per-run identity.
		return newId('dev-eph-');
	}
}
