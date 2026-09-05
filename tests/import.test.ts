import { describe, expect, it } from 'vitest';
import {
	buildLineupPreview,
	detectDelimiter,
	guessMapping,
	parseDelimited,
	resolveStartOrder,
	type LineupField
} from '../src/lib/import/tabular';
import { parseBoatList } from '../src/lib/services/setup';

describe('delimited parsing', () => {
	it('reads a simple CSV', () => {
		expect(parseDelimited('a,b\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('keeps quoted commas and embedded newlines intact', () => {
		expect(parseDelimited('boat,note\n007,"towed, then repaired"')).toEqual([
			['boat', 'note'],
			['007', 'towed, then repaired']
		]);
		expect(parseDelimited('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
	});

	it('unescapes doubled quotes', () => {
		expect(parseDelimited('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
	});

	it('handles CRLF and strips a BOM', () => {
		expect(parseDelimited('﻿a,b\r\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('drops blank rows', () => {
		expect(parseDelimited('a\n\n\nb')).toEqual([['a'], ['b']]);
	});

	it('detects tab and semicolon delimiters', () => {
		expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
		expect(detectDelimiter('a;b\n1;2')).toBe(';');
		expect(detectDelimiter('a,b\n1,2')).toBe(',');
	});
});

describe('column mapping', () => {
	it('guesses common headers', () => {
		expect(guessMapping(['Boat #', 'Class', 'Starting Order', 'Notes'])).toEqual([
			'boatNumber',
			'className',
			'startOrder',
			'notes'
		]);
	});

	it('ignores columns it cannot place', () => {
		expect(guessMapping(['Driver name', ''])).toEqual(['ignore', 'ignore']);
	});

	it('accepts a layout that does not match the printed checklist', () => {
		// Columns in a different order, with unrelated columns in between.
		const grid = [
			['Team', 'Div', 'Hull no.', 'Sponsor'],
			['Alpha', 'A', '007', 'Someone'],
			['Bravo', 'B', '4B', 'Another']
		];
		const mapping: LineupField[] = ['ignore', 'className', 'boatNumber', 'ignore'];
		const preview = buildLineupPreview(grid, mapping, true);
		expect(preview.valid).toBe(true);
		expect(preview.rows).toEqual([
			{ boatNumber: '007', className: 'A', startOrder: null, notes: '' },
			{ boatNumber: '4B', className: 'B', startOrder: null, notes: '' }
		]);
	});
});

describe('lineup preview', () => {
	const grid = [
		['Order', 'Boat', 'Class'],
		['1', '007', 'A'],
		['2', '12', 'A'],
		['3', '4B', 'B']
	];
	const mapping: LineupField[] = ['startOrder', 'boatNumber', 'className'];

	it('keeps boat numbers as text with leading zeros and letters', () => {
		const preview = buildLineupPreview(grid, mapping, true);
		expect(preview.rows.map((r) => r.boatNumber)).toEqual(['007', '12', '4B']);
	});

	it('refuses to import without a boat-number column', () => {
		const preview = buildLineupPreview(grid, ['ignore', 'ignore', 'ignore'], true);
		expect(preview.valid).toBe(false);
		expect(preview.issues[0].message).toMatch(/No column is mapped to Boat number/);
	});

	it('skips blank boat numbers with a warning rather than failing', () => {
		const preview = buildLineupPreview([...grid, ['4', '', '']], mapping, true);
		expect(preview.valid).toBe(true);
		expect(preview.rows).toHaveLength(3);
		expect(preview.issues.some((i) => i.message.includes('Blank boat number'))).toBe(true);
	});

	it('warns about a duplicate boat but keeps both rows', () => {
		const preview = buildLineupPreview([...grid, ['4', '007', 'A']], mapping, true);
		expect(preview.rows).toHaveLength(4);
		expect(preview.issues.some((i) => i.message.includes('also appears'))).toBe(true);
		expect(preview.valid).toBe(true);
	});

	it('warns about an unreadable starting order and falls back to row order', () => {
		const preview = buildLineupPreview(
			[
				['Order', 'Boat', 'Class'],
				['first', '007', 'A']
			],
			mapping,
			true
		);
		expect(preview.issues[0].message).toMatch(/not a positive number/);
		expect(resolveStartOrder(preview.rows)[0].startOrder).toBe(1);
	});

	it('fails when there are no usable rows', () => {
		const preview = buildLineupPreview([['Order', 'Boat', 'Class']], mapping, true);
		expect(preview.valid).toBe(false);
	});

	it('honours a header-row toggle', () => {
		const preview = buildLineupPreview([['1', '007', 'A']], mapping, false);
		expect(preview.rows).toHaveLength(1);
	});

	it('sorts by an explicit order and renumbers to 1..n', () => {
		const rows = [
			{ boatNumber: '12', className: '', startOrder: 5, notes: '' },
			{ boatNumber: '007', className: '', startOrder: 2, notes: '' }
		];
		expect(resolveStartOrder(rows).map((r) => [r.boatNumber, r.startOrder])).toEqual([
			['007', 1],
			['12', 2]
		]);
	});
});

describe('pasted lineups', () => {
	it('splits on newlines, commas, semicolons and tabs', () => {
		expect(parseBoatList('007\n12, 4B;31\t88')).toEqual(['007', '12', '4B', '31', '88']);
	});

	it('drops empty entries and trims whitespace', () => {
		expect(parseBoatList('  007  ,, \n 12 \n')).toEqual(['007', '12']);
	});
});
