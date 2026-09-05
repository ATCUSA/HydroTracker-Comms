import { escapeSpreadsheetText, type Sheet } from './csv';

/**
 * Real .xlsx output (a zipped OOXML workbook), not a CSV with a spreadsheet
 * extension. Every value is written as text after formula escaping, which keeps
 * boat numbers like "007" and "4B" intact.
 */
export async function buildXlsxBlob(sheets: Sheet[]): Promise<Blob> {
	const { default: writeXlsxFile } = await import('write-excel-file');
	const data = sheets.map((sheet) =>
		sheet.rows.map((row) =>
			row.map((cell) => ({ type: String, value: escapeSpreadsheetText(cell) }))
		)
	);
	// write-excel-file returns a Blob in the browser when no filePath is given.
	const blob = (await writeXlsxFile(
		data as never,
		{
			sheets: sheets.map((s) => s.name.slice(0, 31)),
			buffer: false
		} as never
	)) as unknown as Blob;
	return blob;
}
