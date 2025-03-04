import { createElement, useRef, useEffect, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import * as XLSX from "xlsx";
import { stox, xtos } from "./xlsxspread.min.js";

export function XSpreadsheet({ filedocument, editable }) {
    const el = useRef(null);
    const [availablefile, setFile] = useState(filedocument);
    const [isEditable, setIsEditable] = useState(editable); // State for editability
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
                    ...(!isEditable && {
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
    }, [availablefile, isEditable]);

    useEffect(() => {
        setFile(filedocument);
        setIsEditable(editable); // Update editability when the prop changes
    }, [filedocument, editable]); // Add editable to the dependency array

    const handleDownload = () => {
        if (spreadsheet) {

            const new_wb = xtos(spreadsheet.getData());
            // Generate the file blob
            const fileData = XLSX.write(new_wb, {
                bookSST: true,
                compression: true,
                bookType: "xlsx",
                type: "array"
            });

            // Convert the ArrayBuffer to a Blob
            const fileBlob = new Blob([fileData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

            // Create a URL object
            const urlObj = new URL(availablefile.value.uri);
            // Use URLSearchParams to get the query parameters
            const params = new URLSearchParams(urlObj.search);
            // Get the 'guid' parameter
            const guid = params.get('guid');

            mx.data.saveDocument(guid, availablefile.value.name,
                { },    
                fileBlob,
                function () {
                    // success
                },
                function (e) {
                    console.error(e);
                }
            );
        }
    };

    return (
        <div>
            {isEditable && (
                <button className="btn mx-button btn-default spacing-outer-bottom-medium" onClick={handleDownload}>
                    Save
                </button>
            )}
            <div id="gridctr" ref={el} />
        </div>
    );
}
