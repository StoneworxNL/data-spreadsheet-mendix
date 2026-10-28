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

// Styles, sizes, charts and pictures from the package XML. A file that can't be read this way (csv, xls) or has
// unexpected XML still loads, just without them.
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
    widthOffset
}) {
    const el = useRef(null);
    const loaded = useRef(null);
    const [spreadsheet, setSpreadsheet] = useState(null); // State to hold the spreadsheet instance

    const buildSpreadSheet = async () => {
        const response = await fetch(fileDocument.value.uri);
        const arrayBuffer = await response.arrayBuffer();
        // cellNF keeps number formats, so dates/currencies/percentages are written back with them
        const workbook = XLSX.read(arrayBuffer, { type: "array", cellNF: true });
        const source = readSource(arrayBuffer);
        const layout = source && source.layout;

        const s = new Spreadsheet(el.current, {
            ...spreadsheetOptions(layout),
            view: {
                height: () => document.documentElement.clientHeight,
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
        });

        const uninstallRenderPatches = installRenderPatches(s);
        const data = stox(workbook, { ...(editable && EDIT_MODE_SPARE), layout });
        s.loadData(data);

        // Which loaded sheet each grid sheet came from, so charts and saved drawings follow renamed/moved sheets
        const originals = new Map(s.datas.map((d, i) => [d, i]));
        const drawings = layout ? new DrawingLayer(s, layout, originals) : null;
        if (layout) {
            registerFontFallbacks(layout.fontNames).then(added => added && s.reRender());
        }
        loaded.current = { source, originals, drawings, uninstallRenderPatches };

        setSpreadsheet(s); // Save the spreadsheet instance to state
    };

    useEffect(() => {
        if (spreadsheet) return;
        if (fileDocument && fileDocument.status === "available" && fileDocument.value.uri) {
            // setFile(fileDocument);
            buildSpreadSheet();
        }
    }, [fileDocument]); // Add editable to the dependency array

    useEffect(
        () => () => {
            if (!loaded.current) return;
            if (loaded.current.drawings) loaded.current.drawings.destroy();
            loaded.current.uninstallRenderPatches();
        },
        []
    );

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
        <div>
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
            />
            <div id="gridctr" ref={el} className={editable ? "" : "readonly"} />
        </div>
    );
}
