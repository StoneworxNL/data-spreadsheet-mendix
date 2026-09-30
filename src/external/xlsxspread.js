import * as XLSX from "xlsx";

/*! Adapted from xlsxspread.js (C) SheetJS LLC -- https://sheetjs.com/ */
/* Source https://cdn.sheetjs.com/xspreadsheet/xlsxspread.js */

/*
 * Every loaded cell keeps a JSON-safe copy of its original SheetJS cell (`source`), so cells the user did not edit
 * are written back exactly as they were read (type, value, number format, formula) instead of being re-typed from
 * their display text. The copy lives on the x-spreadsheet cell, so it moves along with row/column inserts and
 * survives x-spreadsheet's JSON-based undo history and copy/paste.
 */

// Column count of a blank x-spreadsheet sheet; fewer columns than this would leave the grid looking cut off
const DEFAULT_COLS = 26;

// Excel stores numbers as doubles, so longer digit strings (IDs, card numbers) would silently lose precision
const MAX_NUMBER_DIGITS = 15;
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const THOUSANDS_PATTERN = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

const MAX_SHEET_NAME_LENGTH = 31;
const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/g;

/**
 * Converts data from SheetJS to x-spreadsheet.
 * Read the workbook with `cellNF: true`, otherwise number formats (dates, currencies, percentages) are lost on save.
 *
 * @param  {Object} wb SheetJS workbook object
 * @param  {Object} [options]
 * @param  {number} [options.spareRows=0] Empty rows to add below the data, e.g. to type into in edit mode
 * @param  {number} [options.spareCols=0] Empty columns to add right of the data
 *
 * @returns {Object[]} An x-spreadsheet data
 */
export function stox(wb, { spareRows = 0, spareCols = 0 } = {}) {
    return wb.SheetNames.map(name => {
        const ws = wb.Sheets[name] || {};
        const rows = {};
        const merges = [];

        // Start from the sheet's used range, so empty rows/columns inside it are kept
        const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
        let lastRow = range ? range.e.r : -1;
        let lastCol = range ? range.e.c : -1;

        Object.keys(ws).forEach(ref => {
            if (ref[0] === "!") return;

            const cell = ws[ref];
            const text = cellText(cell);
            if (text === "") return;

            const { r, c } = XLSX.utils.decode_cell(ref);
            getRow(rows, r).cells[c] = { text, source: { text, cell: pickCell(cell) } };
            lastRow = Math.max(lastRow, r);
            lastCol = Math.max(lastCol, c);
        });

        (ws["!merges"] || []).forEach(merge => {
            const cells = getRow(rows, merge.s.r).cells;
            // Merged ranges can start on an empty cell
            cells[merge.s.c] = cells[merge.s.c] || {};
            cells[merge.s.c].merge = [merge.e.r - merge.s.r, merge.e.c - merge.s.c];
            merges.push(XLSX.utils.encode_range(merge));
            lastRow = Math.max(lastRow, merge.e.r);
            lastCol = Math.max(lastCol, merge.e.c);
        });

        // x-spreadsheet ignores a length of 0 and falls back to its 100-row default
        rows.len = Math.max(lastRow + 1 + spareRows, 1);

        return {
            name,
            rows,
            cols: { len: Math.max(lastCol + 1 + spareCols, DEFAULT_COLS) },
            merges
        };
    });
}

/**
 * Converts data from x-spreadsheet to SheetJS
 *
 * @param  {Object[]} sdata An x-spreadsheet data object
 *
 * @returns {Object} A SheetJS workbook object
 */
export function xtos(sdata) {
    const wb = XLSX.utils.book_new();
    const sheetNames = new Set();

    sdata.forEach(xws => {
        const ws = {};
        const merges = [];
        const rows = xws.rows || {};
        let lastRow = -1;
        let lastCol = -1;

        Object.keys(rows).forEach(rowKey => {
            const r = Number(rowKey);
            // Skips "len"
            if (!Number.isInteger(r) || !rows[rowKey] || !rows[rowKey].cells) return;

            const cells = rows[rowKey].cells;
            Object.keys(cells).forEach(colKey => {
                const c = Number(colKey);
                if (!Number.isInteger(c) || !cells[colKey]) return;

                const cell = toSheetCell(cells[colKey]);
                if (cell) {
                    ws[XLSX.utils.encode_cell({ r, c })] = cell;
                    lastRow = Math.max(lastRow, r);
                    lastCol = Math.max(lastCol, c);
                }

                const merge = cells[colKey].merge;
                if (merge) {
                    const end = { r: r + merge[0], c: c + merge[1] };
                    merges.push({ s: { r, c }, e: end });
                    lastRow = Math.max(lastRow, end.r);
                    lastCol = Math.max(lastCol, end.c);
                }
            });
        });

        if (merges.length) ws["!merges"] = merges;
        ws["!ref"] = lastRow < 0 ? "A1" : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });

        XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(xws.name, sheetNames));
    });

    return wb;
}

function getRow(rows, r) {
    rows[r] = rows[r] || { cells: {} };
    return rows[r];
}

// What the grid shows: the formula for formula cells, otherwise the value formatted as Excel displays it
function cellText(cell) {
    if (cell.f) return "=" + cell.f;
    const text = XLSX.utils.format_cell(cell);
    return text == null ? "" : String(text);
}

// The parts of a SheetJS cell needed to write it back unchanged; all JSON-safe (dates are serial numbers)
function pickCell(cell) {
    const picked = { t: cell.t, v: cell.v };
    if (cell.z != null) picked.z = cell.z;
    if (cell.f != null) picked.f = cell.f;
    return picked;
}

// SheetJS cell for an x-spreadsheet cell, or null when it has no content
function toSheetCell({ text, source }) {
    const value = text == null ? "" : String(text);
    if (source && source.text === value) {
        return { ...source.cell };
    }
    return parseCell(value, source);
}

// Types an edited cell from its text the way Excel types input; anything ambiguous stays text
function parseCell(text, source) {
    if (text === "") return null;

    if (text[0] === "=" && text.length > 1) {
        // x-spreadsheet doesn't expose the calculated result, so none is cached. Excel recalculates on open because
        // SheetJS writes no calcPr; an empty string (rather than no value) keeps SheetJS reading the formula back.
        return { t: "s", v: "", f: text.slice(1) };
    }

    const upper = text.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
        return { t: "b", v: upper === "TRUE" };
    }

    const wasNumber = Boolean(source) && source.cell.t === "n";
    const number = parseNumber(text, wasNumber);
    if (number !== null) {
        const cell = { t: "n", v: number };
        if (wasNumber && source.cell.z != null) {
            // Keep the cell's date/currency/percentage format when a new number is typed into it
            cell.z = source.cell.z;
        } else if (text.endsWith("%")) {
            cell.z = text.includes(".") ? "0.00%" : "0%";
        }
        return cell;
    }

    return { t: "s", v: text };
}

function parseNumber(text, wasNumber) {
    const isPercent = text.endsWith("%");
    let body = isPercent ? text.slice(0, -1) : text;

    // Number formats display thousands separated by "," so accept that when a number is edited. Not for new input,
    // where "1,500" may well mean 1.5 with a decimal comma.
    if (wasNumber && THOUSANDS_PATTERN.test(body)) body = body.replace(/,/g, "");

    if (!NUMBER_PATTERN.test(body)) return null;

    // Leading zeros usually mean an identifier ("007", postal codes) unless the cell already held a number
    if (!wasNumber && /^[+-]?0\d/.test(body)) return null;

    const significantDigits = body.replace(/e.*$/i, "").replace(/\D/g, "").replace(/^0+/, "");
    if (significantDigits.length > MAX_NUMBER_DIGITS) return null;

    const number = Number(body);
    return isPercent ? number / 100 : number;
}

// Excel sheet names: at most 31 characters, none of : \ / ? * [ ], no leading/trailing apostrophe, and unique
// ignoring case. x-spreadsheet lets users rename sheets freely, and SheetJS throws on invalid names.
function uniqueSheetName(name, taken) {
    const base =
        String(name || "")
            .replace(INVALID_SHEET_NAME_CHARS, "_")
            .slice(0, MAX_SHEET_NAME_LENGTH)
            .replace(/^'+|'+$/g, "") || "Sheet";

    let candidate = base;
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
        const suffix = ` (${i})`;
        candidate = base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
}
