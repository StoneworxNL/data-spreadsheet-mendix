import { createElement, useRef, useEffect, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import * as XLSX from "xlsx";
import { stox, xtos } from './xlsxspread.min.js';

export function XSpreadsheet({ filedocument, editable }) {
    const el = useRef(null);
    const [availablefile, setFile] = useState(filedocument);
    const [isEditable, setIsEditable] = useState(editable); // State for editability
    const [spreadsheet, setSpreadsheet] = useState(null); // State to hold the spreadsheet instance

    useEffect(() => {
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
                    ...( !isEditable && { // Spread the conditional options
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
    }, [availablefile, isEditable]); 

    useEffect(() => {
        setFile(filedocument);
        setIsEditable(editable); // Update editability when the prop changes
    }, [filedocument, editable]); // Add editable to the dependency array

    const handleDownload = () => {
        if (spreadsheet) {
            const new_wb = xtos(spreadsheet.getData());
            XLSX.writeFileXLSX(new_wb, availablefile.value.name, {
                bookSST: true, 
                compression: true,
                bookType: 'xlsx'
            });
        }
    };

    return (
        <div>
            <button className="btn mx-button btn-default spacing-outer-bottom-medium" onClick={handleDownload}>Download</button>
            <div id="gridctr" ref={el} />
        </div>
    );
}