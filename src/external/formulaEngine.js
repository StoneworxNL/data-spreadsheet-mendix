import FormulaParser from "fast-formula-parser";

/*
 * Formula calculation for the grid. x-spreadsheet's own calculator knows 8 functions and reads cells as their shown
 * text, so this uses fast-formula-parser (MIT, ~280 Excel functions) instead. Cells are read as values: a loaded cell
 * as its value from the file, a typed cell as the number, boolean or text it looks like, a formula as its result.
 *
 * Loaded formulas are checked once against the result Excel saved: ones the parser calculates differently, or can't
 * calculate, keep showing Excel's value (see `isTrusted`).
 */

const MAX_DEPTH = 100;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export class FormulaEngine {
    /**
     * @param {Function} getSheets Returns the x-spreadsheet sheet data (DataProxy) list
     * @param {Function} getCell `(data, ri, ci) => cell` reading the stored cell
     */
    constructor(getSheets, getCell) {
        this.getSheets = getSheets;
        this.getCell = getCell;
        this.cache = new Map();
        this.evaluating = new Set();
        this.parsers = [];
    }

    // fast-formula-parser isn't re-entrant, and a formula reading another formula parses it from inside onCell, so
    // every nesting level gets its own parser
    parserAt(depth) {
        if (!this.parsers[depth]) {
            this.parsers[depth] = new FormulaParser({
                onCell: ({ sheet, row, col }) => this.valueAt(sheet, row - 1, col - 1),
                onRange: ({ sheet, from, to }) => {
                    const rows = [];
                    // Whole-column/row references are limited to the sheet's size
                    const data = this.sheetByName(sheet);
                    const lastRow = Math.min(to.row, data ? data.rows.len : to.row);
                    const lastCol = Math.min(to.col, data ? data.cols.len : to.col);
                    for (let r = from.row; r <= lastRow; r++) {
                        const line = [];
                        for (let c = from.col; c <= lastCol; c++) line.push(this.valueAt(sheet, r - 1, c - 1));
                        rows.push(line);
                    }
                    return rows;
                }
            });
        }
        return this.parsers[depth];
    }

    // A second engine that reads every loaded cell as Excel saved it, for isTrusted; kept, as parsers are costly to make
    getVerifier() {
        if (!this.verifier) {
            const verifier = new FormulaEngine(this.getSheets, this.getCell);
            verifier.valueAt = (sheetName, r, c) => {
                const sheet = verifier.sheetByName(sheetName);
                return sheet ? verifier.cellValue(sheet, r, c, true) : null;
            };
            this.verifier = verifier;
        }
        return this.verifier;
    }

    /** Forget cached results; call when cells change (the grid does this before each draw). */
    reset() {
        this.cache.clear();
    }

    sheetByName(name) {
        const sheets = this.getSheets();
        if (!name) return sheets[0];
        const wanted = String(name).toLowerCase();
        return sheets.find(data => String(data.name).toLowerCase() === wanted) || null;
    }

    valueAt(sheetName, ri, ci) {
        const data = this.sheetByName(sheetName);
        return data ? this.cellValue(data, ri, ci) : null;
    }

    /** The value of a cell: what a formula reading it sees. */
    cellValue(data, ri, ci, useSavedResults = false) {
        const cell = this.getCell(data, ri, ci);
        if (!cell) return null;
        const text = cell.text == null ? "" : String(cell.text);
        // The trust check compares with the file as Excel saved it, edits or not
        if (useSavedResults && cell.source && cell.source.cell) return fromSaved(cell.source.cell);
        const unedited = cell.source && cell.source.text === text && cell.source.cell;
        if (text[0] === "=" && text.length > 1) {
            if (unedited && (useSavedResults || !this.isTrusted(data, ri, ci, cell))) {
                return fromSaved(cell.source.cell);
            }
            const result = this.evaluate(data, ri, ci, text);
            return result.error ? result.error : result.value;
        }
        if (unedited) return fromSaved(cell.source.cell);
        return fromTyped(text);
    }

    /**
     * Calculates a formula in a cell.
     * @returns {{ value?: any, error?: string, unsupported?: boolean }}
     */
    evaluate(data, ri, ci, formula) {
        const key = `${data.name}!${ri}:${ci}`;
        if (this.cache.has(key)) return this.cache.get(key);
        if (this.evaluating.has(key) || this.evaluating.size > MAX_DEPTH) return { error: "#REF!" };
        const parser = this.parserAt(this.evaluating.size);
        this.evaluating.add(key);
        let result;
        try {
            const value = parser.parse(formula.slice(1), { sheet: data.name, row: ri + 1, col: ci + 1 });
            result = isFormulaError(value) ? { error: String(value) } : { value: unwrap(value) };
        } catch (e) {
            result = { error: "#NAME?", unsupported: true };
        } finally {
            this.evaluating.delete(key);
        }
        this.cache.set(key, result);
        return result;
    }

    /**
     * Whether a loaded formula is calculated like Excel did: with the cells it uses at their saved values, the parser
     * must give Excel's saved result. Checked once per cell.
     */
    isTrusted(data, ri, ci, cell) {
        const source = cell.source;
        if (source.trusted === undefined) {
            source.trusted = false;
            const verifier = this.getVerifier();
            const result = verifier.evaluate(data, ri, ci, source.text);
            source.trusted =
                !result.unsupported && sameValue(result.error || result.value, source.cell.v, source.cell.t);
        }
        return source.trusted;
    }
}

function fromSaved(cell) {
    if (cell.t === "e") return cell.w || "#N/A";
    return cell.v == null ? null : cell.v;
}

function fromTyped(text) {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    if (NUMBER.test(trimmed)) return Number(trimmed);
    if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return Number(trimmed.slice(0, -1)) / 100;
    const upper = trimmed.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return upper === "TRUE";
    return text;
}

// Array results (e.g. a range) show their first value, like Excel without dynamic arrays
function unwrap(value) {
    let result = value;
    while (Array.isArray(result)) result = result.length ? result[0] : null;
    return result;
}

function isFormulaError(value) {
    return Boolean(value) && typeof value === "object" && typeof value.error === "string";
}

function sameValue(actual, expected, type) {
    if (type === "n") {
        return typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
    }
    if (type === "b") return actual === expected;
    if (type === "e") return typeof actual === "string" && actual[0] === "#";
    return String(actual == null ? "" : actual) === String(expected == null ? "" : expected);
}
