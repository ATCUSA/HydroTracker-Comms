/**
 * Only one tab per device should be writing the log. The lock lives in
 * localStorage with a heartbeat, so a crashed tab releases it after a few
 * seconds instead of locking the operator out. Losing the lock makes a tab
 * read-only; it never discards anything already captured.
 */
const KEY = 'hydrotracker.activeTab';
const HEARTBEAT_MS = 2000;
const STALE_MS = 6000;

interface LockRecord {
	tabId: string;
	at: number;
}

function read(): LockRecord | null {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as LockRecord) : null;
	} catch {
		return null;
	}
}

function write(record: LockRecord): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(record));
	} catch {
		/* storage blocked: fall back to letting this tab log */
	}
}

export function claimLoggingTab(tabId: string, onChange: (isOwner: boolean) => void): () => void {
	if (typeof window === 'undefined') return () => {};

	const evaluate = () => {
		const current = read();
		const now = Date.now();
		const free = !current || current.tabId === tabId || now - current.at > STALE_MS;
		if (free) {
			write({ tabId, at: now });
			onChange(true);
		} else {
			onChange(false);
		}
	};

	evaluate();
	const timer = setInterval(evaluate, HEARTBEAT_MS);
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEY) evaluate();
	};
	window.addEventListener('storage', onStorage);

	return () => {
		clearInterval(timer);
		window.removeEventListener('storage', onStorage);
	};
}

export function releaseLoggingTab(tabId: string): void {
	const current = read();
	if (current?.tabId === tabId) {
		try {
			localStorage.removeItem(KEY);
		} catch {
			/* nothing to do */
		}
	}
}
