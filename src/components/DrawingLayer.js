import * as XLSX from "xlsx";
import {
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    DoughnutController,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PieController,
    PointElement,
    RadarController,
    RadialLinearScale,
    ScatterController,
    Title,
    Tooltip
} from "chart.js";
import { EMU_PER_PIXEL, accentColors } from "../external/ooxml.js";

// Only what the chart types read from Excel need, to keep the bundle small
Chart.register(
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    DoughnutController,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PieController,
    PointElement,
    RadarController,
    RadialLinearScale,
    ScatterController,
    Title,
    Tooltip
);

// Property on x-spreadsheet sheet data that receives row/column inserts and deletes
const SHIFT_HOOK = "__xsShiftHook";

const LEGEND_POSITIONS = { r: "right", l: "left", t: "top", b: "bottom", tr: "right" };
const IMAGE_TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp"
};

/**
 * Draws the charts and pictures of the loaded workbook on top of the x-spreadsheet grid.
 *
 * Objects are positioned from their cell anchors, so they follow scrolling, column/row resizing and frozen panes.
 * Chart data is read from the grid, so charts update when the cells they plot are edited.
 */
export class DrawingLayer {
    /**
     * @param {Object} spreadsheet The x-spreadsheet instance
     * @param {Object} layout From `readLayout` (ooxml.js)
     * @param {Map} originals x-spreadsheet sheet data (DataProxy) -> index of the sheet in the loaded file
     */
    constructor(spreadsheet, layout, originals, engine = null) {
        this.spreadsheet = spreadsheet;
        this.engine = engine;
        this.layout = layout;
        this.originals = originals;
        this.colors = accentColors(layout.theme);
        this.groups = new Map();
        this.urls = [];
        this.frame = null;

        const sheetEl = spreadsheet.sheet.el.el;
        this.fixedLayer = createLayer("xs-drawing-layer");
        this.scrollLayer = createLayer("xs-drawing-layer");
        sheetEl.appendChild(this.fixedLayer);
        sheetEl.appendChild(this.scrollLayer);

        // Objects move with inserted and deleted rows/columns, like in Excel
        installShiftHook(spreadsheet.sheet.data);
        this.onShift = (data, shift) => this.shiftAnchors(data, shift);
        spreadsheet.datas.forEach(data => (data[SHIFT_HOOK] = this.onShift));

        // x-spreadsheet re-renders its canvas on every scroll, resize, edit and sheet switch
        const { table } = spreadsheet.sheet;
        this.table = table;
        this.originalRender = table.render;
        table.render = (...args) => {
            const result = this.originalRender.apply(table, args);
            this.schedule();
            return result;
        };
        this.schedule();
    }

    shiftAnchors(data, { type, index, count }) {
        const original = this.originals.get(data);
        const sheet = original !== undefined && this.layout.sheets[original];
        if (!sheet || !sheet.drawing) return;
        const key = type === "row" ? "row" : "col";
        const offsetKey = type === "row" ? "rowOff" : "colOff";
        sheet.drawing.objects.forEach(({ anchor }) => {
            [anchor.from, anchor.to].forEach(marker => {
                if (!marker || marker[key] < index) return;
                if (count < 0 && marker[key] < index - count) {
                    // Inside the deleted range: move to its start
                    marker[key] = index;
                    marker[offsetKey] = 0;
                } else {
                    marker[key] += count;
                }
                anchor.moved = true;
            });
        });
        this.schedule();
    }

    hasObjects() {
        return this.layout.sheets.some(sheet => sheet.drawing && sheet.drawing.objects.length);
    }

    schedule() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.update();
        });
    }

    update() {
        const data = this.spreadsheet.sheet.data;
        if (!data[SHIFT_HOOK]) data[SHIFT_HOOK] = this.onShift;
        const original = this.originals.get(data);
        this.groups.forEach((group, index) => {
            group.items.forEach(item => (item.el.style.display = index === original ? "" : "none"));
        });
        if (original === undefined) return;

        const group = this.groupFor(original);
        if (!group.items.length) return;

        const { cols, rows, scroll } = data;
        const fw = cols.indexWidth;
        const fh = rows.height;
        const [fri, fci] = data.freeze;
        const tx = data.freezeTotalWidth();
        const ty = data.freezeTotalHeight();
        const viewWidth = data.viewWidth();
        const viewHeight = data.viewHeight();
        // Leave the scrollbars (15px) uncovered
        setBox(this.fixedLayer, fw, fh, viewWidth - fw - 15, viewHeight - fh - 15);
        setBox(this.scrollLayer, fw + tx, fh + ty, viewWidth - fw - tx - 15, viewHeight - fh - ty - 15);

        group.items.forEach(item => {
            const box = anchorBox(item.object.anchor, cols, rows);
            if (!box) return;
            // Objects that start in the frozen area stay put on that axis, like in Excel
            const scrollsX = item.object.anchor.from ? item.object.anchor.from.col >= fci : true;
            const scrollsY = item.object.anchor.from ? item.object.anchor.from.row >= fri : true;
            const inScrollLayer = scrollsX && scrollsY;
            const layer = inScrollLayer ? this.scrollLayer : this.fixedLayer;
            if (item.el.parentNode !== layer) layer.appendChild(item.el);

            const left = box.left - (scrollsX ? scroll.x : 0) - (inScrollLayer ? tx : 0);
            const top = box.top - (scrollsY ? scroll.y : 0) - (inScrollLayer ? ty : 0);
            setBox(item.el, left, top, box.width, box.height);

            if (item.chart) this.refreshChart(item);
        });
    }

    groupFor(index) {
        if (this.groups.has(index)) return this.groups.get(index);
        const sheet = this.layout.sheets[index];
        const objects = (sheet && sheet.drawing && sheet.drawing.objects) || [];
        const group = { items: objects.map(object => this.createItem(object, index)).filter(Boolean) };
        this.groups.set(index, group);
        return group;
    }

    createItem(object, sheetIndex) {
        const el = document.createElement("div");
        el.className = "xs-drawing xs-drawing-" + object.kind;
        this.scrollLayer.appendChild(el);
        // Clicks reach the cell below, so a chart doesn't block selecting or editing it
        ["mousedown", "dblclick", "contextmenu"].forEach(type =>
            el.addEventListener(type, evt => {
                if (evt.button === 2 && type === "mousedown") return;
                evt.preventDefault();
                this.spreadsheet.sheet.overlayerEl.el.dispatchEvent(
                    new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: evt.clientX,
                        clientY: evt.clientY,
                        button: evt.button,
                        buttons: evt.buttons,
                        detail: evt.detail,
                        shiftKey: evt.shiftKey,
                        ctrlKey: evt.ctrlKey,
                        metaKey: evt.metaKey
                    })
                );
            })
        );

        // Keep the grid scrollable with the mouse wheel while the pointer is over a chart
        el.addEventListener(
            "wheel",
            evt => {
                evt.preventDefault();
                const { deltaX, deltaY, deltaMode } = evt;
                this.spreadsheet.sheet.overlayerEl.el.dispatchEvent(
                    new WheelEvent("mousewheel", { deltaX, deltaY, deltaMode, bubbles: true, cancelable: true })
                );
            },
            { passive: false }
        );

        if (object.kind === "picture") {
            const ext = object.path.slice(object.path.lastIndexOf(".") + 1).toLowerCase();
            const url = URL.createObjectURL(
                new Blob([object.content], { type: IMAGE_TYPES[ext] || "application/octet-stream" })
            );
            this.urls.push(url);
            const img = document.createElement("img");
            img.src = url;
            img.alt = "";
            el.appendChild(img);
            return { el, object };
        }

        const canvas = document.createElement("canvas");
        el.appendChild(canvas);
        const config = buildChartConfig(object.chart, this.resolver(sheetIndex), this.colors);
        if (!config) {
            el.remove();
            return null;
        }
        const chart = new Chart(canvas, config.chartjs);
        return { el, object, chart, signature: config.signature, sheetIndex };
    }

    // Re-reads the chart's cells and updates it when they changed
    refreshChart(item) {
        const config = buildChartConfig(item.object.chart, this.resolver(item.sheetIndex), this.colors);
        if (!config || config.signature === item.signature) return;
        item.signature = config.signature;
        item.chart.data = config.chartjs.data;
        item.chart.options = config.chartjs.options;
        item.chart.update("none");
    }

    // Looks up chart references ("Sheet1!$B$2:$B$5") in the grid's current data
    resolver() {
        const sheetsByName = {};
        this.spreadsheet.datas.forEach(data => {
            const original = this.originals.get(data);
            if (original !== undefined) sheetsByName[this.layout.sheets[original].name.toLowerCase()] = data;
        });
        return (ref, cache, numeric, visibleOnly) =>
            resolveRef(ref, sheetsByName, cache, numeric, visibleOnly, this.engine);
    }

    destroy() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.table.render = this.originalRender;
        this.groups.forEach(group => group.items.forEach(item => item.chart && item.chart.destroy()));
        this.urls.forEach(url => URL.revokeObjectURL(url));
        this.fixedLayer.remove();
        this.scrollLayer.remove();
        this.groups.clear();
    }
}

// Calls a sheet's shift hook after x-spreadsheet inserts or deletes rows/columns at the selection
function installShiftHook(sampleData) {
    const proto = Object.getPrototypeOf(sampleData);
    if (proto[SHIFT_HOOK + "Installed"]) return;
    const { insert, delete: remove } = proto;
    Object.assign(proto, {
        insert(type, n = 1) {
            const { sri, sci } = this.selector.range;
            const result = insert.call(this, type, n);
            if (this[SHIFT_HOOK]) this[SHIFT_HOOK](this, { type, index: type === "row" ? sri : sci, count: n });
            return result;
        },
        delete(type) {
            const { sri, sci, eri, eci } = this.selector.range;
            const result = remove.call(this, type);
            const [start, end] = type === "row" ? [sri, eri] : [sci, eci];
            if (this[SHIFT_HOOK]) this[SHIFT_HOOK](this, { type, index: start, count: -(end - start + 1) });
            return result;
        }
    });
    proto[SHIFT_HOOK + "Installed"] = true;
}

function createLayer(className) {
    const el = document.createElement("div");
    el.className = className;
    return el;
}

function setBox(el, left, top, width, height) {
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.width = Math.max(0, Math.round(width)) + "px";
    el.style.height = Math.max(0, Math.round(height)) + "px";
}

// Pixel box of an anchor, in grid content coordinates (0,0 = top-left of cell A1)
function anchorBox(anchor, cols, rows) {
    const point = marker => ({
        x: cols.sumWidth(0, marker.col) + marker.colOff / EMU_PER_PIXEL,
        y: rows.sumHeight(0, marker.row) + marker.rowOff / EMU_PER_PIXEL
    });
    if (anchor.type === "twoCell" && anchor.from && anchor.to) {
        const from = point(anchor.from);
        const to = point(anchor.to);
        return { left: from.x, top: from.y, width: to.x - from.x, height: to.y - from.y };
    }
    if (anchor.type === "oneCell" && anchor.from && anchor.ext) {
        const from = point(anchor.from);
        return {
            left: from.x,
            top: from.y,
            width: anchor.ext.cx / EMU_PER_PIXEL,
            height: anchor.ext.cy / EMU_PER_PIXEL
        };
    }
    if (anchor.type === "absolute" && anchor.ext) {
        return {
            left: anchor.pos.x / EMU_PER_PIXEL,
            top: anchor.pos.y / EMU_PER_PIXEL,
            width: anchor.ext.cx / EMU_PER_PIXEL,
            height: anchor.ext.cy / EMU_PER_PIXEL
        };
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading chart data from the grid

/**
 * Values of a chart reference such as "Sheet1!$B$2:$B$5" or "(Sheet1!$A$1,Sheet1!$A$3)", read from the grid.
 * Falls back to the values Excel cached when the sheet isn't in the grid (e.g. it was deleted).
 *
 * @returns {Array<string|number|null>}
 */
export function resolveRef(ref, sheetsByName, cache = [], numeric = false, visibleOnly = false, engine = null) {
    if (!ref) return cache.map(v => (numeric ? toNumber(v) : v));
    const parts = splitRef(ref.replace(/^\(|\)$/g, ""));
    const values = [];
    for (const part of parts) {
        const match = part.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
        if (!match) return cache.map(v => (numeric ? toNumber(v) : v));
        const sheetName = (match[1] ? match[1].replace(/''/g, "'") : match[2]).toLowerCase();
        const data = sheetsByName[sheetName];
        if (!data) return cache.map(v => (numeric ? toNumber(v) : v));
        const range = XLSX.utils.decode_range(match[3].replace(/\$/g, ""));
        for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
                if (visibleOnly && (data.rows.isHide(r) || data.cols.isHide(c))) continue;
                values.push(cellValue(data, r, c, numeric, engine));
            }
        }
    }
    return values;
}

function splitRef(ref) {
    const parts = [];
    let current = "";
    let quoted = false;
    for (const ch of ref) {
        if (ch === "'") quoted = !quoted;
        if (ch === "," && !quoted) {
            parts.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts.map(p => p.trim()).filter(Boolean);
}

// A cell's value: numbers for chart values (formulas calculated by the grid's formula engine), the shown text for
// categories (so dates keep their format)
function cellValue(data, r, c, numeric, engine) {
    const gridCell = data.getCell(r, c);
    if (!gridCell) return null;
    const text = gridCell.text == null ? "" : String(gridCell.text);
    const source = gridCell.source;
    const unedited = source && source.text === text && source.cell;
    if (numeric) {
        if (engine) return toNumber(engine.cellValue(data, r, c));
        return toNumber(unedited ? source.cell.v : text);
    }
    if (text[0] !== "=") return text;
    if (engine) {
        const value = engine.cellValue(data, r, c);
        return value == null ? "" : String(value);
    }
    return unedited ? String(source.cell.v) : text;
}

function toNumber(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    const text = String(value).trim();
    const percent = text.endsWith("%");
    const n = Number(text.replace(/[^\d.eE+-]/g, ""));
    if (!Number.isFinite(n)) return null;
    return percent ? n / 100 : n;
}

// ---------------------------------------------------------------------------------------------------------------
// Chart.js configuration

/**
 * Builds a Chart.js configuration for a chart read by `readChart` (ooxml.js).
 *
 * @param {Object} chart
 * @param {Function} resolve `(ref, cache, numeric, visibleOnly) => values`
 * @param {string[]} colors Theme accent colours, used for series without their own colour
 * @returns {{ chartjs: Object, signature: string } | null}
 */
export function buildChartConfig(chart, resolve, colors) {
    const plots = chart.plots.filter(plot => plot.series.length);
    if (!plots.length) return null;
    const main = plots[0];
    const palette = i => colors[i % colors.length];

    const read = (dataRef, numeric) =>
        dataRef ? resolve(dataRef.ref, dataRef.cache || [], numeric, chart.plotVisOnly) : [];
    const seriesName = (series, i) => {
        if (!series.name) return `Series${i + 1}`;
        const values = read(series.name, false).filter(v => v != null && v !== "");
        return values.length ? values.join(" ") : `Series${i + 1}`;
    };
    const valueFormat = (plots[0].series[0].values && plots[0].series[0].values.formatCode) || null;
    const format = value => formatNumber(value, valueFormat);

    let labels = [];
    const datasets = [];
    let seriesIndex = 0;

    let hasSecondary = false;

    plots.forEach(plot => {
        plot.series.forEach(series => {
            const i = seriesIndex++;
            const color = series.color || palette(series.index != null ? series.index : i);
            const name = seriesName(series, i);
            const values = read(series.values, true);
            const shown = series.labels || plot.labels;
            const round = plot.type === "pie" || plot.type === "doughnut";
            const axisKey = plot.horizontal ? "xAxisID" : "yAxisID";
            const extra = {
                xsLabels: shown && (shown.value || shown.percent || shown.category) ? shown : null,
                ...(plot.secondary && !round && { [axisKey]: "y1" })
            };
            if (plot.secondary && !round) hasSecondary = true;

            if (plot.type === "scatter") {
                const xs = read(series.categories, true);
                datasets.push({
                    type: "scatter",
                    label: name,
                    data: values.map((y, k) => ({ x: xs[k] != null ? xs[k] : k + 1, y })).filter(p => p.y != null),
                    backgroundColor: color,
                    borderColor: series.lineColor || color,
                    showLine: !series.noLine && /line|smooth/i.test(plot.scatterStyle || "") && !series.noLine,
                    tension: series.smooth ? 0.4 : 0,
                    pointRadius: series.noMarker ? 0 : 4,
                    ...extra
                });
                addTrendlines(datasets, series, datasets[datasets.length - 1], name, true);
                return;
            }

            const categories = read(series.categories, false);
            if (categories.length > labels.length) labels = categories.map(v => (v == null ? "" : String(v)));
            if (!labels.length) labels = values.map((v, k) => String(k + 1));

            if (plot.type === "pie" || plot.type === "doughnut") {
                datasets.push({
                    type: plot.type,
                    label: name,
                    data: values,
                    backgroundColor: values.map((v, k) => series.pointColors[k] || palette(k)),
                    borderColor: "#FFFFFF",
                    borderWidth: 1,
                    ...extra
                });
                return;
            }

            const isLine = plot.type === "line" || plot.type === "area" || plot.type === "radar";
            datasets.push({
                type: plot.type === "area" ? "line" : plot.type,
                label: name,
                data: values,
                backgroundColor:
                    plot.type === "area" || plot.type === "radar"
                        ? withAlpha(color, plot.type === "area" ? 0.75 : 0.25)
                        : color,
                borderColor: isLine ? series.lineColor || color : color,
                borderWidth: isLine ? 2.25 : 0,
                fill:
                    plot.type === "area"
                        ? plot.grouping === "standard"
                            ? "origin"
                            : i === 0
                            ? "origin"
                            : "-1"
                        : plot.type === "radar",
                tension: series.smooth ? 0.4 : 0,
                pointRadius: plot.type === "line" && !series.noMarker ? 3 : 0,
                stack:
                    plot.grouping === "stacked" || plot.grouping === "percentStacked"
                        ? "stack" + chart.plots.indexOf(plot)
                        : undefined,
                ...extra
            });
            addTrendlines(datasets, series, datasets[datasets.length - 1], name, false);
        });
    });

    if (main.grouping === "percentStacked" && main.type !== "pie") {
        labels.forEach((label, k) => {
            const series = datasets.filter(d => !d.xsTrend);
            const total = series.reduce((sum, d) => sum + Math.abs(d.data[k] || 0), 0);
            series.forEach(d => {
                d.data[k] = total ? (d.data[k] || 0) / total : 0;
            });
        });
    }

    const type = main.type === "area" ? "line" : main.type;
    const isRound = type === "pie" || type === "doughnut";
    const stacked = main.grouping === "stacked" || main.grouping === "percentStacked";
    const horizontal = main.type === "bar" && main.horizontal;

    let title = chart.title;
    if (
        !title &&
        !chart.autoTitleDeleted &&
        (chart.hasTitleElement || datasets.filter(d => !d.xsTrend).length === 1) &&
        datasets.filter(d => !d.xsTrend).length === 1
    ) {
        title = datasets[0].label;
    }

    const font = { family: "Calibri, Carlito, Arial, sans-serif", size: 12 };
    const tickFormat = main.grouping === "percentStacked" ? v => Math.round(v * 100) + "%" : format;
    const axis = (position, isValueAxis) => ({
        stacked,
        beginAtZero: true,
        grid: { color: "#D9D9D9", display: isValueAxis },
        ticks: { font, color: "#595959", ...(isValueAxis && { callback: tickFormat }) },
        title: chart.axisTitles[position]
            ? { display: true, text: chart.axisTitles[position], font }
            : { display: false }
    });

    const scales = {};
    if (type === "scatter") {
        scales.x = { ...axis("b", true), type: "linear", stacked: false, ticks: { font, color: "#595959" } };
        scales.y = { ...axis("l", true), stacked: false };
    } else if (type === "radar") {
        scales.r = { beginAtZero: true, ticks: { font, callback: tickFormat }, pointLabels: { font } };
    } else if (!isRound) {
        // Excel draws the first category of a horizontal bar chart at the bottom
        scales[horizontal ? "y" : "x"] = { ...axis(horizontal ? "l" : "b", false), reverse: horizontal };
        scales[horizontal ? "x" : "y"] = axis(horizontal ? "b" : "l", true);
        if (hasSecondary) {
            // Excel's secondary value axis, on the right (on top for horizontal bars)
            scales.y1 = {
                ...axis("r", true),
                stacked: false,
                axis: horizontal ? "x" : "y",
                position: horizontal ? "top" : "right",
                grid: { display: false }
            };
        }
    }

    const chartjs = {
        type,
        data: { labels: type === "scatter" ? undefined : labels, datasets },
        plugins: [dataLabels(format, main.grouping === "percentStacked")],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            indexAxis: horizontal ? "y" : "x",
            cutout: type === "doughnut" ? (main.holeSize || 50) + "%" : undefined,
            scales,
            plugins: {
                title: { display: Boolean(title), text: title || "", font: { ...font, size: 14 }, color: "#595959" },
                legend: {
                    display: chart.legend != null,
                    position: LEGEND_POSITIONS[chart.legend] || "right",
                    labels: { font, color: "#595959", boxWidth: 10 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const value =
                                type === "scatter"
                                    ? ctx.parsed.y
                                    : isRound
                                    ? ctx.parsed
                                    : horizontal
                                    ? ctx.parsed.x
                                    : ctx.parsed.y;
                            const prefix = isRound ? ctx.label : ctx.dataset.label;
                            return `${prefix}: ${
                                main.grouping === "percentStacked" ? Math.round(value * 1000) / 10 + "%" : format(value)
                            }`;
                        }
                    }
                }
            }
        }
    };

    return { chartjs, signature: JSON.stringify([title, labels, datasets.map(d => d.data)]) };
}

// Excel trendlines, drawn as dashed lines: linear (least squares) and moving average
function addTrendlines(datasets, series, dataset, name, isScatter) {
    (series.trendlines || []).forEach(trendline => {
        const points = isScatter
            ? dataset.data.map(p => [p.x, p.y])
            : dataset.data.map((y, k) => [k, y]).filter(p => p[1] != null);
        let line;
        if (trendline.type === "movingAvg") {
            const period = Math.max(2, trendline.period);
            line = points.map((p, k) =>
                k + 1 < period ? null : points.slice(k + 1 - period, k + 1).reduce((sum, q) => sum + q[1], 0) / period
            );
        } else {
            // Linear; Excel's other types (exponential, polynomial, ...) are drawn as their linear fit
            const n = points.length;
            if (n < 2) return;
            const sx = points.reduce((sum, p) => sum + p[0], 0);
            const sy = points.reduce((sum, p) => sum + p[1], 0);
            const sxx = points.reduce((sum, p) => sum + p[0] * p[0], 0);
            const sxy = points.reduce((sum, p) => sum + p[0] * p[1], 0);
            const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
            const intercept = (sy - slope * sx) / n;
            line = points.map(p => intercept + slope * p[0]);
        }
        const color = trendline.color || dataset.borderColor || "#595959";
        datasets.push({
            type: isScatter ? "scatter" : "line",
            label: (trendline.type === "movingAvg" ? "Moving average" : "Linear") + " (" + name + ")",
            data: isScatter ? points.map((p, k) => ({ x: p[0], y: line[k] })) : line,
            showLine: true,
            borderColor: color,
            backgroundColor: color,
            xsTrend: true,
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            ...(dataset.yAxisID && { yAxisID: dataset.yAxisID }),
            ...(dataset.xAxisID && { xAxisID: dataset.xAxisID })
        });
    });
}

// Data labels as Excel shows them (value, percentage, category), for datasets with xsLabels
function dataLabels(format, percentStacked) {
    return {
        id: "xsDataLabels",
        afterDatasetsDraw(chartInstance) {
            const { ctx } = chartInstance;
            chartInstance.data.datasets.forEach((dataset, d) => {
                const shown = dataset.xsLabels;
                const meta = chartInstance.getDatasetMeta(d);
                if (!shown || meta.hidden) return;
                const total = dataset.data.reduce((sum, v) => sum + (typeof v === "number" ? Math.abs(v) : 0), 0);
                const round = meta.type === "pie" || meta.type === "doughnut";
                ctx.save();
                ctx.font = "11px Calibri, Carlito, Arial, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = round ? "#FFFFFF" : "#404040";
                meta.data.forEach((element, k) => {
                    const raw = dataset.data[k];
                    const value = raw && typeof raw === "object" ? raw.y : raw;
                    if (value == null) return;
                    const parts = [];
                    if (shown.category && chartInstance.data.labels) parts.push(chartInstance.data.labels[k]);
                    if (shown.value) parts.push(percentStacked ? Math.round(value * 100) + "%" : format(value));
                    if (shown.percent && total) parts.push(Math.round((Math.abs(value) / total) * 100) + "%");
                    const { x, y } = element.tooltipPosition();
                    ctx.fillText(parts.join(round ? " " : ", "), x, round ? y : y - 10);
                });
                ctx.restore();
            });
        }
    };
}

// Formats chart numbers with the series' Excel number format, when SheetJS can apply it
function formatNumber(value, formatCode) {
    if (value == null || typeof value !== "number") return value;
    if (formatCode && formatCode !== "General") {
        try {
            return XLSX.SSF.format(formatCode, value);
        } catch (e) {
            // Fall through to the default format
        }
    }
    return value.toLocaleString();
}

function withAlpha(hex, alpha) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
