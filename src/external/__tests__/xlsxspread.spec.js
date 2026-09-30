import * as XLSX from "xlsx";
import { stox, xtos } from "../xlsxspread";

// Writes a workbook to .xlsx bytes and reads it back the way the widget does
function roundTrip(wb) {
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return XLSX.read(bytes, { type: "array", cellNF: true });
}

function workbookOf(sheets) {
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, ws]) => XLSX.utils.book_append_sheet(wb, ws, name));
    return wb;
}

function load(sheets, options) {
    return stox(roundTrip(workbookOf(sheets)), options);
}

function save(xdata) {
    return roundTrip(xtos(xdata));
}

// The fields that decide what Excel stores and displays
function essentials(cell) {
    if (!cell) return cell;
    const { t, v, z, f } = cell;
    return JSON.parse(JSON.stringify({ t, v, z: z === "General" ? undefined : z, f }));
}

function setText(xdata, ref, text) {
    const { r, c } = XLSX.utils.decode_cell(ref);
    xdata[0].rows[r] = xdata[0].rows[r] || { cells: {} };
    xdata[0].rows[r].cells[c] = { ...xdata[0].rows[r].cells[c], text };
}

describe("xlsxspread", () => {
    describe("cells that were not edited", () => {
        const original = {
            A1: { t: "n", v: 1234.5, z: "#,##0.00" },
            A2: { t: "n", v: 0.25, z: "0%" },
            A3: { t: "n", v: 45306, z: "yyyy-mm-dd" },
            A4: { t: "s", v: "00123" },
            A5: { t: "b", v: false },
            A6: { t: "s", v: " " },
            A7: { t: "n", v: 3, f: "SUM(1,2)" },
            A8: { t: "s", v: "1e5" },
            "!ref": "A1:A8"
        };

        it("are written back with their original type, value, number format and formula", () => {
            const loaded = roundTrip(workbookOf({ Sheet1: original })).Sheets.Sheet1;
            const saved = save(stox(roundTrip(workbookOf({ Sheet1: original })))).Sheets.Sheet1;

            ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"].forEach(ref => {
                expect([ref, essentials(saved[ref])]).toEqual([ref, essentials(loaded[ref])]);
            });
        });

        it("are shown formatted, and formulas as formulas", () => {
            const cells = load({ Sheet1: original })[0].rows;

            expect(cells[0].cells[0].text).toBe("1,234.50");
            expect(cells[1].cells[0].text).toBe("25%");
            expect(cells[2].cells[0].text).toBe("2024-01-15");
            expect(cells[4].cells[0].text).toBe("FALSE");
            expect(cells[6].cells[0].text).toBe("=SUM(1,2)");
        });

        it("survive x-spreadsheet's JSON cloning (undo history, copy/paste)", () => {
            const xdata = JSON.parse(JSON.stringify(load({ Sheet1: original })));

            expect(essentials(save(xdata).Sheets.Sheet1.A1)).toEqual({ t: "n", v: 1234.5, z: "#,##0.00" });
        });

        it("keep their original value when moved, e.g. by inserting a row above", () => {
            const xdata = load({ Sheet1: original });
            const rows = xdata[0].rows;
            // What x-spreadsheet's row insert does: shift the row objects down
            for (let r = 7; r >= 0; r--) rows[r + 1] = rows[r];
            rows[0] = { cells: {} };

            const saved = save(xdata).Sheets.Sheet1;
            expect(saved.A1).toBeUndefined();
            expect(essentials(saved.A2)).toEqual({ t: "n", v: 1234.5, z: "#,##0.00" });
            expect(essentials(saved.A6)).toEqual({ t: "b", v: false });
        });
    });

    describe("edited cells", () => {
        it.each([
            ["42", { t: "n", v: 42 }],
            ["-1.5e3", { t: "n", v: -1500 }],
            [".5", { t: "n", v: 0.5 }],
            ["0", { t: "n", v: 0 }],
            ["007", { t: "s", v: "007" }],
            ["12345678901234567890", { t: "s", v: "12345678901234567890" }],
            ["false", { t: "b", v: false }],
            ["TRUE", { t: "b", v: true }],
            ["25%", { t: "n", v: 0.25, z: "0%" }],
            ["12.5%", { t: "n", v: 0.125, z: "0.00%" }],
            ["1,500", { t: "s", v: "1,500" }],
            [" ", { t: "s", v: " " }],
            ["hello", { t: "s", v: "hello" }],
            ["=", { t: "s", v: "=" }]
        ])("types %j like typed input", (text, expected) => {
            const xdata = load({ Sheet1: { "!ref": "A1" } });
            setText(xdata, "B2", text);

            expect(essentials(save(xdata).Sheets.Sheet1.B2)).toEqual(expected);
        });

        it("keep a formula", () => {
            const xdata = load({ Sheet1: { A1: { t: "n", v: 1 }, "!ref": "A1" } });
            setText(xdata, "A2", "=A1*2");

            const saved = save(xdata).Sheets.Sheet1.A2;
            expect(saved.f).toBe("A1*2");
            // Reloading shows the formula again
            expect(stox(save(xdata))[0].rows[1].cells[0].text).toBe("=A1*2");
        });

        it("keep the number format of a formatted number, including when edited as displayed", () => {
            const xdata = load({
                Sheet1: {
                    A1: { t: "n", v: 1234.5, z: "#,##0.00" },
                    A2: { t: "n", v: 45306, z: "yyyy-mm-dd" },
                    A3: { t: "n", v: 7, z: "000" },
                    "!ref": "A1:A3"
                }
            });
            setText(xdata, "A1", "1,300.25");
            setText(xdata, "A2", "45307");
            setText(xdata, "A3", "008");

            const saved = save(xdata).Sheets.Sheet1;
            expect(essentials(saved.A1)).toEqual({ t: "n", v: 1300.25, z: "#,##0.00" });
            expect(essentials(saved.A2)).toEqual({ t: "n", v: 45307, z: "yyyy-mm-dd" });
            expect(essentials(saved.A3)).toEqual({ t: "n", v: 8, z: "000" });
        });

        it("are removed when cleared", () => {
            const xdata = load({ Sheet1: { A1: { t: "s", v: "x" }, A2: { t: "s", v: "y" }, "!ref": "A1:A2" } });
            setText(xdata, "A2", "");

            const saved = save(xdata).Sheets.Sheet1;
            expect(saved.A2).toBeUndefined();
            expect(saved["!ref"]).toBe("A1");
        });
    });

    describe("grid size", () => {
        it("shows columns beyond Z", () => {
            const xdata = load({ Sheet1: { AD1: { t: "s", v: "far right" }, "!ref": "A1:AD1" } });

            expect(xdata[0].cols.len).toBe(30);
            expect(xdata[0].rows[0].cells[29].text).toBe("far right");
        });

        it("keeps at least x-spreadsheet's 26 columns", () => {
            expect(load({ Sheet1: { A1: { t: "s", v: "x" }, "!ref": "A1" } })[0].cols.len).toBe(26);
        });

        it("fits the rows to the data by default (view mode)", () => {
            const xdata = load({ Sheet1: { A1: { t: "s", v: "x" }, A5: { t: "s", v: "y" }, "!ref": "A1:A5" } });

            expect(xdata[0].rows.len).toBe(5);
        });

        it("adds spare rows and columns to type into (edit mode)", () => {
            const xdata = load(
                { Sheet1: { A1: { t: "s", v: "x" }, AD5: { t: "s", v: "y" }, "!ref": "A1:AD5" } },
                { spareRows: 100, spareCols: 26 }
            );

            expect(xdata[0].rows.len).toBe(105);
            expect(xdata[0].cols.len).toBe(56);
        });

        it("does not write spare rows and columns back", () => {
            const xdata = load({ Sheet1: { A1: { t: "s", v: "x" }, "!ref": "A1" } }, { spareRows: 100, spareCols: 26 });

            expect(save(xdata).Sheets.Sheet1["!ref"]).toBe("A1");
        });

        it("keeps empty sheets, in order", () => {
            const xdata = load({ First: { A1: { t: "s", v: "x" }, "!ref": "A1" }, Empty: {}, Last: { "!ref": "A1" } });

            expect(xdata.map(sheet => sheet.name)).toEqual(["First", "Empty", "Last"]);
            expect(xdata[1].rows.len).toBe(1);
            expect(save(xdata).SheetNames).toEqual(["First", "Empty", "Last"]);
        });
    });

    describe("merged cells", () => {
        it("round-trip, including a merge that starts on an empty cell and extends past the data", () => {
            const merges = [XLSX.utils.decode_range("A1:B2"), XLSX.utils.decode_range("D4:F6")];
            const xdata = load({ Sheet1: { A1: { t: "s", v: "title" }, "!ref": "A1:F6", "!merges": merges } });

            expect(xdata[0].rows[3].cells[3].merge).toEqual([2, 2]);

            const saved = save(xdata).Sheets.Sheet1;
            expect(saved["!merges"].map(m => XLSX.utils.encode_range(m)).sort()).toEqual(["A1:B2", "D4:F6"]);
            expect(saved["!ref"]).toBe("A1:F6");
        });
    });

    describe("sheet names", () => {
        it("are made valid and unique for Excel instead of failing the export", () => {
            const sheet = { rows: { len: 1 } };
            const names = xtos([
                { ...sheet, name: "Q1/Q2" },
                { ...sheet, name: "Data" },
                { ...sheet, name: "data" },
                { ...sheet, name: "'quoted'" },
                { ...sheet, name: "A very long sheet name that Excel rejects" },
                { ...sheet, name: "" }
            ]).SheetNames;

            expect(names).toEqual(["Q1_Q2", "Data", "data (2)", "quoted", "A very long sheet name that Exc", "Sheet"]);
        });
    });
});
