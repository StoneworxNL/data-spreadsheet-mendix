import { readFileSync } from "fs";
import { join } from "path";
import { TextDecoder, TextEncoder } from "util";
import * as XLSX from "xlsx";

// jsdom doesn't provide these
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

const { openPackage, readLayout, applyTint } = require("../ooxml");
const { stox, spreadsheetOptions } = require("../xlsxspread");
const { exportWorkbook, renameSheetRefs } = require("../workbookExport");

// Both fixtures were created with Excel
const fixture = name => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

function load(name) {
    const bytes = fixture(name);
    const pkg = openPackage(bytes);
    const layout = readLayout(pkg);
    const wb = XLSX.read(bytes, { type: "array", cellNF: true });
    return { bytes, pkg, layout, wb, data: stox(wb, { layout }) };
}

const styleAt = (sheet, r, c) => sheet.styles[sheet.rows[r].cells[c].style];

describe("readLayout", () => {
    it("reads fonts, fills, borders, alignment and wrapping", () => {
        const { data } = load("project-plan.xlsx");
        const plan = data[0];

        const title = styleAt(plan, 0, 0);
        expect(title.font).toEqual(expect.objectContaining({ name: "Georgia", size: 18 }));
        expect(title.color).toBe("#7030A0");

        expect(styleAt(plan, 1, 0).underline).toBe(true);

        const header = styleAt(plan, 3, 1);
        expect(header.font.bold).toBe(true);
        expect(header.bgcolor).toBe("#FFC000");
        // The thick header line is overridden by the table's dashed inner borders, as in Excel
        expect(header.border.bottom).toEqual(["dashed", "#A6A6A6"]);
        expect(styleAt(plan, 3, 0).border.left).toEqual(["dotted", "#000000"]);

        // Status "Done": green fill, dark green text, centred
        const done = styleAt(plan, 4, 5);
        expect(done.bgcolor).toBe("#C6EFCE");
        expect(done.color).toBe("#006100");
        expect(done.align).toBe("center");

        // Cancelled task is struck through
        expect(styleAt(plan, 8, 1).strike).toBe(true);
        // Notes wrap and are top-aligned
        expect(styleAt(plan, 6, 6)).toEqual(expect.objectContaining({ textwrap: true, valign: "top" }));
        // Dashed inner borders
        expect(styleAt(plan, 5, 1).border.bottom[0]).toBe("dashed");
        // Theme colour with a tint resolves to an RGB colour
        expect(styleAt(plan, 14, 4).bgcolor).toMatch(/^#[0-9A-F]{6}$/);
        expect(styleAt(plan, 14, 5).border.top[0]).toBe("thick");
    });

    it("reads column widths, hidden columns and row heights", () => {
        const { data } = load("project-plan.xlsx");
        const plan = data[0];
        expect(plan.cols[6].width).toBeGreaterThan(plan.cols[0].width * 3);
        expect(plan.cols[2].hide).toBe(true);
        expect(plan.rows[3].height).toBe(32); // 24pt
    });

    it("right-aligns numbers like Excel's General alignment, without marking it as a real setting", () => {
        const { data } = load("sales-report.xlsx");
        const number = styleAt(data[0], 4, 1);
        expect(number.align).toBe("right");
        expect(number.autoAlign).toBe(true);
    });

    it("reads frozen panes", () => {
        const { data } = load("sales-report.xlsx");
        expect(data[0].freeze).toBe("A5");
        expect(data[1].freeze).toBeUndefined();
    });

    it("reads the charts on each sheet", () => {
        const { layout } = load("sales-report.xlsx");
        const charts = layout.sheets.map(sheet => sheet.drawing.objects.map(o => o.chart.plots[0].type));
        expect(charts).toEqual([
            ["bar", "pie"],
            ["line", "bar"],
            ["scatter", "bar", "doughnut"]
        ]);

        const column = layout.sheets[0].drawing.objects[0];
        expect(column.anchor.type).toBe("twoCell");
        expect(column.anchor.from).toEqual(expect.objectContaining({ col: 0, row: 11 }));
        expect(column.chart.title).toBe("Sales per region by quarter");
        expect(column.chart.plots[0].series).toHaveLength(4);
        expect(column.chart.plots[0].series[0].values.ref).toBe("Summary!$B$5:$B$9");
        expect(column.chart.plots[0].series[0].categories.cache).toEqual(["North", "South", "East", "West", "Online"]);

        const stacked = layout.sheets[2].drawing.objects[1].chart.plots[0];
        expect(stacked.horizontal).toBe(true);
        expect(stacked.grouping).toBe("stacked");
    });

    it("returns null for files that aren't zip packages", () => {
        expect(openPackage(new TextEncoder().encode("a,b\n1,2"))).toBeNull();
    });

    it("builds grid options from the workbook defaults", () => {
        const { layout } = load("sales-report.xlsx");
        const options = spreadsheetOptions(layout);
        // Office 365 default font
        expect(options.style.font).toEqual(expect.objectContaining({ name: "Aptos Narrow", size: 11 }));
        expect(options.style.valign).toBe("bottom");
        expect(options.row.height).toBe(19);
    });
});

describe("applyTint", () => {
    it("lightens and darkens like Excel", () => {
        expect(applyTint("000000", 0.5).toUpperCase()).toBe("808080");
        expect(applyTint("FFFFFF", -0.5).toUpperCase()).toBe("808080");
    });
});

describe("exportWorkbook", () => {
    function exportAgain(loaded, sheets) {
        const bytes = exportWorkbook({
            sheets: sheets || loaded.data.map((data, original) => ({ data, original })),
            source: { pkg: loaded.pkg, layout: loaded.layout },
            options: { bookType: "xlsx", type: "array" },
            defaultStyle: { font: { name: "Calibri", size: 11 } }
        });
        const pkg = openPackage(new Uint8Array(bytes));
        return { pkg, layout: readLayout(pkg), wb: XLSX.read(bytes, { type: "array" }) };
    }

    it("keeps styles, sizes and frozen panes", () => {
        const loaded = load("project-plan.xlsx");
        const { layout } = exportAgain(loaded);
        const again = stox(XLSX.read(fixture("project-plan.xlsx"), { type: "array" }), { layout });

        expect(styleAt(again[0], 3, 1)).toEqual(expect.objectContaining({ bgcolor: "#FFC000" }));
        expect(styleAt(again[0], 4, 5)).toEqual(expect.objectContaining({ bgcolor: "#C6EFCE", color: "#006100" }));
        expect(styleAt(again[0], 6, 6).textwrap).toBe(true);
        expect(again[0].cols[2].hide).toBe(true);
        expect(layout.sheets[0].cols).toEqual(loaded.layout.sheets[0].cols);

        const sales = exportAgain(load("sales-report.xlsx"));
        expect(sales.layout.sheets[0].freeze).toBe("A5");
    });

    it("copies charts back to their sheets", () => {
        const { pkg, layout } = exportAgain(load("sales-report.xlsx"));
        expect(layout.sheets.map(sheet => sheet.drawing && sheet.drawing.objects.length)).toEqual([2, 2, 3]);
        expect(pkg.text("[Content_Types].xml")).toContain('PartName="/xl/charts/chart7.xml"');
    });

    it("moves charts with reordered sheets and updates renamed sheet references", () => {
        const loaded = load("sales-report.xlsx");
        const [summary, trend, targets] = loaded.data;
        const sheets = [
            { data: { ...targets }, original: 2 },
            { data: { ...summary, name: "Overview 2026" }, original: 0 },
            { data: { ...trend }, original: 1 }
        ];
        const { pkg, layout, wb } = exportAgain(loaded, sheets);
        expect(wb.SheetNames).toEqual(["Targets", "Overview 2026", "Monthly trend"]);
        expect(layout.sheets.map(sheet => sheet.drawing.objects.length)).toEqual([3, 2, 2]);
        expect(layout.sheets[1].drawing.objects[0].chart.plots[0].series[0].values.ref).toBe(
            "'Overview 2026'!$B$5:$B$9"
        );
        expect(pkg.text("xl/charts/chart3.xml")).toContain("'Monthly trend'!");
    });

    it("leaves non-zip formats alone", () => {
        const loaded = load("sales-report.xlsx");
        const csv = exportWorkbook({
            sheets: [{ data: loaded.data[1], original: 1 }],
            source: loaded,
            options: { bookType: "csv", type: "string" }
        });
        expect(csv.split("\n")[1]).toMatch(/^Jan,/);
    });
});

describe("renameSheetRefs", () => {
    it("rewrites quoted and unquoted references", () => {
        const xml = "<c:f>Sheet1!$A$1:$A$3</c:f><c:f>('My data'!$B$1,Sheet1!$C$1)</c:f><c:v>Sheet1!</c:v>";
        expect(renameSheetRefs(xml, { Sheet1: "Sales Q1", "My data": "Data" })).toBe(
            "<c:f>'Sales Q1'!$A$1:$A$3</c:f><c:f>(Data!$B$1,'Sales Q1'!$C$1)</c:f><c:v>Sheet1!</c:v>"
        );
    });
});

describe("toolbar number formats", () => {
    it("writes the currency format picked in the toolbar", () => {
        const { xtos } = require("../xlsxspread");
        const wb = xtos([
            { name: "S", styles: [{ format: "eur" }], rows: { 0: { cells: { 0: { text: "1250", style: 0 } } } } }
        ]);
        expect(wb.Sheets.S.A1).toEqual(expect.objectContaining({ t: "n", v: 1250, z: '"€"#,##0.00' }));
    });
});

describe("untrusted files", () => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Changes parts of an Excel-made fixture, as an attacker could
    function tampered(name, edit) {
        const zip = XLSX.CFB.read(fixture(name), { type: "array" });
        const text = path => decoder.decode(XLSX.CFB.find(zip, "/" + path).content);
        const write = (path, content) => {
            const entry = XLSX.CFB.find(zip, "/" + path);
            const data = typeof content === "string" ? encoder.encode(content) : content;
            if (entry) {
                entry.content = data;
                entry.size = data.length;
            } else {
                XLSX.CFB.utils.cfb_add(zip, "/" + path, data);
            }
        };
        edit(text, write);
        return new Uint8Array(XLSX.CFB.write(zip, { fileType: "zip", type: "array" }));
    }

    it("never uses a font name that could be HTML or CSS", () => {
        const payloads = [
            "&lt;img src=x onerror=alert(1)&gt;",
            "Calibri&quot;); } body { display: none } /*",
            "Calibri&#10;x"
        ];
        payloads.forEach(payload => {
            const bytes = tampered("project-plan.xlsx", (text, write) =>
                write(
                    "xl/styles.xml",
                    text("xl/styles.xml").replace(/<name val="Georgia"\/>/, `<name val="${payload}"/>`)
                )
            );
            const layout = readLayout(openPackage(bytes));
            expect(layout.fontNames).not.toContain(expect.stringMatching(/[<>"\\{};\n]/));
            const data = stox(XLSX.read(bytes, { type: "array" }), { layout });
            expect(styleAt(data[0], 0, 0).font.name).toBe("Calibri");
        });
    });

    it("keeps plain font names", () => {
        const { safeFontName } = require("../ooxml");
        expect(safeFontName("Aptos Narrow")).toBe("Aptos Narrow");
        expect(safeFontName("Segoe UI, sans-serif")).toBe("Segoe UI, sans-serif");
        expect(safeFontName("<b>")).toBe("Calibri");
        expect(safeFontName(null)).toBe("Calibri");
    });

    function withPicture(fileName, content) {
        const bytes = tampered("sales-report.xlsx", (text, write) => {
            write("xl/media/" + fileName, content);
            write(
                "xl/drawings/_rels/drawing1.xml.rels",
                text("xl/drawings/_rels/drawing1.xml.rels").replace(
                    "</Relationships>",
                    '<Relationship Id="rIdSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' +
                        fileName +
                        '"/></Relationships>'
                )
            );
            write(
                "xl/drawings/drawing1.xml",
                text("xl/drawings/drawing1.xml").replace(
                    "</xdr:wsDr>",
                    '<xdr:oneCellAnchor><xdr:from><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="952500"/><xdr:pic><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdSvg"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
                )
            );
        });
        return readLayout(openPackage(bytes)).sheets[0].drawing.objects.map(o => o.kind);
    }

    it("doesn't show SVG pictures", () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
        expect(withPicture("image1.svg", svg)).toEqual(["chart", "chart"]);
        // A raster picture in the same place is shown
        expect(withPicture("image1.png", new Uint8Array([137, 80, 78, 71]))).toEqual(["chart", "chart", "picture"]);
    });

    it("limits column ranges to the columns that can be shown", () => {
        const bytes = tampered("project-plan.xlsx", (text, write) =>
            write(
                "xl/worksheets/sheet1.xml",
                text("xl/worksheets/sheet1.xml").replace(
                    /<cols>/,
                    '<cols><col min="20" max="16384" width="5" customWidth="1"/>'
                )
            )
        );
        const layout = readLayout(openPackage(bytes));
        expect(Object.keys(layout.sheets[0].cols).length).toBeLessThanOrEqual(1024);
    });
});

describe("fonts", () => {
    const { sources, familyOf } = require("../fonts");
    it("builds local() sources with condensed fallbacks", () => {
        expect(familyOf("Aptos Narrow")[0]).toBe("Arial Narrow");
        expect(sources(["Calibri", "Arial"], "Bold")).toBe(
            'local("Calibri Bold"), local("Arial Bold"), local("Calibri"), local("Arial")'
        );
    });
});
