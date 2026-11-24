import { readFileSync } from "fs";
import { join } from "path";
import { TextDecoder, TextEncoder } from "util";

if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

const { openPackage, readLayout } = require("../../external/ooxml");
const { writeAnchors } = require("../../external/workbookExport");

// Chart.js needs a canvas; only the configuration is tested here
jest.mock("chart.js", () => ({ Chart: { register: () => {} } }));
const { buildChartConfig } = require("../DrawingLayer");

const COLORS = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
// Excel's cached values stand in for the grid
const fromCache = (ref, cache, numeric) => cache.map(v => (numeric ? Number(v) : v));

function load() {
    const pkg = openPackage(
        new Uint8Array(readFileSync(join(__dirname, "../../external/__tests__/fixtures/chart-features.xlsx")))
    );
    return { pkg, layout: readLayout(pkg) };
}

describe("charts made in Excel", () => {
    it("puts a series on the secondary axis and shows its data labels", () => {
        const { layout } = load();
        const combo = layout.sheets[0].drawing.objects[0].chart;
        expect(combo.plots.map(p => [p.type, p.secondary])).toEqual([
            ["bar", false],
            ["line", true]
        ]);

        const { chartjs } = buildChartConfig(combo, fromCache, COLORS);
        const [orders, margin] = chartjs.data.datasets;
        expect(margin.yAxisID).toBe("y1");
        expect(chartjs.options.scales.y1.position).toBe("right");
        expect(orders.xsLabels).toEqual(expect.objectContaining({ value: true }));
        expect(chartjs.plugins.map(p => p.id)).toContain("xsDataLabels");
    });

    it("draws a linear trendline", () => {
        const { layout } = load();
        const scatter = layout.sheets[0].drawing.objects[1].chart;
        expect(scatter.plots[0].series[0].trendlines).toEqual([expect.objectContaining({ type: "linear" })]);

        const { chartjs } = buildChartConfig(scatter, fromCache, COLORS);
        const trend = chartjs.data.datasets.find(d => d.xsTrend);
        expect(trend.label).toMatch(/^Linear/);
        // A straight line through the points: equal steps in x give equal steps in y
        const ys = trend.data.map(p => p.y);
        const xs = trend.data.map(p => p.x);
        const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
        expect((ys[5] - ys[0]) / (xs[5] - xs[0])).toBeCloseTo(slope, 9);
    });

    it("writes anchors moved by inserted rows back into the drawing", () => {
        const { pkg, layout } = load();
        const drawing = layout.sheets[0].drawing;
        const { anchor } = drawing.objects[1];
        const before = anchor.from.row;
        anchor.from.row += 3;
        anchor.to.row += 3;
        anchor.moved = true;

        const xml = writeAnchors(pkg.text(drawing.path), drawing.objects);
        const rows = Array.from(
            xml.matchAll(/<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)
        ).map(m => Number(m[1]));
        expect(rows[1]).toBe(before + 3);
        expect(rows[0]).toBe(drawing.objects[0].anchor.from.row);
    });
});
