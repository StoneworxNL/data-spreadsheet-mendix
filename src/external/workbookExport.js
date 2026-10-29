import * as XLSX from "xlsx";
import { xtos } from "./xlsxspread.js";
import { descendants, openPackage, parseXml, readRels, relsPathFor } from "./ooxml.js";
import { writeCellStyles } from "./styleWriter.js";

const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const ZIP_BOOK_TYPES = ["xlsx", "xlsm"];

// Elements that must come after <drawing> in a worksheet (CT_Worksheet sequence)
const AFTER_DRAWING = [
    "legacyDrawing",
    "legacyDrawingHF",
    "drawingHF",
    "picture",
    "oleObjects",
    "controls",
    "webPublishItems",
    "tableParts",
    "extLst"
];

const encoder = new TextEncoder();

/**
 * Builds the file for the current grid content.
 *
 * For .xlsx/.xlsm, cell styles (styleWriter.js), frozen panes and the charts and pictures of the loaded file are
 * added to the package SheetJS writes, since the community SheetJS build writes none of them.
 *
 * @param {Object} params
 * @param {Object[]} params.sheets `[{ data, original }]`: x-spreadsheet sheet data and the index of the sheet it was
 *     loaded from (null for sheets added in the grid)
 * @param {Object} [params.source] `{ pkg, layout }` from ooxml.js, for the file that was loaded
 * @param {Object} [params.options] SheetJS write options (bookType, bookSST, compression, cellStyles, type)
 * @param {Object} [params.defaultStyle] The grid's default x-spreadsheet style
 * @returns {ArrayBuffer|string} In the requested `type`; an ArrayBuffer for "array"
 */
export function exportWorkbook({ sheets, source = null, options = {}, defaultStyle = null }) {
    const bookType = options.bookType || "xlsx";
    const type = options.type || "array";
    const wb = xtos(
        sheets.map(sheet => sheet.data),
        { defaultStyle }
    );

    // Keep the macros of a macro-enabled workbook
    const vba = bookType === "xlsm" && source && source.pkg ? source.pkg.bytes("xl/vbaProject.bin") : null;
    if (vba) wb.vbaraw = vba;

    // sheetStubs keeps empty cells that only carry a style (a fill or border)
    const writeOptions = { ...options, bookType, bookVBA: Boolean(vba), sheetStubs: true, type: "array" };
    let bytes = new Uint8Array(XLSX.write(wb, writeOptions));
    if (ZIP_BOOK_TYPES.includes(bookType)) {
        const font = defaultStyle && defaultStyle.font;
        bytes = finishPackage(bytes, {
            worksheets: wb.SheetNames.map(name => wb.Sheets[name]),
            defaultFont: font && font.name ? { name: font.name, sz: font.size || 11 } : undefined,
            sheets: sheets.map((sheet, i) => ({
                original: sheet.original,
                name: wb.SheetNames[i],
                freeze: sheet.data.freeze
            })),
            source,
            compression: options.compression !== false
        });
    }
    return convert(bytes, type);
}

function convert(bytes, type) {
    if (type === "array") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return type === "base64" ? btoa(binary) : binary;
}

/**
 * Post-processes a package written by SheetJS: restores frozen panes and re-attaches the original drawings
 * (charts and pictures) to the sheets they came from. Chart references to renamed sheets are updated.
 */
export function finishPackage(bytes, { sheets, source, worksheets = [], defaultFont, compression = true }) {
    const out = openPackage(bytes);
    if (!out) return bytes;

    const layout = source && source.layout;
    const original = source && source.pkg;
    const sheetPaths = workbookSheetPaths(out);
    let types = out.text("[Content_Types].xml");
    let changed = false;

    const styled = writeCellStyles(out, { sheets: worksheets, sheetPaths, defaultFont });
    if (styled) {
        Object.keys(styled).forEach(path => writeEntry(out.zip, path, encoder.encode(styled[path])));
        changed = true;
    }

    const renames = {};
    sheets.forEach(sheet => {
        const originalSheet = layout && sheet.original != null ? layout.sheets[sheet.original] : null;
        if (originalSheet && originalSheet.name !== sheet.name) renames[originalSheet.name] = sheet.name;
    });

    const copied = new Set();
    sheets.forEach((sheet, i) => {
        const path = sheetPaths[i];
        if (!path) return;
        let xml = out.text(path);
        if (!xml) return;
        const sheetXmlBefore = xml;

        xml = addFrozenPane(xml, sheet.freeze);

        const originalSheet = layout && sheet.original != null ? layout.sheets[sheet.original] : null;
        const drawing = originalSheet && originalSheet.drawing;
        if (drawing && original && !copied.has(drawing.path) && !/<drawing\b/.test(xml)) {
            copied.add(drawing.path);
            drawing.parts.forEach(part => {
                let content = original.bytes(part);
                if (!content) return;
                if (part === drawing.path && drawing.objects.some(o => o.anchor.moved)) {
                    content = encoder.encode(writeAnchors(original.text(part), drawing.objects));
                }
                if (/^xl\/charts\/[^/]+\.xml$/.test(part) && Object.keys(renames).length) {
                    content = encoder.encode(renameSheetRefs(original.text(part), renames));
                }
                writeEntry(out.zip, part, content);
                types = addContentType(types, part, original.text("[Content_Types].xml"));
            });

            const relId = addRelationship(out, path, REL_DRAWING, relativeTarget(path, drawing.path));
            xml = insertDrawing(xml, relId);
        }

        if (xml !== sheetXmlBefore) {
            writeEntry(out.zip, path, encoder.encode(xml));
            changed = true;
        }
    });

    if (!changed) return bytes;
    writeEntry(out.zip, "[Content_Types].xml", encoder.encode(types));
    const written = XLSX.CFB.write(out.zip, { fileType: "zip", type: "array", compression });
    return written instanceof Uint8Array ? written : new Uint8Array(written);
}

function workbookSheetPaths(pkg) {
    const workbook = parseXml(pkg.text("xl/workbook.xml"));
    if (!workbook) return [];
    const rels = readRels(pkg, "xl/workbook.xml");
    return descendants(workbook, "sheet").map(sheet => {
        const id =
            sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
            sheet.getAttribute("r:id");
        return rels[id] ? rels[id].path : null;
    });
}

function writeEntry(zip, path, content) {
    const data = content instanceof Uint8Array ? content : new Uint8Array(content);
    const entry = XLSX.CFB.find(zip, "/" + path);
    if (entry) {
        entry.content = data;
        entry.size = data.length;
    } else {
        XLSX.CFB.utils.cfb_add(zip, "/" + path, data);
    }
}

// Adds an Override for the part (or a Default for its extension) using the original package's content types
function addContentType(types, part, originalTypes) {
    const partName = "/" + part;
    if (types.includes(`PartName="${partName}"`)) return types;
    const escaped = partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const override = originalTypes.match(new RegExp(`<Override[^>]*PartName="${escaped}"[^>]*/>`));
    if (override) return types.replace("</Types>", override[0] + "</Types>");

    const ext = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
    if (new RegExp(`Extension="${ext}"`, "i").test(types)) return types;
    const def = originalTypes.match(new RegExp(`<Default[^>]*Extension="${ext}"[^>]*/>`, "i"));
    return def ? types.replace("</Types>", def[0] + "</Types>") : types;
}

function addRelationship(pkg, partPath, type, target) {
    const relsPath = relsPathFor(partPath);
    let xml =
        pkg.text(relsPath) ||
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let n = 1;
    while (xml.includes(`Id="rIdXs${n}"`)) n++;
    const id = `rIdXs${n}`;
    xml = xml.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`
    );
    writeEntry(pkg.zip, relsPath, encoder.encode(xml));
    return id;
}

function relativeTarget(fromPath, toPath) {
    const from = fromPath.split("/").slice(0, -1);
    const to = toPath.split("/");
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
    return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

function insertDrawing(xml, relId) {
    const rootStart = xml.indexOf("<worksheet");
    if (!/xmlns:r=/.test(xml.slice(rootStart, xml.indexOf(">", rootStart)))) {
        xml = xml.replace(
            "<worksheet",
            '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
        );
    }
    let position = xml.lastIndexOf("</worksheet>");
    AFTER_DRAWING.forEach(name => {
        const match = xml.search(new RegExp(`<${name}[\\s/>]`));
        if (match >= 0 && match < position) position = match;
    });
    return xml.slice(0, position) + `<drawing r:id="${relId}"/>` + xml.slice(position);
}

// x-spreadsheet keeps the frozen pane as the top-left unfrozen cell ("A1" when nothing is frozen)
function addFrozenPane(xml, freeze) {
    if (!freeze || freeze === "A1" || /<pane\b/.test(xml)) return xml;
    const { r, c } = XLSX.utils.decode_cell(freeze);
    if (r <= 0 && c <= 0) return xml;
    const activePane = r > 0 && c > 0 ? "bottomRight" : r > 0 ? "bottomLeft" : "topRight";
    const pane =
        `<pane${c > 0 ? ` xSplit="${c}"` : ""}${r > 0 ? ` ySplit="${r}"` : ""} topLeftCell="${freeze}"` +
        ` activePane="${activePane}" state="frozen"/>`;
    if (/<sheetView\b[^>]*\/>/.test(xml)) {
        return xml.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`);
    }
    if (/<sheetView\b[^>]*>/.test(xml)) return xml.replace(/(<sheetView\b[^>]*>)/, `$1${pane}`);
    return xml.replace(
        /(<sheetData[\s>])/,
        `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>$1`
    );
}

// Puts anchors moved by row/column inserts and deletes back into the drawing part
export function writeAnchors(xml, objects) {
    const doc = parseXml(xml);
    if (!doc) return xml;
    const anchors = Array.from(doc.documentElement.children);
    objects.forEach(({ anchor }) => {
        const el = anchor.moved && anchors[anchor.index];
        if (!el) return;
        ["from", "to"].forEach(name => {
            const marker = anchor[name];
            const markerEl = marker && Array.from(el.children).find(c => c.localName === name);
            if (!markerEl) return;
            Array.from(markerEl.children).forEach(c => {
                if (c.localName in marker) c.textContent = String(Math.round(marker[c.localName]));
            });
        });
    });
    return new XMLSerializer().serializeToString(doc);
}

// Rewrites sheet names in chart formulas (<c:f>) after sheets were renamed in the grid
export function renameSheetRefs(xml, renames) {
    return xml.replace(/(<(?:\w+:)?f>)([^<]*)(<\/(?:\w+:)?f>)/g, (match, open, formula, close) => {
        let result = formula;
        Object.keys(renames).forEach(from => {
            const to = quoteSheetName(renames[from]);
            const quoted = `'${escapeXml(from).replace(/'/g, "''")}'!`;
            result = result.split(quoted).join(to + "!");
            result = result.replace(new RegExp(`(^|[(,])${escapeRegExp(escapeXml(from))}!`, "g"), `$1${to}!`);
        });
        return open + result + close;
    });
}

function quoteSheetName(name) {
    const escaped = escapeXml(name);
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? escaped : `'${escaped.replace(/'/g, "''")}'`;
}

function escapeXml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
