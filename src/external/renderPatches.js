/*
 * Small changes to how x-spreadsheet draws loaded workbooks, so they look like they do in Excel. They only apply
 * while the grid draws its canvas; editing, selection and saving see the cells unchanged.
 *
 * Formulas: x-spreadsheet calculates formulas itself, but only knows SUM, AVERAGE, MAX, MIN, IF, AND, OR and CONCAT,
 * can't read absolute references ($A$1), and reads other cells as their displayed text ("€ 1,250" isn't a number).
 * Loaded formulas therefore showed NaN or wrong results. Now loaded formulas show Excel's result, formatted with the
 * cell's number format; the cell still holds the formula, so the editor shows and saves it. Formulas the grid can
 * calculate correctly (checked once against Excel's saved result) are recalculated when the cells they use change.
 * New formulas read loaded cells as their underlying values.
 *
 * Text overflow: like Excel, left-aligned text that doesn't wrap runs on into empty cells to its right instead of
 * being cut off at its own cell border.
 */
import * as XLSX from "xlsx";
import cellFormula from "x-data-spreadsheet/src/core/cell";
import { formulam } from "x-data-spreadsheet/src/core/formula";

const PATCHED = "__xsRenderPatches";
const MAX_OVERFLOW_COLUMNS = 20;
const MAX_FORMULA_DEPTH = 50;

/**
 * @param {Object} spreadsheet The x-spreadsheet instance
 * @returns {Function} Removes the instance's render hook
 */
export function installRenderPatches(spreadsheet) {
    const proto = Object.getPrototypeOf(spreadsheet.sheet.data);
    if (!proto[PATCHED]) {
        const { getCell, getCellTextOrDefault, cellRect } = proto;

        Object.assign(proto, {
            // While the grid draws, loaded formula cells show their result instead of x-spreadsheet's calculation
            getCell(ri, ci) {
                const cell = getCell.call(this, ri, ci);
                if (!this[PATCHED] || !cell || !cell.source) return cell;
                if (isUnedited(cell) && cell.source.display != null) {
                    return { ...cell, text: formulaDisplay(this, cell, getCell) };
                }
                // A number typed into a formatted number cell is shown (and saved) in that cell's format
                const loaded = cell.source.cell;
                if (loaded && loaded.t === "n" && loaded.z) {
                    const formatted = formatTyped(cell.text, loaded.z);
                    if (formatted !== null) return { ...cell, text: formatted };
                }
                return cell;
            },

            // Values that formulas read from loaded cells: the number behind "€ 1,250", or a loaded formula's result
            getCellTextOrDefault(ri, ci) {
                const cell = getCell.call(this, ri, ci);
                if (isUnedited(cell) && cell.source.cell) {
                    const value = loadedValue(this, cell, getCell, 0);
                    if (typeof value === "number") return String(value);
                    if (cell.source.display != null) return cell.source.display;
                }
                return getCellTextOrDefault.call(this, ri, ci);
            },

            cellRect(ri, ci) {
                const rect = cellRect.call(this, ri, ci);
                if (this[PATCHED]) rect.width += overflowWidth(this, ri, ci, rect.cell);
                return rect;
            }
        });
        proto[PATCHED] = true;
    }

    const { table } = spreadsheet.sheet;
    const render = table.render;
    table.render = (...args) => {
        const { data } = table;
        data[PATCHED] = true;
        try {
            return render.apply(table, args);
        } finally {
            data[PATCHED] = false;
        }
    };
    return () => {
        table.render = render;
    };
}

function isUnedited(cell) {
    return Boolean(cell && cell.source && cell.text === cell.source.text);
}

function formatTyped(text, format) {
    if (typeof text !== "string" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return null;
    try {
        return XLSX.SSF.format(format, Number(text));
    } catch (e) {
        return null;
    }
}

function formulaDisplay(data, cell, getCell) {
    const { source } = cell;
    if (!isLive(data, cell, getCell)) return source.display;
    const value = loadedValue(data, cell, getCell, 0);
    if (value === source.cell.v) return source.display;
    if (typeof value !== "number") return String(value);
    try {
        return XLSX.SSF.format(source.cell.z || "General", value);
    } catch (e) {
        return String(value);
    }
}

// The value of an unedited loaded cell; formulas the grid can calculate are recalculated from the current cells
function loadedValue(data, cell, getCell, depth) {
    const { source } = cell;
    if (source.display == null || depth > MAX_FORMULA_DEPTH || !isLive(data, cell, getCell)) return source.cell.v;
    const result = calculate(data, source.text, getCell, depth);
    return result === null ? source.cell.v : result;
}

// Whether x-spreadsheet calculates this formula like Excel: it must give Excel's saved result for the loaded data
function isLive(data, cell, getCell) {
    const { source } = cell;
    if (source.live === undefined) {
        source.live = false;
        const expected = source.cell.v;
        const result = typeof expected === "number" ? calculate(data, source.text, getCell, 0, true) : null;
        source.live = result !== null && Math.abs(result - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
    }
    return source.live;
}

// x-spreadsheet's calculation, reading loaded cells as values; null when it fails or isn't a number
function calculate(data, formula, getCell, depth, savedValues = false) {
    // x-spreadsheet doesn't understand absolute references; they mean the same for a single calculation
    const text = formula.replace(/\$(?=[A-Z]+\$?\d)|(?<=[A-Z])\$(?=\d)/g, "");
    const cellText = (ci, ri) => {
        const ref = getCell.call(data, ri, ci);
        if (isUnedited(ref) && ref.source.cell) {
            const v = savedValues ? ref.source.cell.v : loadedValue(data, ref, getCell, depth + 1);
            return typeof v === "number" ? String(v) : ref.source.display != null ? ref.source.display : ref.text;
        }
        return ref && ref.text ? ref.text : "";
    };
    try {
        const result = Number(cellFormula.render(text, formulam, cellText));
        return Number.isFinite(result) ? result : null;
    } catch (e) {
        return null;
    }
}

// Width of the empty cells to the right that a cell's text may run into
function overflowWidth(data, ri, ci, cell) {
    if (!cell || cell.merge) return 0;
    const text = isUnedited(cell) && cell.source.display != null ? cell.source.display : cell.text;
    if (!text || text[0] === "=") return 0;

    const style = data.getCellStyleOrDefault(ri, ci);
    if (style.textwrap || style.bgcolor !== data.defaultStyle().bgcolor || style.border) return 0;
    if (style.align && style.align !== "left") return 0;

    // Rough text width; the canvas clips anything beyond it anyway
    const needed = String(text).length * (style.font.size || 11) * 0.75;
    const { cols, rows, merges } = data;
    const width = cols.getWidth(ci);
    let extra = 0;
    for (let c = ci + 1; c < Math.min(cols.len, ci + 1 + MAX_OVERFLOW_COLUMNS) && width + extra < needed; c++) {
        const next = rows.getCell(ri, c);
        if ((next && (next.text || next.style !== undefined || next.merge)) || merges.getFirstIncludes(ri, c)) break;
        extra += cols.getWidth(c);
    }
    return extra;
}
