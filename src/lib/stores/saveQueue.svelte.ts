import { nowMs } from '$lib/time/clock';
import type { EpochMs, SaveState } from '$lib/domain/types';

export interface QueuedSave {
	id: string;
	label: string;
	/** Time the operator activated the control, not the time the write started. */
	captureTime: EpochMs;
	state: SaveState;
	error?: string;
	attempts: number;
	/** Re-runs the same write. Kept so a failed save stays retryable. */
	run: () => Promise<void>;
}

let counter = 0;

/**
 * Tracks every write the operator initiated. An entry moves to 'saved' only
 * after the database transaction resolves; a rejected transaction leaves a
 * visible, retryable 'failed' entry. Nothing here is ever silently dropped.
 */
export class SaveQueue {
	entries = $state<QueuedSave[]>([]);

	get pending(): QueuedSave[] {
		return this.entries.filter((e) => e.state === 'pending');
	}

	get failed(): QueuedSave[] {
		return this.entries.filter((e) => e.state === 'failed');
	}

	get hasFailures(): boolean {
		return this.entries.some((e) => e.state === 'failed');
	}

	/** Most recent terminal state, for the Live screen's save indicator. */
	get lastState(): SaveState | null {
		for (let i = this.entries.length - 1; i >= 0; i -= 1) {
			if (this.entries[i].state !== 'pending') return this.entries[i].state;
		}
		return this.entries.length > 0 ? 'pending' : null;
	}

	async submit(label: string, captureTime: EpochMs, run: () => Promise<void>): Promise<boolean> {
		counter += 1;
		const entry: QueuedSave = {
			id: `save-${counter}`,
			label,
			captureTime,
			state: 'pending',
			attempts: 0,
			run
		};
		this.entries = [...this.entries, entry];
		return this.attempt(entry.id);
	}

	async attempt(id: string): Promise<boolean> {
		const entry = this.entries.find((e) => e.id === id);
		if (!entry) return false;
		entry.attempts += 1;
		entry.state = 'pending';
		entry.error = undefined;
		try {
			await entry.run();
			entry.state = 'saved';
			this.prune();
			return true;
		} catch (err) {
			entry.state = 'failed';
			entry.error = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	async retryAll(): Promise<void> {
		for (const entry of this.failed) {
			// eslint-disable-next-line no-await-in-loop -- retries must stay ordered
			await this.attempt(entry.id);
		}
	}

	/** Keeps the list short by dropping old successes; failures always stay. */
	private prune(): void {
		const cutoff = nowMs() - 120_000;
		this.entries = this.entries.filter((e) => e.state !== 'saved' || e.captureTime > cutoff);
	}
}

export const saveQueue = new SaveQueue();
