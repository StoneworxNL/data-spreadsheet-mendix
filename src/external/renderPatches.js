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
 *
 * Formula results are cached until a cell changes: every way x-spreadsheet changes cells (typing, paste, delete,
 * insert, undo/redo) goes through DataProxy's changeData, setCellText or setData, and those clear the cache. Adding,
 * removing or renaming a sheet clears it on the next draw.
 *
 * Cell editor: x-spreadsheet copies the edited cell's text into a hidden measuring div with innerHTML, so a cell
 * value such as `<img src=x onerror=...>` from an uploaded file would run as script for whoever edits it. That div
 * gets the text as plain text instead (see `patchEditor`).
 */
import * as XLSX from "xlsx";
import { FormulaEngine } from "./formulaEngine.js";

const PATCHED = "__xsRenderPatches";
const ENGINE = "__xsFormulaEngine";
const MAX_OVERFLOW_COLUMNS = 20;
// DataProxy methods that change cells; each clears the formula cache
const CHANGES_CELLS = ["changeData", "setCellText", "setData"];

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
        CHANGES_CELLS.forEach(name => {
            const original = proto[name];
            Object.assign(proto, {
                [name](...args) {
                    try {
                        return original.apply(this, args);
                    } finally {
                        if (this[ENGINE]) this[ENGINE].reset();
                    }
                }
            });
        });
        proto[PATCHED] = true;
    }

    const storedCell = proto[`${PATCHED}getCell`];
    const engine = new FormulaEngine(
        () => spreadsheet.datas,
        (data, ri, ci) => storedCell.call(data, ri, ci)
    );

    patchEditor(spreadsheet.sheet.editor);

    const { table } = spreadsheet.sheet;
    const render = table.render;
    let sheetNames = null;
    table.render = (...args) => {
        const { data } = table;
        // Formulas can refer to sheets by name, and results are cached per sheet name
        const names = spreadsheet.datas.map(d => d.name).join("\n");
        if (names !== sheetNames) {
            sheetNames = names;
            engine.reset();
        }
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

/**
 * The editor's measuring div (`textlineEl`) only needs the text's size, but x-spreadsheet fills it with `.html()`,
 * i.e. innerHTML. Give it the text as plain text, so cell values are never parsed as HTML.
 */
export function patchEditor(editor) {
    const line = editor && editor.textlineEl;
    if (!line || !line.el) return;
    Object.assign(line, {
        html(content) {
            if (content === undefined) return this.el.textContent;
            this.el.textContent = content == null ? "" : String(content);
            return this;
        }
    });
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
