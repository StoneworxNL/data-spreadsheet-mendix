import { createElement, useRef, useEffect, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import * as XLSX from "xlsx";
import { stox } from "../external/xlsxspread.js";
import { CustomExportToolbar } from "./CustomExportToolbar.jsx";
import "../ui/XSpreadsheet.css";

// Empty rows/columns past the data to type into in edit mode (the size of a blank x-spreadsheet sheet)
const EDIT_MODE_SPARE = { spareRows: 100, spareCols: 26 };

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
    const [spreadsheet, setSpreadsheet] = useState(null); // State to hold the spreadsheet instance

    const buildSpreadSheet = async () => {
        const response = await fetch(fileDocument.value.uri);
        const arrayBuffer = await response.arrayBuffer();
        // cellNF keeps number formats, so dates/currencies/percentages are written back with them
        const workbook = XLSX.read(arrayBuffer, { type: "array", cellNF: true });

        const s = new Spreadsheet(el.current, {
            view: {
                height: () => document.documentElement.clientHeight,
                width: () => document.documentElement.clientWidth - widthOffset
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

        const data = stox(workbook, editable ? EDIT_MODE_SPARE : undefined);
        s.loadData(data);

        setSpreadsheet(s); // Save the spreadsheet instance to state
    };

    useEffect(() => {
        if (spreadsheet) return;
        if (fileDocument && fileDocument.status === "available" && fileDocument.value.uri) {
            // setFile(fileDocument);
            buildSpreadSheet();
        }
    }, [fileDocument]); // Add editable to the dependency array

    return (
        <div>
            <CustomExportToolbar
                spreadsheet={spreadsheet}
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
