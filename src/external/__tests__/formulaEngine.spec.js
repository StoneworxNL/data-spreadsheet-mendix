import { readFileSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { stox } from "../xlsxspread";
import { FormulaEngine } from "../formulaEngine";

// Grid sheets as x-spreadsheet keeps them, with the row/column counts the engine reads
function loadSheets() {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", "sales-report.xlsx")));
    return stox(XLSX.read(bytes, { type: "array", cellNF: true })).map(sheet => ({
        ...sheet,
        rows: Object.assign({}, sheet.rows, { len: sheet.rows.len }),
        cols: { len: sheet.cols.len }
    }));
}

const getCell = (data, ri, ci) => (data.rows[ri] && data.rows[ri].cells[ci]) || null;

describe("FormulaEngine", () => {
    it("calculates loaded formulas like Excel, including absolute references", () => {
        const sheets = loadSheets();
        const engine = new FormulaEngine(() => sheets, getCell);
        const summary = sheets[0];
        // F5 = SUM(B5:E5), G5 = F5/$F$10
        expect(engine.isTrusted(summary, 4, 5, getCell(summary, 4, 5))).toBe(true);
        expect(engine.cellValue(summary, 4, 5)).toBe(57400);
        expect(engine.isTrusted(summary, 4, 6, getCell(summary, 4, 6))).toBe(true);
        expect(engine.cellValue(summary, 4, 6)).toBeCloseTo(57400 / 263250, 9);
    });

    it("recalculates after an edit, through dependent formulas", () => {
        const sheets = loadSheets();
        const engine = new FormulaEngine(() => sheets, getCell);
        const summary = sheets[0];
        getCell(summary, 4, 1).text = "30000"; // B5: 12,500 → 30,000
        engine.reset();
        expect(engine.cellValue(summary, 4, 5)).toBe(74900); // F5
        expect(engine.cellValue(summary, 9, 5)).toBe(280750); // F10
        expect(engine.cellValue(summary, 4, 6)).toBeCloseTo(74900 / 280750, 9); // G5
    });

    it("reads typed values as Excel would", () => {
        const sheets = [
            {
                name: "S",
                rows: {
                    len: 5,
                    0: {
                        cells: { 0: { text: "12.5" }, 1: { text: "25%" }, 2: { text: "TRUE" }, 3: { text: "=A1*B1" } }
                    }
                },
                cols: { len: 5 }
            }
        ];
        const engine = new FormulaEngine(() => sheets, getCell);
        expect(engine.cellValue(sheets[0], 0, 3)).toBeCloseTo(3.125, 9);
        sheets[0].rows[0].cells[4] = { text: "=IF(C1,ROUND(D1,1),0)" };
        expect(engine.cellValue(sheets[0], 0, 4)).toBe(3.1);
    });

    it("reports errors and circular references", () => {
        const sheets = [
            {
                name: "S",
                rows: {
                    len: 5,
                    0: { cells: { 0: { text: "=1/0" }, 1: { text: "=B1+1" }, 2: { text: "=NOSUCHFUNCTION(1)" } } }
                },
                cols: { len: 5 }
            }
        ];
        const engine = new FormulaEngine(() => sheets, getCell);
        expect(engine.evaluate(sheets[0], 0, 0, "=1/0").error).toBe("#DIV/0!");
        expect(engine.evaluate(sheets[0], 0, 1, "=B1+1").error).toBeDefined();
        expect(engine.evaluate(sheets[0], 0, 2, "=NOSUCHFUNCTION(1)")).toEqual(
            expect.objectContaining({ unsupported: true })
        );
    });

    it("keeps Excel's value for formulas it can't reproduce", () => {
        const sheets = loadSheets();
        const engine = new FormulaEngine(() => sheets, getCell);
        const cell = getCell(sheets[0], 4, 5);
        cell.source.cell.v = 1; // pretend Excel saved a different result
        expect(engine.isTrusted(sheets[0], 4, 5, cell)).toBe(false);
        expect(engine.cellValue(sheets[0], 4, 5)).toBe(1);
    });
});

describe("formatTyped", () => {
    const { formatTyped } = require("../renderPatches");
    it("shows a typed number in its cell's format", () => {
        expect(formatTyped("30000", "#,##0")).toBe("30,000");
        expect(formatTyped("0.25", "0%")).toBe("25%");
        expect(formatTyped("abc", "#,##0")).toBeNull();
        expect(formatTyped("1d2", "#,##0")).toBeNull();
    });
});
