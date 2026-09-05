/**
 * Spreadsheet-safe text handling.
 *
 * A cell that begins with =, +, -, @, tab or carriage return is interpreted as
 * a formula by Excel, LibreOffice and Sheets. Operator notes and boat numbers
 * are user text, so they are prefixed with an apostrophe before export — the
 * value is preserved and never evaluated.
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeSpreadsheetText(value: unknown): string {
	if (value == null) return '';
	const text = String(value);
	if (text.length > 0 && FORMULA_LEADERS.includes(text[0])) return `'${text}`;
	return text;
}

/** RFC 4180 quoting on top of formula escaping. */
export function csvCell(value: unknown): string {
	const text = escapeSpreadsheetText(value);
	if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
	return text;
}

export function toCsv(rows: unknown[][]): string {
	return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export interface Sheet {
	name: string;
	rows: unknown[][];
}

export function download(filename: string, content: BlobPart, mime: string): void {
	const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Give the browser a moment to start the download before revoking.
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Filename-safe slug that keeps station and date legible. */
export function slug(text: string): string {
	return (
		text
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.slice(0, 60) || 'log'
	);
}
