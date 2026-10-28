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
 * @param  {Object} [options.layout] Styles, sizes and frozen panes from `readLayout` (ooxml.js), in sheet order
 *
 * @returns {Object[]} An x-spreadsheet data
 */
export function stox(wb, { spareRows = 0, spareCols = 0, layout = null } = {}) {
    return wb.SheetNames.map((name, sheetIndex) => {
        const ws = wb.Sheets[name] || {};
        const rows = {};
        const merges = [];
        const sheetLayout = layout && layout.sheets[sheetIndex];

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
            const source = { text, cell: pickCell(cell) };
            // Excel's result for formula cells, shown while the formula is unedited (see renderPatches.js)
            if (cell.f) source.display = formattedValue(cell);
            getRow(rows, r).cells[c] = { text, source };
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

        const cols = {};
        const sheet = { name, rows, cols, merges };
        if (sheetLayout) {
            const extent = applyLayout(sheet, ws, sheetLayout);
            lastRow = Math.max(lastRow, extent.lastRow);
            lastCol = Math.max(lastCol, extent.lastCol);
        }

        // x-spreadsheet ignores a length of 0 and falls back to its 100-row default
        rows.len = Math.max(lastRow + 1 + spareRows, 1);
        cols.len = Math.max(lastCol + 1 + spareCols, DEFAULT_COLS);
        if (sheetLayout) applySizes(sheet, sheetLayout);

        return sheet;
    });
}

/**
 * Grid-wide x-spreadsheet options that make a loaded workbook look like it does in Excel: the workbook's default
 * font, Excel's bottom alignment, and the first sheet's default row height and column width.
 *
 * @param {Object} [layout] From `readLayout` (ooxml.js)
 * @returns {Object} Options to pass to `new Spreadsheet(el, options)`
 */
export function spreadsheetOptions(layout) {
    if (!layout) return {};
    const first = layout.sheets[0];
    const { name, size } = layout.defaultFont;
    return {
        style: { valign: "bottom", font: { name, size, bold: false, italic: false } },
        ...(first && {
            row: { height: first.defaultRowHeight, len: 100 },
            col: { width: first.defaultColWidth, len: DEFAULT_COLS, indexWidth: 60, minWidth: 20 }
        })
    };
}

// Adds cell styles and frozen panes; returns the last row/column that holds a styled (possibly empty) cell
function applyLayout(sheet, ws, sheetLayout) {
    const styles = [];
    const styleIndexes = new Map();
    const addStyle = style => {
        const key = JSON.stringify(style);
        if (!styleIndexes.has(key)) {
            styleIndexes.set(key, styles.length);
            styles.push(style);
        }
        return styleIndexes.get(key);
    };

    let lastRow = -1;
    let lastCol = -1;
    const styled = new Set(Object.keys(sheetLayout.cellStyles));
    // Number cells without an explicit alignment are right-aligned in Excel ("General" alignment)
    Object.keys(ws).forEach(ref => {
        if (ref[0] !== "!" && (ws[ref].t === "n" || ws[ref].t === "d" || ws[ref].t === "b")) styled.add(ref);
    });

    styled.forEach(ref => {
        const { r, c } = XLSX.utils.decode_cell(ref);
        let style = sheetLayout.cellStyles[ref] || null;
        const cell = ws[ref];
        if (cell && (!style || !style.align)) {
            const general =
                cell.t === "b" || cell.t === "e" ? "center" : cell.t === "n" || cell.t === "d" ? "right" : null;
            if (general) style = { ...style, align: general, autoAlign: true };
        }
        if (!style) return;
        if (style.font) style = { ...style, font: { ...style.font } };

        const cells = getRow(sheet.rows, r).cells;
        cells[c] = cells[c] || {};
        cells[c].style = addStyle(style);
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
    });

    sheet.styles = styles;
    if (sheetLayout.freeze) sheet.freeze = sheetLayout.freeze;
    return { lastRow, lastCol };
}

// Column widths and row heights, including hidden ones. Every column gets a width because sheets can have different
// default widths, while x-spreadsheet has one default for the whole grid.
function applySizes(sheet, sheetLayout) {
    const { cols, rows } = sheet;
    for (let c = 0; c < cols.len; c++) {
        const col = sheetLayout.cols[c];
        cols[c] = { width: (col && col.width) || sheetLayout.defaultColWidth };
        if (col && col.hidden) cols[c].hide = true;
    }
    Object.keys(sheetLayout.rows).forEach(key => {
        const r = Number(key);
        if (r >= rows.len) return;
        const { height, hidden } = sheetLayout.rows[key];
        const row = getRow(rows, r);
        if (height) row.height = height;
        if (hidden) row.hide = true;
    });
}

/**
 * Converts data from x-spreadsheet to SheetJS
 *
 * Cells get a `s` style object in the format xlsx-js-style writes (font, fill, border, alignment), and sheets get
 * column widths and row heights. The SheetJS community writer ignores both, so they cost nothing there.
 *
 * @param  {Object[]} sdata An x-spreadsheet data object
 * @param  {Object} [options]
 * @param  {Object} [options.defaultStyle] The grid's default x-spreadsheet style, which cell styles override
 *
 * @returns {Object} A SheetJS workbook object
 */
export function xtos(sdata, { defaultStyle = null } = {}) {
    const wb = XLSX.utils.book_new();
    const sheetNames = new Set();

    sdata.forEach(xws => {
        const ws = {};
        const merges = [];
        const rows = xws.rows || {};
        const styles = xws.styles || [];
        const sheetStyles = styles.map(style => toSheetStyle(style, defaultStyle));
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

                const style = cells[colKey].style !== undefined ? sheetStyles[cells[colKey].style] : null;
                let cell = toSheetCell(cells[colKey]);
                // Keep empty cells that carry a fill or border
                if (!cell && style) cell = { t: "z" };
                if (cell) {
                    if (style) cell.s = style;
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
        writeSizes(ws, xws, lastRow, lastCol);

        XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(xws.name, sheetNames));
    });

    return wb;
}

// Widths/heights set on the grid (loaded from the file or resized by the user), up to the used range
function writeSizes(ws, xws, lastRow, lastCol) {
    const cols = [];
    Object.keys(xws.cols || {}).forEach(key => {
        const c = Number(key);
        const col = xws.cols[key];
        if (!Number.isInteger(c) || c > lastCol || !col) return;
        // Written as Excel's own width unit; SheetJS converts `wpx` with a different digit width than Excel's
        if (col.width || col.hide) {
            cols[c] = { ...(col.width && { width: pixelsToChars(col.width) }), ...(col.hide && { hidden: true }) };
        }
    });
    if (cols.length) ws["!cols"] = fillHoles(cols);

    const rows = [];
    Object.keys(xws.rows || {}).forEach(key => {
        const r = Number(key);
        const row = xws.rows[key];
        if (!Number.isInteger(r) || r > lastRow || !row) return;
        if (row.height || row.hide) {
            rows[r] = { ...(row.height && { hpt: (row.height * 72) / 96 }), ...(row.hide && { hidden: true }) };
        }
    });
    if (rows.length) ws["!rows"] = fillHoles(rows);
}

// Inverse of the pixel width Excel shows for a column width (characters of a 7px-wide digit, plus padding)
function pixelsToChars(px) {
    return Math.round((px / 7) * 256) / 256;
}

// SheetJS skips holes in !cols/!rows only when they are real entries
function fillHoles(list) {
    return Array.from(list, item => item || {});
}

/**
 * x-spreadsheet style to the cell style xlsx-js-style writes.
 * Colours are written as RGB; Excel shows them the same as the theme colours they came from.
 */
export function toSheetStyle(style, defaultStyle) {
    if (!style) return null;
    const merged = { ...defaultStyle, ...style, font: { ...(defaultStyle && defaultStyle.font), ...style.font } };
    const s = {};

    const font = {};
    if (merged.font.name) font.name = merged.font.name;
    if (merged.font.size) font.sz = merged.font.size;
    if (merged.font.bold) font.bold = true;
    if (merged.font.italic) font.italic = true;
    if (merged.underline) font.underline = true;
    if (merged.strike) font.strike = true;
    const color = toRgb(merged.color);
    if (color && color !== "000000" && color !== "0A0A0A") font.color = { rgb: color };
    if (Object.keys(font).length) s.font = font;

    const fill = toRgb(style.bgcolor);
    if (fill) s.fill = { patternType: "solid", fgColor: { rgb: fill } };

    if (style.border) {
        const border = {};
        ["top", "bottom", "left", "right"].forEach(side => {
            const value = style.border[side];
            if (value && value[0]) border[side] = { style: value[0], color: { rgb: toRgb(value[1]) || "000000" } };
        });
        if (Object.keys(border).length) s.border = border;
    }

    const alignment = {};
    // Alignment the loader added for Excel's "General" alignment isn't written back as an explicit setting
    if (style.align && !(style.autoAlign && (style.align === "right" || style.align === "center"))) {
        alignment.horizontal = style.align;
    }
    if (style.valign) alignment.vertical = style.valign === "middle" ? "center" : style.valign;
    if (style.textwrap) alignment.wrapText = true;
    if (Object.keys(alignment).length) s.alignment = alignment;

    return Object.keys(s).length ? s : null;
}

function toRgb(color) {
    if (!color || typeof color !== "string") return null;
    let hex = color.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, ch => ch + ch);
    if (/^rgba?\(/i.test(color)) {
        const parts = color.match(/\d+/g) || [];
        hex = parts
            .slice(0, 3)
            .map(n => Number(n).toString(16).padStart(2, "0"))
            .join("");
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
}

function getRow(rows, r) {
    rows[r] = rows[r] || { cells: {} };
    return rows[r];
}

// What the grid shows: the formula for formula cells, otherwise the value formatted as Excel displays it
function cellText(cell) {
    if (cell.f) return "=" + cell.f;
    return formattedValue(cell);
}

function formattedValue(cell) {
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
