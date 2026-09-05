import { getDb, type AnyDb } from './db';
import { nowMs } from '$lib/time/clock';

/** Non-record application state: current context, preferences, flags. */
export async function getSetting<T>(key: string, fallback: T, db: AnyDb = getDb()): Promise<T> {
	const row = await db.settings.get(key);
	return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown, db: AnyDb = getDb()): Promise<void> {
	await db.settings.put({ key, value, updatedAt: nowMs() });
}

export const SETTINGS_KEYS = {
	currentEventId: 'context.eventId',
	currentSessionId: 'context.sessionId',
	currentHeatId: 'context.heatId',
	currentLegId: 'context.legId',
	coordinateFormat: 'prefs.coordinateFormat',
	overdueThresholdMs: 'prefs.overdueThresholdMs',
	quickPhrases: 'prefs.quickPhrases',
	wakeLockPreferred: 'prefs.wakeLock',
	persistentStorageResult: 'storage.persistResult',
	pendingDraft: 'draft.capture',
	activeTabId: 'lock.activeTabId',
	activeTabHeartbeat: 'lock.activeTabHeartbeat'
} as const;
