import { nowMs } from '$lib/time/clock';
import { isStale } from '$lib/geo/coordinates';
import type { EpochMs, RecordedLocation } from '$lib/domain/types';

export type GeoStatus =
	'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable' | 'timeout' | 'suspended';

export const GEO_STATUS_LABELS: Record<GeoStatus, string> = {
	idle: 'GPS not started',
	requesting: 'Requesting position…',
	watching: 'Watching position',
	denied: 'Location permission denied',
	unavailable: 'Position unavailable on this device',
	timeout: 'Position request timed out',
	suspended: 'Paused (app was in the background)'
};

/**
 * Foreground-only position watching. The app never claims to track position
 * with the screen locked or in the background: when the page is hidden the
 * watch is treated as suspended and the last fix is labelled stale until a
 * fresh one arrives.
 */
export class GeoWatcher {
	status = $state<GeoStatus>('idle');
	lastFix = $state<RecordedLocation | null>(null);
	errorMessage = $state<string | null>(null);
	/** Bumped on a timer so age/stale labels re-render without a new fix. */
	tick = $state(nowMs());

	#watchId: number | null = null;
	#tickTimer: ReturnType<typeof setInterval> | null = null;
	#visibilityHandler: (() => void) | null = null;

	get supported(): boolean {
		return typeof navigator !== 'undefined' && 'geolocation' in navigator;
	}

	get isStale(): boolean {
		return isStale(this.lastFix?.fixTime ?? null, this.tick);
	}

	get fixAgeMs(): number | null {
		if (!this.lastFix?.fixTime) return null;
		return Math.max(0, this.tick - this.lastFix.fixTime);
	}

	start(): void {
		if (!this.supported) {
			this.status = 'unavailable';
			this.errorMessage = 'This browser does not expose the Geolocation API.';
			return;
		}
		if (this.#watchId !== null) return;
		this.status = 'requesting';
		this.errorMessage = null;
		this.#watchId = navigator.geolocation.watchPosition(
			(pos) => {
				this.status = 'watching';
				this.errorMessage = null;
				this.lastFix = {
					source: 'device-fix',
					latitude: pos.coords.latitude,
					longitude: pos.coords.longitude,
					accuracyMeters: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
					fixTime: pos.timestamp,
					capturedAt: nowMs()
				};
			},
			(err) => {
				// The last known fix is kept and labelled, never discarded.
				if (err.code === err.PERMISSION_DENIED) this.status = 'denied';
				else if (err.code === err.TIMEOUT) this.status = 'timeout';
				else this.status = 'unavailable';
				this.errorMessage = err.message || GEO_STATUS_LABELS[this.status];
			},
			{ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
		);

		this.#tickTimer = setInterval(() => {
			this.tick = nowMs();
		}, 1000);

		if (typeof document !== 'undefined') {
			this.#visibilityHandler = () => {
				if (document.visibilityState === 'hidden') {
					// Browsers throttle or suspend watches in the background.
					if (this.status === 'watching') this.status = 'suspended';
				} else if (this.status === 'suspended') {
					// Reacquire on return rather than trusting the old fix.
					this.status = 'requesting';
					this.restart();
				}
			};
			document.addEventListener('visibilitychange', this.#visibilityHandler);
		}
	}

	restart(): void {
		if (this.#watchId !== null && this.supported) {
			navigator.geolocation.clearWatch(this.#watchId);
			this.#watchId = null;
		}
		const keepTimer = this.#tickTimer;
		this.#tickTimer = null;
		this.start();
		if (keepTimer && this.#tickTimer !== keepTimer) clearInterval(keepTimer);
	}

	stop(): void {
		if (this.#watchId !== null && this.supported) {
			navigator.geolocation.clearWatch(this.#watchId);
		}
		this.#watchId = null;
		if (this.#tickTimer) clearInterval(this.#tickTimer);
		this.#tickTimer = null;
		if (this.#visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.#visibilityHandler);
		}
		this.#visibilityHandler = null;
		this.status = 'idle';
	}

	/** Snapshot of the current fix for attaching to a record. */
	snapshot(at: EpochMs = nowMs()): RecordedLocation | null {
		if (!this.lastFix) return null;
		return { ...this.lastFix, capturedAt: at };
	}
}

/**
 * Optional screen wake lock. Failure is expected on several browsers and is
 * reported rather than retried; the app never depends on it.
 */
interface WakeLockSentinelLike {
	release: () => Promise<void>;
	addEventListener?: (type: string, listener: () => void) => void;
}

export class WakeLock {
	active = $state(false);
	message = $state<string | null>(null);
	#sentinel: {
		release: () => Promise<void>;
		addEventListener?: (t: string, f: () => void) => void;
	} | null = null;

	get supported(): boolean {
		return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
	}

	async request(): Promise<void> {
		if (!this.supported) {
			this.message = 'Screen wake lock is not available in this browser.';
			return;
		}
		try {
			const nav = navigator as Navigator & {
				wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
			};
			this.#sentinel = await nav.wakeLock.request('screen');
			this.active = true;
			this.message = null;
			this.#sentinel?.addEventListener?.('release', () => {
				this.active = false;
			});
		} catch (err) {
			this.active = false;
			this.message = err instanceof Error ? err.message : 'Wake lock request was refused.';
		}
	}

	async release(): Promise<void> {
		try {
			await this.#sentinel?.release();
		} catch {
			/* releasing an already-released lock is not an error worth surfacing */
		}
		this.#sentinel = null;
		this.active = false;
	}
}

export const geoWatcher = new GeoWatcher();
export const wakeLock = new WakeLock();
