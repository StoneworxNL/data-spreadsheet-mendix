import { descendants, parseXml } from "./ooxml.js";

/*
 * Writes cell styles into a package written by SheetJS. The community SheetJS build only writes number formats, so
 * the fonts, fills, borders and alignment of each cell (the `s` objects set by xtos) are added here: styles.xml is
 * rebuilt, keeping SheetJS's number formats, and every styled cell gets the index of its combined cell format.
 */

const BORDER_SIDES = ["left", "right", "top", "bottom"];
const DEFAULT_FONT = { name: "Calibri", sz: 11 };

/**
 * @param {Object} pkg Output package from openPackage (text/bytes access to the written zip)
 * @param {Object} params
 * @param {Array<Object>} params.sheets SheetJS worksheets, in workbook order
 * @param {Array<string>} params.sheetPaths Worksheet part paths, in workbook order
 * @param {Object} [params.defaultFont] `{ name, sz }` for unstyled cells
 * @returns {Object|null} Changed parts `{ path: xml }`, or null when no cell has a style
 */
export function writeCellStyles(pkg, { sheets, sheetPaths, defaultFont = DEFAULT_FONT }) {
    if (!sheets.some(ws => Object.keys(ws).some(ref => ref[0] !== "!" && ws[ref] && ws[ref].s))) return null;
    const stylesXml = pkg.text("xl/styles.xml");
    const styles = parseXml(stylesXml);
    if (!styles) return null;

    // Number format of each of SheetJS's cell formats
    const numFmtOf = descendants(styles, "cellXfs")[0]
        ? Array.from(descendants(styles, "cellXfs")[0].children).map(xf => xf.getAttribute("numFmtId") || "0")
        : ["0"];
    const numFmtsMatch = stylesXml.match(/<numFmts[\s\S]*?<\/numFmts>|<numFmts[^>]*\/>/);

    const table = createTable(defaultFont);
    const changed = {};
    sheets.forEach((ws, i) => {
        const path = sheetPaths[i];
        const xml = path && pkg.text(path);
        if (!xml) return;
        changed[path] = xml.replace(/<c r="([A-Z]+[0-9]+)"([^>]*?)(\/?)>/g, (match, ref, attrs, selfClosing) => {
            const cell = ws[ref];
            const oldIndex = Number((attrs.match(/ s="(\d+)"/) || [])[1] || 0);
            const numFmtId = numFmtOf[oldIndex] || "0";
            if (!(cell && cell.s) && numFmtId === "0") return match;
            const index = table.xf(numFmtId, cell && cell.s);
            const rest = attrs.replace(/ s="\d+"/, "");
            return `<c r="${ref}"${index ? ` s="${index}"` : ""}${rest}${selfClosing}>`;
        });
    });

    changed["xl/styles.xml"] = table.toXml(numFmtsMatch ? numFmtsMatch[0] : "");
    return changed;
}

function createTable(defaultFont) {
    const fonts = [fontXml(defaultFont, defaultFont)];
    const fills = [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>'
    ];
    const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const indexOf = (list, xml) => {
        let index = list.indexOf(xml);
        if (index < 0) index = list.push(xml) - 1;
        return index;
    };

    return {
        xf(numFmtId, s) {
            const fontId = s && s.font ? indexOf(fonts, fontXml(s.font, defaultFont)) : 0;
            const fill = s && s.fill && s.fill.fgColor && rgb(s.fill.fgColor.rgb);
            const fillId = fill
                ? indexOf(
                      fills,
                      `<fill><patternFill patternType="solid"><fgColor rgb="${fill}"/><bgColor indexed="64"/></patternFill></fill>`
                  )
                : 0;
            const borderId = s && s.border ? indexOf(borders, borderXml(s.border)) : 0;
            const alignment = s && s.alignment ? alignmentXml(s.alignment) : "";
            const applies = [
                numFmtId !== "0" ? ' applyNumberFormat="1"' : "",
                fontId ? ' applyFont="1"' : "",
                fillId ? ' applyFill="1"' : "",
                borderId ? ' applyBorder="1"' : "",
                alignment ? ' applyAlignment="1"' : ""
            ].join("");
            const xf =
                `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies}` +
                (alignment ? `>${alignment}</xf>` : "/>");
            return indexOf(xfs, xf);
        },
        toXml(numFmts) {
            return (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                numFmts +
                `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
                `<fills count="${fills.length}">${fills.join("")}</fills>` +
                `<borders count="${borders.length}">${borders.join("")}</borders>` +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
                '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>' +
                "</styleSheet>"
            );
        }
    };
}

// Children in CT_Font order: b, i, strike, u, sz, color, name
function fontXml(font, defaultFont) {
    const color = font.color && rgb(font.color.rgb);
    return (
        "<font>" +
        (font.bold ? "<b/>" : "") +
        (font.italic ? "<i/>" : "") +
        (font.strike ? "<strike/>" : "") +
        (font.underline ? "<u/>" : "") +
        `<sz val="${Number(font.sz || defaultFont.sz) || 11}"/>` +
        (color ? `<color rgb="${color}"/>` : '<color theme="1"/>') +
        `<name val="${escapeXml(font.name || defaultFont.name)}"/>` +
        "</font>"
    );
}

function borderXml(border) {
    const side = name => {
        const value = border[name];
        if (!value || !value.style) return `<${name}/>`;
        const color = value.color && rgb(value.color.rgb);
        return `<${name} style="${escapeXml(value.style)}">${
            color ? `<color rgb="${color}"/>` : '<color auto="1"/>'
        }</${name}>`;
    };
    return `<border>${BORDER_SIDES.map(side).join("")}<diagonal/></border>`;
}

function alignmentXml(alignment) {
    const attrs = [
        alignment.horizontal ? ` horizontal="${escapeXml(alignment.horizontal)}"` : "",
        alignment.vertical ? ` vertical="${escapeXml(alignment.vertical)}"` : "",
        alignment.wrapText ? ' wrapText="1"' : ""
    ].join("");
    return attrs ? `<alignment${attrs}/>` : "";
}

// "FF0000" or "#ff0000" to Excel's ARGB "FFFF0000"
function rgb(value) {
    const hex = String(value || "").replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) return "FF" + hex.toUpperCase();
    if (/^[0-9a-f]{8}$/i.test(hex)) return hex.toUpperCase();
    return null;
}

function escapeXml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
