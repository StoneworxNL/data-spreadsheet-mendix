import { readFileSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { stox } from "../xlsxspread";
import { FormulaEngine } from "../formulaEngine";
import FormulaParser from "fast-formula-parser";

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

    it("caps REPT at Excel's 32,767 characters", () => {
        const sheets = [{ name: "S", rows: { len: 1 }, cols: { len: 1 } }];
        const engine = new FormulaEngine(() => sheets, getCell);
        expect(engine.evaluate(sheets[0], 0, 0, '=REPT("ab",3)').value).toBe("ababab");
        const started = Date.now();
        expect(engine.evaluate(sheets[0], 0, 1, '=REPT("a",1000000000)').error).toBe("#VALUE!");
        expect(Date.now() - started).toBeLessThan(1000);
        expect(engine.evaluate(sheets[0], 0, 2, '=REPT("a",-1)').error).toBe("#VALUE!");
    });

    it("calculates chains of formulas far longer than the nesting limit", () => {
        // A running total down 1,000 rows: A1 = 1, An = A(n-1) + 1
        const rows = { len: 1000, 0: { cells: { 0: { text: "1" } } } };
        for (let r = 1; r < 1000; r++) rows[r] = { cells: { 0: { text: `=A${r}+1` } } };
        const sheets = [{ name: "S", rows, cols: { len: 1 } }];
        const engine = new FormulaEngine(() => sheets, getCell);
        expect(engine.cellValue(sheets[0], 999, 0)).toBe(1000);

        rows[0].cells[0].text = "101";
        engine.reset();
        expect(engine.cellValue(sheets[0], 999, 0)).toBe(1100);
    });

    it("calculates long chains where each cell reads two earlier formulas in linear time", () => {
        // A rolling average over a formula column: A(n) = AVERAGE(A(n-2):A(n-1)) + 1, down 1,000 rows
        const rows = { len: 1000, 0: { cells: { 0: { text: "1" } } }, 1: { cells: { 0: { text: "=A1+1" } } } };
        for (let r = 2; r < 1000; r++) rows[r] = { cells: { 0: { text: `=AVERAGE(A${r - 1}:A${r})+1` } } };
        const sheets = [{ name: "S", rows, cols: { len: 1 } }];
        const engine = new FormulaEngine(() => sheets, getCell);

        // Counted rather than timed, so slower machines don't fail it: without stopping a step that went too deep, the
        // work doubled per row and 1,000 rows never finished
        const parse = jest.spyOn(FormulaParser.prototype, "parse");
        const value = engine.cellValue(sheets[0], 999, 0);
        expect(parse.mock.calls.length).toBeLessThan(3 * 1000);
        parse.mockRestore();
        // Same chain calculated row by row
        const expected = [1, 2];
        for (let r = 2; r < 1000; r++) expected.push((expected[r - 2] + expected[r - 1]) / 2 + 1);
        expect(value).toBeCloseTo(expected[999], 6);
    });

    it("reports a circular reference inside a long chain quickly, and keeps it until a cell changes", () => {
        // A running total down 150 rows whose first cell points back at the last
        const rows = { len: 150, 0: { cells: { 0: { text: "=A150" } } } };
        for (let r = 1; r < 150; r++) rows[r] = { cells: { 0: { text: `=A${r}+1` } } };
        const sheets = [{ name: "S", rows, cols: { len: 1 } }];
        const engine = new FormulaEngine(() => sheets, getCell);

        const started = Date.now();
        expect(engine.evaluate(sheets[0], 149, 0, "=A149+1").error).toBe("#REF!");
        // Every cell of the loop, as a draw would ask for them
        for (let r = 0; r < 150; r++) expect(engine.cellValue(sheets[0], r, 0)).toMatch(/^#/);
        expect(Date.now() - started).toBeLessThan(1000);

        // The next draw gets it from the cache
        const parse = jest.spyOn(engine, "parserAt");
        expect(engine.evaluate(sheets[0], 149, 0, "=A149+1").error).toBe("#REF!");
        expect(parse).not.toHaveBeenCalled();

        // Breaking the loop calculates the chain again
        rows[0].cells[0].text = "1";
        engine.reset();
        expect(engine.cellValue(sheets[0], 149, 0)).toBe(150);
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
