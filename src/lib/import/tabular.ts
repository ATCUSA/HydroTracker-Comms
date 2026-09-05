/**
 * Lineup import. The supplied Check List.xlsx layout is one possibility, not a
 * requirement: any sheet with a boat-number column can be mapped by hand, and
 * the operator sees a preview and validation result before anything is written.
 */

export type Cell = string;
export type Grid = Cell[][];

/** RFC 4180 style CSV/TSV reader; keeps quoted commas and embedded newlines. */
export function parseDelimited(text: string, delimiter = ','): Grid {
	const rows: Grid = [];
	let row: Cell[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	// Strip a UTF-8 BOM so the first header does not carry an invisible char.
	if (text.charCodeAt(0) === 0xfeff) i = 1;

	for (; i < text.length; i += 1) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
			continue;
		}
		if (c === '"') {
			inQuotes = true;
		} else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (c === '\r') {
			// handled by the \n branch
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function detectDelimiter(text: string): string {
	const head = text.split('\n').slice(0, 5).join('\n');
	const tabs = (head.match(/\t/g) ?? []).length;
	const semis = (head.match(/;/g) ?? []).length;
	const commas = (head.match(/,/g) ?? []).length;
	if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
	if (semis > commas) return ';';
	return ',';
}

export type LineupField = 'boatNumber' | 'className' | 'startOrder' | 'notes' | 'ignore';

export const LINEUP_FIELD_LABELS: Record<LineupField, string> = {
	boatNumber: 'Boat number',
	className: 'Class',
	startOrder: 'Starting order',
	notes: 'Notes',
	ignore: '— ignore —'
};

/** Best-guess mapping from header text. The operator can override every column. */
export function guessMapping(headers: Cell[]): LineupField[] {
	return headers.map((header) => {
		const h = header.toLowerCase().replace(/[^a-z]/g, '');
		if (!h) return 'ignore';
		if (h.includes('boat') || h === 'no' || h === 'num' || h.includes('number'))
			return 'boatNumber';
		if (h.includes('class') || h.includes('div')) return 'className';
		if (h.includes('order') || h.includes('position') || h.includes('seq') || h.includes('start'))
			return 'startOrder';
		if (h.includes('note') || h.includes('comment')) return 'notes';
		return 'ignore';
	});
}

export interface LineupRow {
	boatNumber: string;
	className: string;
	startOrder: number | null;
	notes: string;
}

export interface ImportIssue {
	rowIndex: number;
	message: string;
	severity: 'error' | 'warning';
}

export interface LineupPreview {
	rows: LineupRow[];
	issues: ImportIssue[];
	/** True when every row can be imported without loss. */
	valid: boolean;
}

/**
 * Turns a mapped grid into lineup rows. Boat numbers stay text so "007" keeps
 * its leading zeros; a numeric cell from a spreadsheet is stringified without
 * reformatting.
 */
export function buildLineupPreview(
	grid: Grid,
	mapping: LineupField[],
	hasHeaderRow: boolean
): LineupPreview {
	const body = hasHeaderRow ? grid.slice(1) : grid;
	const rows: LineupRow[] = [];
	const issues: ImportIssue[] = [];
	const seen = new Map<string, number>();

	const columnFor = (field: LineupField) => mapping.indexOf(field);
	const boatCol = columnFor('boatNumber');
	if (boatCol === -1) {
		issues.push({
			rowIndex: -1,
			message: 'No column is mapped to Boat number. Map one before importing.',
			severity: 'error'
		});
		return { rows: [], issues, valid: false };
	}
	const classCol = columnFor('className');
	const orderCol = columnFor('startOrder');
	const notesCol = columnFor('notes');

	body.forEach((raw, index) => {
		const boatNumber = (raw[boatCol] ?? '').trim();
		if (!boatNumber) {
			issues.push({
				rowIndex: index,
				message: 'Blank boat number — row skipped.',
				severity: 'warning'
			});
			return;
		}
		const orderText = orderCol >= 0 ? (raw[orderCol] ?? '').trim() : '';
		let startOrder: number | null = null;
		if (orderText) {
			const parsed = Number(orderText);
			if (Number.isFinite(parsed) && parsed > 0) startOrder = Math.floor(parsed);
			else
				issues.push({
					rowIndex: index,
					message: `Starting order "${orderText}" is not a positive number; order will follow row order.`,
					severity: 'warning'
				});
		}
		const previous = seen.get(boatNumber);
		if (previous !== undefined) {
			issues.push({
				rowIndex: index,
				message: `Boat ${boatNumber} also appears on row ${previous + 1}. Both rows are kept — remove one if that is a mistake.`,
				severity: 'warning'
			});
		} else {
			seen.set(boatNumber, index);
		}
		rows.push({
			boatNumber,
			className: classCol >= 0 ? (raw[classCol] ?? '').trim() : '',
			startOrder,
			notes: notesCol >= 0 ? (raw[notesCol] ?? '').trim() : ''
		});
	});

	if (rows.length === 0) {
		issues.push({ rowIndex: -1, message: 'No usable rows found.', severity: 'error' });
	}

	return { rows, issues, valid: !issues.some((i) => i.severity === 'error') };
}

/** Fills in missing order values by row position, then normalises to 1..n. */
export function resolveStartOrder(rows: LineupRow[]): LineupRow[] {
	const explicit = rows.filter((r) => r.startOrder !== null);
	const sorted =
		explicit.length === rows.length
			? [...rows].sort((a, b) => (a.startOrder ?? 0) - (b.startOrder ?? 0))
			: rows;
	return sorted.map((row, index) => ({ ...row, startOrder: index + 1 }));
}

/** Reads an .xlsx file in the browser. Lazily imported to keep the shell small. */
export async function readSpreadsheet(file: File): Promise<Grid> {
	const { default: readXlsxFile } = await import('read-excel-file');
	const rows = await readXlsxFile(file);
	return rows.map((row) =>
		row.map((cell) => {
			if (cell == null) return '';
			if (cell instanceof Date) return cell.toISOString();
			return String(cell);
		})
	);
}

export async function readTabularFile(file: File): Promise<Grid> {
	const name = file.name.toLowerCase();
	if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readSpreadsheet(file);
	const text = await file.text();
	return parseDelimited(text, detectDelimiter(text));
}
