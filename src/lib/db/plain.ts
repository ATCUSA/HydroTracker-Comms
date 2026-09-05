/**
 * IndexedDB stores values with the structured clone algorithm, which throws a
 * DataCloneError on a Proxy. Svelte 5 wraps reactive objects and arrays in
 * proxies, so any record that has passed through component state — an edited
 * event, an incident with a boat-number array, a parsed backup held in $state —
 * has to be flattened before it is written.
 *
 * Every record in this app is JSON-shaped (primitives, plain objects, arrays
 * and null; no Dates, Maps or undefined that matter), so a JSON round-trip is a
 * faithful and cheap way to strip the proxies.
 */
export function toStorable<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
