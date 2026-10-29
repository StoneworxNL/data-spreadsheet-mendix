/*
 * Small changes to how x-spreadsheet draws loaded workbooks, so they look like they do in Excel. They only apply
 * while the grid draws its canvas; editing, selection and saving see the cells unchanged.
 *
 * Formulas: every formula is calculated with FormulaEngine (fast-formula-parser) and shown formatted with its cell's
 * number format, instead of by x-spreadsheet's own calculator (8 functions, reads cells as their shown text). The cell
 * still holds the formula, so the editor shows and saves it. Loaded formulas the engine can't reproduce keep
 * showing the result Excel saved.
 *
 * Text overflow: like Excel, left-aligned text that doesn't wrap runs on into empty cells to its right instead of
 * being cut off at its own cell border.
 */
import * as XLSX from "xlsx";
import { FormulaEngine } from "./formulaEngine.js";

const PATCHED = "__xsRenderPatches";
const ENGINE = "__xsFormulaEngine";
const MAX_OVERFLOW_COLUMNS = 20;

/**
 * @param {Object} spreadsheet The x-spreadsheet instance
 * @returns {{ engine: FormulaEngine, uninstall: Function }} The formula engine (also used by the charts) and a
 *     function that removes the instance's render hook
 */
export function installRenderPatches(spreadsheet) {
    const proto = Object.getPrototypeOf(spreadsheet.sheet.data);
    if (!proto[PATCHED]) {
        const { getCell, cellRect } = proto;
        proto[`${PATCHED}getCell`] = getCell;

        Object.assign(proto, {
            // While the grid draws, formulas show their result, and typed numbers their cell's number format
            getCell(ri, ci) {
                const cell = getCell.call(this, ri, ci);
                if (!this[PATCHED] || !cell) return cell;
                const text = cell.text == null ? "" : String(cell.text);
                if (text[0] === "=" && text.length > 1 && this[ENGINE]) {
                    return { ...cell, text: formulaDisplay(this[ENGINE], this, ri, ci, cell) };
                }
                const loaded = cell.source && cell.source.cell;
                if (loaded && loaded.t === "n" && loaded.z) {
                    const formatted = formatTyped(text, loaded.z);
                    if (formatted !== null) return { ...cell, text: formatted };
                }
                return cell;
            },

            cellRect(ri, ci) {
                const rect = cellRect.call(this, ri, ci);
                if (this[PATCHED]) rect.width += overflowWidth(this, ri, ci, rect.cell);
                return rect;
            }
        });
        proto[PATCHED] = true;
    }

    const storedCell = proto[`${PATCHED}getCell`];
    const engine = new FormulaEngine(
        () => spreadsheet.datas,
        (data, ri, ci) => storedCell.call(data, ri, ci)
    );

    const { table } = spreadsheet.sheet;
    const render = table.render;
    table.render = (...args) => {
        const { data } = table;
        // Cells may have changed since the last draw
        engine.reset();
        spreadsheet.datas.forEach(d => {
            d[ENGINE] = engine;
        });
        data[PATCHED] = true;
        try {
            return render.apply(table, args);
        } finally {
            data[PATCHED] = false;
        }
    };
    return {
        engine,
        uninstall: () => {
            table.render = render;
        }
    };
}

function isUnedited(cell) {
    return Boolean(cell && cell.source && cell.text === cell.source.text);
}

export function formatTyped(text, format) {
    if (typeof text !== "string" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return null;
    try {
        return XLSX.SSF.format(format, Number(text));
    } catch (e) {
        return null;
    }
}

function formulaDisplay(engine, data, ri, ci, cell) {
    const unedited = isUnedited(cell) && cell.source.cell;
    if (unedited && !engine.isTrusted(data, ri, ci, cell)) return cell.source.display;

    const result = engine.evaluate(data, ri, ci, String(cell.text));
    if (result.error) return unedited && result.unsupported ? cell.source.display : result.error;
    const { value } = result;
    if (unedited && value === cell.source.cell.v) return cell.source.display;
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value !== "number") return value == null ? "" : String(value);
    const format = cell.source && cell.source.cell && cell.source.cell.z;
    try {
        return XLSX.SSF.format(format || "General", value);
    } catch (e) {
        return String(value);
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
