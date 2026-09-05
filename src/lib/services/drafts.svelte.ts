import { getSetting, setSetting } from '$lib/db/settings';

/**
 * Persists in-progress form state so a reload, a crash or the browser
 * reclaiming the tab does not cost the operator what they had typed. Drafts are
 * deliberately separate from records: a draft is not a log entry, and restoring
 * one never creates an observation.
 */
export class Draft<T extends Record<string, unknown>> {
	value = $state<T>({} as T);
	loaded = $state(false);

	#key: string;
	#defaults: T;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(key: string, defaults: T) {
		this.#key = `draft.${key}`;
		this.#defaults = defaults;
		this.value = { ...defaults };
	}

	async load(): Promise<void> {
		const stored = await getSetting<Partial<T> | null>(this.#key, null);
		this.value = { ...this.#defaults, ...(stored ?? {}) };
		this.loaded = true;
	}

	/** Debounced so typing does not write to IndexedDB on every keystroke. */
	save(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void setSetting(this.#key, this.value);
		}, 400);
	}

	set<K extends keyof T>(field: K, value: T[K]): void {
		this.value = { ...this.value, [field]: value };
		this.save();
	}

	async clear(): Promise<void> {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.value = { ...this.#defaults };
		await setSetting(this.#key, null);
	}
}
