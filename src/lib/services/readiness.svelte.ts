import { verifyDatabaseWritable } from '$lib/db/repo';
import { getSetting, setSetting, SETTINGS_KEYS } from '$lib/db/settings';
import { nowMs } from '$lib/time/clock';

export type ReadinessLevel = 'unknown' | 'ready' | 'partial' | 'not-ready';

export interface AssetReport {
	total: number;
	missing: string[];
}

/**
 * Offline readiness is reported separately from connectivity: being online
 * says nothing about whether this device can work without a network, and being
 * offline says nothing about whether the cache is complete.
 */
export class Readiness {
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	serviceWorkerState = $state<'unsupported' | 'none' | 'installing' | 'active' | 'error'>('none');
	assets = $state<AssetReport | null>(null);
	databaseWritable = $state<boolean | null>(null);
	persistentStorage = $state<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
	storageEstimate = $state<{ usage: number; quota: number } | null>(null);
	updateWaiting = $state(false);
	lastCheckedAt = $state<number | null>(null);
	checking = $state(false);

	get level(): ReadinessLevel {
		if (this.lastCheckedAt === null) return 'unknown';
		if (this.databaseWritable === false) return 'not-ready';
		if (this.serviceWorkerState !== 'active') return 'not-ready';
		if (this.assets && this.assets.missing.length > 0) return 'partial';
		return 'ready';
	}

	get levelLabel(): string {
		switch (this.level) {
			case 'ready':
				return 'Offline ready';
			case 'partial':
				return 'Partly cached';
			case 'not-ready':
				return 'NOT offline ready';
			default:
				return 'Readiness not checked';
		}
	}

	bindConnectivity(): () => void {
		if (typeof window === 'undefined') return () => {};
		const on = () => (this.online = true);
		const off = () => (this.online = false);
		window.addEventListener('online', on);
		window.addEventListener('offline', off);
		return () => {
			window.removeEventListener('online', on);
			window.removeEventListener('offline', off);
		};
	}

	async register(): Promise<void> {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
			this.serviceWorkerState = 'unsupported';
			return;
		}
		try {
			const reg = await navigator.serviceWorker.register(
				import.meta.env.DEV ? '/service-worker.js' : '/service-worker.js',
				{ type: import.meta.env.DEV ? 'module' : 'classic' }
			);
			this.serviceWorkerState = reg.active ? 'active' : 'installing';
			if (reg.waiting) this.updateWaiting = true;
			reg.addEventListener('updatefound', () => {
				const installing = reg.installing;
				installing?.addEventListener('statechange', () => {
					if (installing.state === 'installed' && navigator.serviceWorker.controller) {
						// Staged, not applied. The operator chooses when to reload.
						this.updateWaiting = true;
					}
					if (installing.state === 'activated') this.serviceWorkerState = 'active';
				});
			});
			navigator.serviceWorker.addEventListener('message', (event) => {
				if (event.data?.type === 'ASSET_REPORT') {
					this.assets = { total: event.data.total, missing: event.data.missing };
				}
			});
			const ready = await navigator.serviceWorker.ready;
			if (ready.active) this.serviceWorkerState = 'active';
		} catch (err) {
			this.serviceWorkerState = 'error';
			console.error('Service worker registration failed', err);
		}
	}

	/** Applies a staged update. Only ever called from an explicit operator action. */
	async applyStagedUpdate(): Promise<void> {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration();
		reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
		location.reload();
	}

	async requestPersistentStorage(): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
			this.persistentStorage = 'unsupported';
			return;
		}
		try {
			const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
			const granted = already || (await navigator.storage.persist());
			this.persistentStorage = granted ? 'granted' : 'denied';
			await setSetting(SETTINGS_KEYS.persistentStorageResult, this.persistentStorage);
		} catch {
			this.persistentStorage = 'denied';
		}
	}

	async check(): Promise<void> {
		this.checking = true;
		try {
			this.databaseWritable = await verifyDatabaseWritable().catch(() => false);
			if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
				const reg = await navigator.serviceWorker.getRegistration();
				this.serviceWorkerState = reg?.active ? 'active' : reg ? 'installing' : 'none';
				reg?.active?.postMessage({ type: 'CHECK_ASSETS' });
			}
			if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
				const est = await navigator.storage.estimate();
				this.storageEstimate = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
			}
			if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
				this.persistentStorage = (await navigator.storage.persisted())
					? 'granted'
					: ((await getSetting<string>(SETTINGS_KEYS.persistentStorageResult, 'unknown')) as
							'unknown' | 'denied');
			}
			this.lastCheckedAt = nowMs();
		} finally {
			this.checking = false;
		}
	}
}

export const readiness = new Readiness();
