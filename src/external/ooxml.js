import * as XLSX from "xlsx";

/*
 * Reads the parts of an .xlsx package that the free SheetJS build ignores: cell styles, column widths, row heights,
 * frozen panes, and the charts and pictures placed on each sheet. Everything comes straight from the package XML, so
 * no extra spreadsheet library is needed.
 */

const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_DRAWING = NS_REL + "/drawing";

// Excel's default palette for `indexed` colours (legacy .xls colours, still used by many generators)
const INDEXED_COLORS = [
    "000000",
    "FFFFFF",
    "FF0000",
    "00FF00",
    "0000FF",
    "FFFF00",
    "FF00FF",
    "00FFFF",
    "000000",
    "FFFFFF",
    "FF0000",
    "00FF00",
    "0000FF",
    "FFFF00",
    "FF00FF",
    "00FFFF",
    "800000",
    "008000",
    "000080",
    "808000",
    "800080",
    "008080",
    "C0C0C0",
    "808080",
    "9999FF",
    "993366",
    "FFFFCC",
    "CCFFFF",
    "660066",
    "FF8080",
    "0066CC",
    "CCCCFF",
    "000080",
    "FF00FF",
    "FFFF00",
    "00FFFF",
    "800080",
    "800000",
    "008080",
    "0000FF",
    "00CCFF",
    "CCFFFF",
    "CCFFCC",
    "FFFF99",
    "99CCFF",
    "FF99CC",
    "CC99FF",
    "FFCC99",
    "3366FF",
    "33CCCC",
    "99CC00",
    "FFCC00",
    "FF9900",
    "FF6600",
    "666699",
    "969696",
    "003366",
    "339966",
    "003300",
    "333300",
    "993300",
    "993366",
    "333399",
    "333333"
];

// Office 2013+ theme, used when a package has no theme part
const DEFAULT_THEME = [
    "FFFFFF",
    "000000",
    "E7E6E6",
    "44546A",
    "4472C4",
    "ED7D31",
    "A5A5A5",
    "FFC000",
    "5B9BD5",
    "70AD47",
    "0563C1",
    "954F72"
];

// Excel border styles mapped onto the ones x-spreadsheet can draw
const BORDER_STYLES = {
    hair: "thin",
    thin: "thin",
    medium: "medium",
    thick: "thick",
    dashed: "dashed",
    mediumDashed: "dashed",
    dashDot: "dashed",
    mediumDashDot: "dashed",
    dashDotDot: "dotted",
    mediumDashDotDot: "dotted",
    slantDashDot: "dashed",
    dotted: "dotted",
    double: "double"
};

const PRESET_COLORS = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF" };

const HORIZONTAL_ALIGN = { left: "left", center: "center", centerContinuous: "center", right: "right" };
const VERTICAL_ALIGN = { top: "top", center: "middle", bottom: "bottom" };

// Font names end up in x-spreadsheet's toolbar (set as HTML) and in CSS font rules, so only plain names are accepted
const SAFE_FONT_NAME = /^[A-Za-z0-9 .,-]{1,64}$/;
const DEFAULT_FONT_NAME = "Calibri";

export function safeFontName(name) {
    return typeof name === "string" && SAFE_FONT_NAME.test(name.trim()) ? name.trim() : DEFAULT_FONT_NAME;
}

// Pictures are shown through blob: URLs on the app's origin. Only raster formats: an SVG opened in its own tab could
// run script. Excel always stores a PNG next to an SVG picture.
const RASTER_IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

// Columns beyond this are never shown; <col max="16384"> ("all remaining columns") would otherwise cost 16k steps
const MAX_COLUMNS = 1024;

// One EMU is 1/914400 inch; at 96 dpi that's 9525 EMU per pixel
export const EMU_PER_PIXEL = 9525;
const PIXELS_PER_POINT = 96 / 72;

/**
 * Opens an .xlsx/.xlsm package. Returns null for anything that isn't a ZIP-based workbook (csv, xls, ...).
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {{ zip: Object, has: Function, text: Function, bytes: Function, paths: string[] } | null}
 */
export function openPackage(data) {
    let zip;
    try {
        zip = XLSX.CFB.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: "array" });
    } catch (e) {
        return null;
    }
    const paths = zip.FullPaths.map(p => p.replace(/^Root Entry\//, "")).filter(p => p && !p.endsWith("/"));
    if (!paths.includes("[Content_Types].xml")) return null;

    const bytes = path => {
        const entry = XLSX.CFB.find(zip, "/" + path);
        return entry && entry.content ? entry.content : null;
    };
    const decoder = new TextDecoder("utf-8");
    const text = path => {
        const content = bytes(path);
        return content ? decoder.decode(content instanceof Uint8Array ? content : new Uint8Array(content)) : null;
    };
    return { zip, paths, has: path => paths.includes(path), text, bytes };
}

/**
 * Reads the layout of every sheet in workbook order (the same order as SheetJS's `SheetNames`).
 *
 * @param {ReturnType<typeof openPackage>} pkg
 * @returns {{ defaultFont: Object, sheets: Object[] } | null}
 */
export function readLayout(pkg) {
    if (!pkg) return null;
    const workbookPath = "xl/workbook.xml";
    const workbook = parseXml(pkg.text(workbookPath));
    if (!workbook) return null;

    const theme = readTheme(parseXml(pkg.text("xl/theme/theme1.xml")));
    const styles = readStyles(parseXml(pkg.text("xl/styles.xml")), theme);
    const workbookRels = readRels(pkg, workbookPath);

    const sheets = descendants(workbook, "sheet").map(sheetEl => {
        const rel = workbookRels[attrNS(sheetEl, NS_REL, "id")];
        const path = rel ? rel.path : null;
        const xml = path ? parseXml(pkg.text(path)) : null;
        const sheet = xml ? readSheet(xml, styles) : emptySheet();
        sheet.name = sheetEl.getAttribute("name");
        sheet.path = path;
        sheet.drawing = xml && path ? readSheetDrawing(pkg, xml, path, theme) : null;
        return sheet;
    });

    return { defaultFont: styles.defaultFont, fontNames: styles.fontNames, theme, sheets };
}

// ---------------------------------------------------------------------------------------------------------------
// Sheets

function emptySheet() {
    return { cols: {}, rows: {}, cellStyles: {}, defaultColWidth: 64, defaultRowHeight: 20, freeze: null };
}

function readSheet(xml, styles) {
    const sheet = emptySheet();

    const format = descendants(xml, "sheetFormatPr")[0];
    if (format) {
        const baseColWidth = numberAttr(format, "baseColWidth", 8);
        const defaultColWidth = numberAttr(format, "defaultColWidth", null);
        // Without defaultColWidth Excel uses baseColWidth characters plus 5px of padding
        sheet.defaultColWidth = defaultColWidth != null ? charsToPixels(defaultColWidth) : baseColWidth * 7 + 5;
        sheet.defaultRowHeight = Math.round(numberAttr(format, "defaultRowHeight", 15) * PIXELS_PER_POINT);
    }

    descendants(xml, "col").forEach(col => {
        const min = Math.max(numberAttr(col, "min", 1) - 1, 0);
        const max = Math.min(numberAttr(col, "max", min + 1) - 1, MAX_COLUMNS - 1);
        const hidden = boolAttr(col, "hidden");
        const width = col.hasAttribute("width") ? charsToPixels(numberAttr(col, "width", 0)) : null;
        for (let c = min; c <= max; c++) {
            sheet.cols[c] = { width, hidden };
        }
    });

    descendants(xml, "row").forEach(row => {
        const r = numberAttr(row, "r", 0) - 1;
        if (r < 0) return;
        const hidden = boolAttr(row, "hidden");
        const height = row.hasAttribute("ht") ? Math.round(numberAttr(row, "ht", 15) * PIXELS_PER_POINT) : null;
        if (hidden || (height != null && boolAttr(row, "customHeight"))) {
            sheet.rows[r] = { height, hidden };
        } else if (height != null) {
            // Excel stores auto-fitted heights too (e.g. for wrapped text); keep them so the text fits
            sheet.rows[r] = { height, hidden: false };
        }

        children(row, "c").forEach(cell => {
            const xf = numberAttr(cell, "s", 0);
            if (!xf) return;
            const style = styles.cellXfs[xf];
            if (style) sheet.cellStyles[cell.getAttribute("r")] = style;
        });
    });

    const pane = descendants(xml, "pane")[0];
    if (pane && /^frozen/.test(pane.getAttribute("state") || "")) {
        const c = numberAttr(pane, "xSplit", 0);
        const r = numberAttr(pane, "ySplit", 0);
        if (r > 0 || c > 0) sheet.freeze = XLSX.utils.encode_cell({ r, c });
    }

    return sheet;
}

// Excel column width (in characters of the default font) to pixels, for the 7px-wide digits of Calibri 11
function charsToPixels(width) {
    return Math.trunc(((256 * width + Math.trunc(128 / 7)) / 256) * 7);
}

// ---------------------------------------------------------------------------------------------------------------
// Styles

function readStyles(xml, theme) {
    const result = { cellXfs: [], defaultFont: { name: "Calibri", size: 11 }, fontNames: [] };
    if (!xml) return result;

    const fonts = childList(xml, "fonts", "font").map(font => readFont(font, theme));
    const fills = childList(xml, "fills", "fill").map(fill => readFill(fill, theme));
    const borders = childList(xml, "borders", "border").map(border => readBorder(border, theme));
    if (fonts[0]) result.defaultFont = fonts[0];
    result.fontNames = Array.from(new Set(fonts.map(font => font.name)));

    result.cellXfs = childList(xml, "cellXfs", "xf").map(xf => {
        const style = {};
        const font = fonts[numberAttr(xf, "fontId", 0)];
        if (font) {
            const { name, size, bold, italic } = font;
            if (!sameFont(font, result.defaultFont)) style.font = { name, size, bold, italic };
            if (font.color) style.color = font.color;
            if (font.underline) style.underline = true;
            if (font.strike) style.strike = true;
        }
        const fill = fills[numberAttr(xf, "fillId", 0)];
        if (fill) style.bgcolor = fill;

        const border = borders[numberAttr(xf, "borderId", 0)];
        if (border) style.border = border;

        const alignment = children(xf, "alignment")[0];
        if (alignment) {
            const align = HORIZONTAL_ALIGN[alignment.getAttribute("horizontal")];
            const valign = VERTICAL_ALIGN[alignment.getAttribute("vertical")];
            if (align) style.align = align;
            if (valign) style.valign = valign;
            if (boolAttr(alignment, "wrapText")) style.textwrap = true;
        }
        return Object.keys(style).length ? style : null;
    });

    return result;
}

function sameFont(a, b) {
    return a.name === b.name && a.size === b.size && !a.bold && !a.italic;
}

function readFont(font, theme) {
    const val = name => {
        const el = children(font, name)[0];
        return el ? el.getAttribute("val") : null;
    };
    const flag = name => {
        const el = children(font, name)[0];
        // <b/> means bold; <b val="0"/> explicitly turns it off
        return Boolean(el) && el.getAttribute("val") !== "0" && el.getAttribute("val") !== "false";
    };
    const underline = children(font, "u")[0];
    return {
        name: safeFontName(val("name")),
        size: Number(val("sz")) || 11,
        bold: flag("b"),
        italic: flag("i"),
        strike: flag("strike"),
        underline: Boolean(underline) && underline.getAttribute("val") !== "none",
        color: readColor(children(font, "color")[0], theme)
    };
}

// Solid (and patterned) fills become a background colour; "none" and the "gray125" placeholder don't
function readFill(fill, theme) {
    const pattern = children(fill, "patternFill")[0];
    if (pattern) {
        const type = pattern.getAttribute("patternType");
        if (!type || type === "none" || type === "gray125") return null;
        return readColor(children(pattern, "fgColor")[0], theme) || readColor(children(pattern, "bgColor")[0], theme);
    }
    // Gradients: use the first stop
    const stop = descendants(fill, "stop")[0];
    return stop ? readColor(children(stop, "color")[0], theme) : null;
}

function readBorder(border, theme) {
    const result = {};
    ["left", "right", "top", "bottom"].forEach(side => {
        const el = children(border, side)[0];
        const style = el && BORDER_STYLES[el.getAttribute("style")];
        if (style) result[side] = [style, readColor(children(el, "color")[0], theme) || "#000000"];
    });
    return Object.keys(result).length ? result : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Colours

function readTheme(xml) {
    if (!xml) return DEFAULT_THEME.slice();
    const scheme = descendants(xml, "clrScheme")[0];
    if (!scheme) return DEFAULT_THEME.slice();
    const byName = {};
    Array.from(scheme.children).forEach(el => {
        const color = el.children[0];
        if (!color) return;
        byName[el.localName] = color.getAttribute("lastClr") || color.getAttribute("val");
    });
    // Theme colour indexes in cell styles swap the first two pairs: 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2
    const order = [
        "lt1",
        "dk1",
        "lt2",
        "dk2",
        "accent1",
        "accent2",
        "accent3",
        "accent4",
        "accent5",
        "accent6",
        "hlink",
        "folHlink"
    ];
    return order.map((name, i) => (byName[name] || DEFAULT_THEME[i]).toUpperCase());
}

/**
 * Resolves a SpreadsheetML colour element (rgb, theme + tint, indexed) to "#RRGGBB", or null for automatic colours.
 */
export function readColor(el, theme) {
    if (!el) return null;
    let hex = null;
    if (el.hasAttribute("rgb")) {
        hex = el.getAttribute("rgb").slice(-6);
    } else if (el.hasAttribute("theme")) {
        hex = (theme || DEFAULT_THEME)[numberAttr(el, "theme", 0)] || null;
    } else if (el.hasAttribute("indexed")) {
        hex = INDEXED_COLORS[numberAttr(el, "indexed", 0)] || null;
    }
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
    const tint = numberAttr(el, "tint", 0);
    return "#" + (tint ? applyTint(hex, tint) : hex).toUpperCase();
}

// Excel's tint: lighten (positive) or darken (negative) the colour's HSL luminance
export function applyTint(hex, tint) {
    const [h, s, l] = rgbToHsl(hex);
    const lum = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    return hslToRgb(h, s, Math.min(1, Math.max(0, lum)));
}

function rgbToHsl(hex) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue(p, q, h + 1 / 3);
        g = hue(p, q, h);
        b = hue(p, q, h - 1 / 3);
    }
    return [r, g, b]
        .map(v =>
            Math.round(v * 255)
                .toString(16)
                .padStart(2, "0")
        )
        .join("");
}

// DrawingML colours used in charts: srgbClr / schemeClr / sysClr with lumMod/lumOff/tint/shade children
export function readDrawingColor(parent, theme) {
    if (!parent) return null;
    const el = Array.from(parent.children).find(c => /^(srgbClr|schemeClr|sysClr|prstClr)$/.test(c.localName));
    if (!el) return null;
    const colorName = el.getAttribute("val");
    let hex = null;
    if (el.localName === "srgbClr") {
        hex = colorName;
    } else if (el.localName === "sysClr") {
        hex = el.getAttribute("lastClr") || (colorName === "window" ? "FFFFFF" : "000000");
    } else if (el.localName === "schemeClr") {
        hex = schemeColor(colorName, theme);
    } else {
        hex = PRESET_COLORS[colorName];
    }
    if (!hex) return null;

    Array.from(el.children).forEach(mod => {
        const val = Number(mod.getAttribute("val")) / 100000;
        const [h, s, l] = rgbToHsl(hex);
        if (mod.localName === "lumMod") hex = hslToRgb(h, s, Math.min(1, l * val));
        else if (mod.localName === "lumOff") hex = hslToRgb(h, s, Math.min(1, l + val));
        else if (mod.localName === "tint") hex = applyTint(hex, 1 - val);
        else if (mod.localName === "shade") hex = applyTint(hex, val - 1);
    });
    return "#" + hex.toUpperCase();
}

function schemeColor(name, theme) {
    const t = theme || DEFAULT_THEME;
    const map = {
        bg1: 0,
        lt1: 0,
        tx1: 1,
        dk1: 1,
        bg2: 2,
        lt2: 2,
        tx2: 3,
        dk2: 3,
        accent1: 4,
        accent2: 5,
        accent3: 6,
        accent4: 7,
        accent5: 8,
        accent6: 9,
        hlink: 10,
        folHlink: 11
    };
    return name in map ? t[map[name]] : null;
}

/** The six theme accent colours, which Excel cycles through for chart series. */
export function accentColors(theme) {
    return (theme || DEFAULT_THEME).slice(4, 10).map(hex => "#" + hex);
}

// ---------------------------------------------------------------------------------------------------------------
// Drawings: charts and pictures

function readSheetDrawing(pkg, sheetXml, sheetPath, theme) {
    const drawingEl = descendants(sheetXml, "drawing")[0];
    if (!drawingEl) return null;
    const rel = readRels(pkg, sheetPath)[attrNS(drawingEl, NS_REL, "id")];
    if (!rel || rel.type !== REL_DRAWING) return null;

    const xml = parseXml(pkg.text(rel.path));
    if (!xml) return null;
    const drawingRels = readRels(pkg, rel.path);

    const objects = [];
    Array.from(xml.documentElement.children).forEach((anchor, anchorIndex) => {
        const position = readAnchor(anchor);
        if (!position) return;
        position.index = anchorIndex;

        const chartRef = descendants(anchor, "chart")[0];
        if (chartRef) {
            const chartRel = drawingRels[attrNS(chartRef, NS_REL, "id")];
            const chartXml = chartRel ? parseXml(pkg.text(chartRel.path)) : null;
            const chart = chartXml ? readChart(chartXml, theme) : null;
            if (chart) objects.push({ kind: "chart", anchor: position, chart });
            return;
        }

        const blip = descendants(anchor, "blip")[0];
        if (blip) {
            const imageRel = drawingRels[attrNS(blip, NS_REL, "embed")];
            const extension = imageRel ? imageRel.path.slice(imageRel.path.lastIndexOf(".") + 1).toLowerCase() : "";
            const content = RASTER_IMAGE_TYPES.includes(extension) ? pkg.bytes(imageRel.path) : null;
            if (content) objects.push({ kind: "picture", anchor: position, path: imageRel.path, content });
        }
    });

    return { path: rel.path, target: rel.target, objects, parts: collectParts(pkg, rel.path) };
}

function readAnchor(anchor) {
    const marker = name => {
        const el = children(anchor, name)[0];
        if (!el) return null;
        const num = n => Number(textOf(children(el, n)[0])) || 0;
        return { col: num("col"), colOff: num("colOff"), row: num("row"), rowOff: num("rowOff") };
    };
    const ext = el => (el ? { cx: numberAttr(el, "cx", 0), cy: numberAttr(el, "cy", 0) } : null);

    switch (anchor.localName) {
        case "twoCellAnchor":
            return { type: "twoCell", from: marker("from"), to: marker("to") };
        case "oneCellAnchor":
            return { type: "oneCell", from: marker("from"), ext: ext(children(anchor, "ext")[0]) };
        case "absoluteAnchor": {
            const pos = children(anchor, "pos")[0];
            return {
                type: "absolute",
                pos: { x: numberAttr(pos, "x", 0), y: numberAttr(pos, "y", 0) },
                ext: ext(children(anchor, "ext")[0])
            };
        }
        default:
            return null;
    }
}

// Every part a drawing pulls in (charts, their style/colour parts, images), so it can be copied into a saved file
function collectParts(pkg, rootPath) {
    const seen = new Set();
    const visit = path => {
        if (seen.has(path) || !pkg.has(path)) return;
        seen.add(path);
        const relsPath = relsPathFor(path);
        if (pkg.has(relsPath)) {
            seen.add(relsPath);
            Object.values(readRels(pkg, path)).forEach(rel => {
                if (!rel.external) visit(rel.path);
            });
        }
    };
    visit(rootPath);
    return Array.from(seen);
}

// ---------------------------------------------------------------------------------------------------------------
// Charts

const PLOT_TYPES = {
    barChart: "bar",
    bar3DChart: "bar",
    lineChart: "line",
    line3DChart: "line",
    areaChart: "area",
    area3DChart: "area",
    pieChart: "pie",
    pie3DChart: "pie",
    ofPieChart: "pie",
    doughnutChart: "doughnut",
    scatterChart: "scatter",
    bubbleChart: "scatter",
    radarChart: "radar"
};

/**
 * Reads the parts of a DrawingML chart needed to draw it: plots with their series (as cell references plus the
 * cached values Excel stored), title, legend and axis titles.
 */
export function readChart(xml, theme) {
    const chartEl = descendants(xml, "chart")[0];
    const plotArea = chartEl && children(chartEl, "plotArea")[0];
    if (!plotArea) return null;

    // Value axes on the right are secondary axes
    const secondaryAxes = new Set(
        children(plotArea, "valAx")
            .filter(ax => (children(ax, "axPos")[0] || { getAttribute: () => "l" }).getAttribute("val") === "r")
            .map(ax => (children(ax, "axId")[0] || { getAttribute: () => "" }).getAttribute("val"))
    );

    const plots = [];
    Array.from(plotArea.children).forEach(plotEl => {
        const type = PLOT_TYPES[plotEl.localName];
        if (!type) return;
        const val = name => {
            const el = children(plotEl, name)[0];
            return el ? el.getAttribute("val") : null;
        };
        plots.push({
            type,
            horizontal: val("barDir") === "bar",
            grouping: val("grouping") || "standard",
            varyColors: val("varyColors") === "1",
            scatterStyle: val("scatterStyle"),
            holeSize: Number(val("holeSize")) || 50,
            secondary: children(plotEl, "axId").some(ax => secondaryAxes.has(ax.getAttribute("val"))),
            labels: readLabels(children(plotEl, "dLbls")[0]),
            series: children(plotEl, "ser").map(ser => readSeries(ser, theme))
        });
    });
    if (!plots.length) return null;

    const titleEl = children(chartEl, "title")[0];
    const autoTitleDeleted = children(chartEl, "autoTitleDeleted")[0];
    const legendEl = children(chartEl, "legend")[0];
    const legendPos = legendEl && children(legendEl, "legendPos")[0];

    const axisTitles = {};
    ["catAx", "valAx", "dateAx"].forEach(name => {
        children(plotArea, name).forEach(ax => {
            const title = children(ax, "title")[0];
            const pos = children(ax, "axPos")[0];
            if (title && pos) axisTitles[pos.getAttribute("val")] = readText(title);
        });
    });

    return {
        title: titleEl ? readText(titleEl) : null,
        hasTitleElement: Boolean(titleEl),
        autoTitleDeleted: Boolean(autoTitleDeleted) && autoTitleDeleted.getAttribute("val") === "1",
        legend: legendEl ? (legendPos && legendPos.getAttribute("val")) || "r" : null,
        // Excel leaves out hidden rows and columns unless "Show data in hidden rows and columns" is on
        plotVisOnly: (children(chartEl, "plotVisOnly")[0] || { getAttribute: () => "1" }).getAttribute("val") !== "0",
        axisTitles,
        plots
    };
}

function readSeries(ser, theme) {
    const tx = children(ser, "tx")[0];
    const spPr = children(ser, "spPr")[0];
    const marker = children(ser, "marker")[0];
    const markerSymbol = marker && children(marker, "symbol")[0];
    const points = {};
    children(ser, "dPt").forEach(dPt => {
        const idx = children(dPt, "idx")[0];
        const color = fillColor(children(dPt, "spPr")[0], theme);
        if (idx && color) points[Number(idx.getAttribute("val"))] = color;
    });

    return {
        index: Number((children(ser, "idx")[0] || { getAttribute: () => 0 }).getAttribute("val")) || 0,
        name: tx ? readDataRef(tx) : null,
        categories: readDataRef(children(ser, "cat")[0] || children(ser, "xVal")[0]),
        values: readDataRef(children(ser, "val")[0] || children(ser, "yVal")[0]),
        color: fillColor(spPr, theme) || lineColor(spPr, theme),
        lineColor: lineColor(spPr, theme),
        noLine: Boolean(spPr && descendants(spPr, "ln").some(ln => children(ln, "noFill").length)),
        noMarker: Boolean(markerSymbol && markerSymbol.getAttribute("val") === "none"),
        smooth: Boolean(children(ser, "smooth")[0] && children(ser, "smooth")[0].getAttribute("val") === "1"),
        pointColors: points,
        labels: readLabels(children(ser, "dLbls")[0]),
        trendlines: children(ser, "trendline").map(trendline => {
            const type = children(trendline, "trendlineType")[0];
            const period = children(trendline, "period")[0];
            return {
                type: type ? type.getAttribute("val") : "linear",
                period: period ? Number(period.getAttribute("val")) || 2 : 2,
                color: lineColor(children(trendline, "spPr")[0], theme)
            };
        })
    };
}

// Data labels: which parts are shown (null when the element is missing, so the plot's setting applies)
function readLabels(dLbls) {
    if (!dLbls) return null;
    const on = name => {
        const el = children(dLbls, name)[0];
        return Boolean(el) && el.getAttribute("val") === "1";
    };
    if (children(dLbls, "delete")[0] && children(dLbls, "delete")[0].getAttribute("val") === "1") {
        return { value: false, percent: false, category: false };
    }
    return { value: on("showVal"), percent: on("showPercent"), category: on("showCatName") };
}

function fillColor(spPr, theme) {
    const solid = spPr && children(spPr, "solidFill")[0];
    return solid ? readDrawingColor(solid, theme) : null;
}

function lineColor(spPr, theme) {
    const ln = spPr && children(spPr, "ln")[0];
    const solid = ln && children(ln, "solidFill")[0];
    return solid ? readDrawingColor(solid, theme) : null;
}

// A series' tx/cat/val: a formula reference (live) and the values Excel cached when it last saved
function readDataRef(el) {
    if (!el) return null;
    const literal = children(el, "v")[0];
    if (literal) return { ref: null, cache: [textOf(literal)] };
    const ref = Array.from(el.children).find(c => /^(strRef|numRef|multiLvlStrRef|strLit|numLit)$/.test(c.localName));
    if (!ref) return null;
    const f = children(ref, "f")[0];
    const cacheEl = Array.from(ref.children).find(c => /Cache$|Lit$/.test(c.localName)) || ref;
    const cache = [];
    descendants(cacheEl, "pt").forEach(pt => {
        const idx = numberAttr(pt, "idx", cache.length);
        cache[idx] = textOf(children(pt, "v")[0]);
    });
    return {
        ref: f ? textOf(f) : null,
        numeric: ref.localName === "numRef" || ref.localName === "numLit",
        formatCode: textOf(descendants(cacheEl, "formatCode")[0]) || null,
        cache
    };
}

function readText(el) {
    const parts = descendants(el, "t").map(textOf);
    if (parts.length) return parts.join("");
    const ref = readDataRef(children(el, "tx")[0]);
    return ref && ref.cache.length ? ref.cache.join(" ") : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Relationships and XML helpers

export function relsPathFor(path) {
    const slash = path.lastIndexOf("/");
    return path.slice(0, slash + 1) + "_rels/" + path.slice(slash + 1) + ".rels";
}

/** Resolves a relationship target relative to the part that declares it. */
export function resolvePath(fromPath, target) {
    if (target[0] === "/") return target.slice(1);
    const parts = fromPath.split("/").slice(0, -1);
    target.split("/").forEach(segment => {
        if (segment === "..") parts.pop();
        else if (segment !== ".") parts.push(segment);
    });
    return parts.join("/");
}

export function readRels(pkg, path) {
    const xml = parseXml(pkg.text(relsPathFor(path)));
    const rels = {};
    if (!xml) return rels;
    descendants(xml, "Relationship").forEach(rel => {
        const target = rel.getAttribute("Target");
        const external = rel.getAttribute("TargetMode") === "External";
        rels[rel.getAttribute("Id")] = {
            type: rel.getAttribute("Type"),
            target,
            external,
            path: external ? null : resolvePath(path, target)
        };
    });
    return rels;
}

export function parseXml(text) {
    if (!text) return null;
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.getElementsByTagName("parsererror").length ? null : doc;
}

// Matching by local name keeps the code independent of namespace prefixes (x:, c:, xdr:, ...)
export function descendants(node, localName) {
    return Array.from(node.getElementsByTagNameNS("*", localName));
}

export function children(node, localName) {
    return node ? Array.from(node.children).filter(c => c.localName === localName) : [];
}

function childList(xml, parent, child) {
    const parentEl = descendants(xml, parent)[0];
    return children(parentEl, child);
}

function textOf(el) {
    return el ? el.textContent : "";
}

function attrNS(el, ns, name) {
    return el.getAttributeNS(ns, name) || el.getAttribute("r:" + name);
}

function numberAttr(el, name, fallback) {
    if (!el || !el.hasAttribute(name)) return fallback;
    const n = Number(el.getAttribute(name));
    return Number.isFinite(n) ? n : fallback;
}

function boolAttr(el, name) {
    const v = el.getAttribute(name);
    return v === "1" || v === "true";
}
