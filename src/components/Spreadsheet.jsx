import { createElement, useRef, useEffect, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import * as XLSX from "xlsx-js-style";
import { stox } from "../xlsxspread.min.js";
import { SaveSpreadsheet } from "./SaveSpreadsheet.jsx";

export function MendixSpreadsheet({ fileDocument, editable }) {
    const el = useRef(null);
    const [availablefile, setFile] = useState(fileDocument);
    const [spreadsheet, setSpreadsheet] = useState(null); // State to hold the spreadsheet instance

    useEffect(() => {
        if (spreadsheet) // We only want to load the spreadsheet once.
            return;
        if (availablefile && availablefile.status === "available" && availablefile.value.uri) {
            const fetchData = async () => {
                const response = await fetch(availablefile.value.uri);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: "array" });

                const s = new Spreadsheet(el.current, {
                    view: {
                        height: () => document.documentElement.clientHeight - 50,
                        width: () => document.documentElement.clientWidth - 50
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

                // Load data with styles
                const data = stox(workbook);
                s.loadData(data);

                setSpreadsheet(s); // Save the spreadsheet instance to state
            };
            fetchData();
        }
    }, [availablefile]);

    useEffect(() => {
        setFile(fileDocument);
    }, [fileDocument]); // Add editable to the dependency array

    return (
        <div>
            <SaveSpreadsheet 
                spreadsheet={spreadsheet}
                editable={editable}
                file={availablefile}
            />
            <div id="gridctr" ref={el} />
        </div>
    );
}
