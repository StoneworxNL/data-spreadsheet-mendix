import { createElement, useRef, useEffect, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import * as XLSX from "xlsx";
import { stox, spreadsheetOptions } from "../external/xlsxspread.js";
import { openPackage, readLayout } from "../external/ooxml.js";
import { exportWorkbook } from "../external/workbookExport.js";
import { installRenderPatches } from "../external/renderPatches.js";
import { registerFontFallbacks } from "../external/fonts.js";
import { CustomExportToolbar } from "./CustomExportToolbar.jsx";
import { DrawingLayer } from "./DrawingLayer.js";
import "../ui/XSpreadsheet.css";

// Empty rows/columns past the data to type into in edit mode (the size of a blank x-spreadsheet sheet)
const EDIT_MODE_SPARE = { spareRows: 100, spareCols: 26 };

// Files are parsed in the browser; beyond this they make the page unresponsive
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Styles, sizes, charts and pictures from the package XML. A file that can't be read this way (csv, xls) or has
// unexpected XML still loads, just without them.
// x-spreadsheet adds window listeners (resize, click, paste, keydown) and never removes them. Record the ones it adds
// while it is created, so they can be removed with the grid.
function createWithListeners(create) {
    const added = [];
    const add = window.addEventListener;
    window.addEventListener = (...args) => {
        added.push(args);
        return add.apply(window, args);
    };
    try {
        return { instance: create(), remove: () => added.forEach(args => window.removeEventListener(...args)) };
    } finally {
        window.addEventListener = add;
    }
}

function tooLarge(bytes) {
    const mb = size => Math.round((size / (1024 * 1024)) * 10) / 10;
    return `The file is too large to open here (${mb(bytes)} MB; the limit is ${mb(MAX_FILE_BYTES)} MB).`;
}

function readSource(arrayBuffer) {
    try {
        const pkg = openPackage(arrayBuffer);
        const layout = readLayout(pkg);
        return layout ? { pkg, layout } : null;
    } catch (e) {
        console.warn("XSpreadsheet: could not read styles and charts from the file.", e);
        return null;
    }
}

export function MendixSpreadsheet({
    fileDocument,
    editable,
    bookSST,
    compression,
    bookType,
    type,
    cellStyles,
    isShowSave,
    isShowDownload,
    afterSaveAction,
    widthOffset,
    height,
    className,
    style
}) {
    const root = useRef(null);
    const el = useRef(null);
    const loaded = useRef(null);
    // The file version shown (its URL holds a changed date) and whether the next new version is our own save
    const shown = useRef({ key: null, build: 0, ownSave: false });
    const [spreadsheet, setSpreadsheet] = useState(null); // State to hold the spreadsheet instance
    const [loadError, setLoadError] = useState(null);

    const destroy = () => {
        const current = loaded.current;
        loaded.current = null;
        if (!current) return;
        if (current.drawings) current.drawings.destroy();
        current.uninstallRenderPatches();
        current.removeListeners();
        if (el.current) el.current.innerHTML = "";
    };

    const buildSpreadSheet = async build => {
        const response = await fetch(fileDocument.value.uri);
        if (!response.ok) throw new Error(`The file could not be loaded (HTTP ${response.status}).`);
        const declaredSize = Number(response.headers.get("Content-Length"));
        if (declaredSize > MAX_FILE_BYTES) throw new Error(tooLarge(declaredSize));
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_FILE_BYTES) throw new Error(tooLarge(arrayBuffer.byteLength));
        // A newer file or setting arrived while this one was loading
        if (build !== shown.current.build || !el.current) return;
        // cellNF keeps number formats, so dates/currencies/percentages are written back with them
        const workbook = XLSX.read(arrayBuffer, { type: "array", cellNF: true });
        const source = readSource(arrayBuffer);
        const layout = source && source.layout;

        // With Height 0, a height given to the widget by CSS (its class or style) wins over the window height.
        // Decided the first time the widget is visible (it can start in a hidden tab), and then kept, so the grid's
        // own size can't feed back into it: a CSS height leaves the widget shorter than its content, or, while the
        // grid is still empty, taller than its buttons.
        const gridTop = () => el.current.getBoundingClientRect().top - root.current.getBoundingClientRect().top;
        let cssHeight = null;
        const viewHeight = () => {
            if (height > 0) return height;
            const widget = root.current;
            if (cssHeight === null && widget && widget.clientHeight > 0) {
                const available = widget.clientHeight - gridTop();
                cssHeight = el.current.childElementCount ? available < el.current.offsetHeight - 1 : available > 50;
            }
            if (cssHeight && widget && widget.clientHeight > 0) return widget.clientHeight - gridTop();
            return document.documentElement.clientHeight;
        };

        destroy();
        const { instance: s, remove: removeListeners } = createWithListeners(
            () =>
                new Spreadsheet(el.current, {
                    ...spreadsheetOptions(layout),
                    view: {
                        height: viewHeight,
                        // Never wider than the widget's own container (cards, columns, popups)
                        width: () =>
                            Math.min(
                                document.documentElement.clientWidth - widthOffset,
                                el.current && el.current.clientWidth ? el.current.clientWidth : Infinity
                            )
                    },
                    // Initially set readOnly based on the prop
                    ...(!editable && {
                        // Spread the conditional options
                        mode: "read",
                        showToolbar: false,
                        showGrid: false,
                        showContextmenu: false
                    })
                })
        );

        const uninstallRenderPatches = installRenderPatches(s);
        const data = stox(workbook, { ...(editable && EDIT_MODE_SPARE), layout });
        s.loadData(data);

        // Which loaded sheet each grid sheet came from, so charts and saved drawings follow renamed/moved sheets
        const originals = new Map(s.datas.map((d, i) => [d, i]));
        const drawings = layout ? new DrawingLayer(s, layout, originals) : null;
        if (layout) {
            registerFontFallbacks(layout.fontNames).then(added => added && s.reRender());
        }
        loaded.current = { source, originals, drawings, uninstallRenderPatches, removeListeners };

        setSpreadsheet(s); // Save the spreadsheet instance to state
    };

    // x-spreadsheet only listens to window resizes; also follow the container (sidebars, tabs, layout changes)
    useEffect(() => {
        if (!spreadsheet || typeof ResizeObserver === "undefined" || !el.current) return undefined;
        let lastWidth = el.current.clientWidth;
        const observer = new ResizeObserver(() => {
            if (!el.current || el.current.clientWidth === lastWidth) return;
            lastWidth = el.current.clientWidth;
            spreadsheet.sheet.reload();
        });
        observer.observe(el.current);
        return () => observer.disconnect();
    }, [spreadsheet]);

    // Load the file, and load it again when it is replaced, changed elsewhere, or Editable changes.
    // A new version created by our own Save is already on screen, so that one is skipped.
    const fileUri =
        fileDocument && fileDocument.status === "available" && fileDocument.value ? fileDocument.value.uri : null;
    const fileGone = Boolean(fileDocument) && fileDocument.status !== "loading" && !fileUri;
    useEffect(() => {
        if (!fileUri) {
            // The file was cleared or can't be read any more: don't keep showing the old one
            if (fileGone && shown.current.key) {
                shown.current.key = null;
                shown.current.build++;
                destroy();
                setSpreadsheet(null);
            }
            return;
        }
        const key = `${fileUri}|${editable}`;
        const state = shown.current;
        if (key === state.key) return;
        const sameSettings = state.key && state.key.endsWith(`|${editable}`);
        state.key = key;
        if (state.ownSave && sameSettings) {
            state.ownSave = false;
            return;
        }
        state.ownSave = false;
        const build = ++state.build;
        setLoadError(null);
        buildSpreadSheet(build).catch(error => {
            if (build !== shown.current.build) return;
            console.error("XSpreadsheet:", error);
            setLoadError(error.message || String(error));
        });
    }, [fileUri, fileGone, editable]);

    useEffect(
        () => () => {
            shown.current.build++;
            destroy();
        },
        []
    );

    // Our save shows up as a new file version shortly after; don't let a save that changed nothing (e.g. one the app
    // rejected) hide a later change made elsewhere
    const markOwnSave = () => {
        shown.current.ownSave = true;
        setTimeout(() => (shown.current.ownSave = false), 10000);
    };
    const clearOwnSave = () => {
        shown.current.ownSave = false;
    };

    // The file for the grid's current content, with the loaded file's charts and pictures copied back in
    const exportFile = options => {
        const { source, originals } = loaded.current;
        return exportWorkbook({
            sheets: spreadsheet.datas.map(d => ({
                data: d.getData(),
                original: originals.has(d) ? originals.get(d) : null
            })),
            source,
            options,
            defaultStyle: spreadsheet.sheet.data.defaultStyle()
        });
    };

    return (
        <div ref={root} className={["xspreadsheet-widget", className].filter(Boolean).join(" ")} style={style}>
            <CustomExportToolbar
                spreadsheet={spreadsheet}
                exportFile={exportFile}
                file={fileDocument}
                bookSST={bookSST}
                compression={compression}
                bookType={bookType}
                type={type}
                cellStyles={cellStyles}
                isShowSave={isShowSave && editable}
                isShowDownload={isShowDownload}
                afterSaveAction={afterSaveAction}
                onSaveStart={markOwnSave}
                onSaveFailed={clearOwnSave}
            />
            {loadError && <div className="alert alert-danger xs-load-error">{loadError}</div>}
            {/* The id is kept for apps that style #gridctr; new styles should use the class */}
            <div id="gridctr" ref={el} className={editable ? "xs-grid" : "xs-grid readonly"} />
        </div>
    );
}
