import { createElement } from "react";
import * as XLSX from "xlsx-js-style";
import { xtos } from "../xlsxspread.min.js";

export function SaveSpreadsheet({ spreadsheet, editable, file, bookSST, compression, bookType, type, cellStyles }) {

    const handleDownload = () => {

        if (spreadsheet) {

            const new_wb = xtos(spreadsheet.getData());

            // https://docs.sheetjs.com/docs/api/write-options/
            // Generate the file blob
            const fileData = XLSX.write(new_wb, {
                bookSST: bookSST,
                compression: compression,
                bookType: bookType, //"xlsx",
                type: type, //"array",
                cellStyles: cellStyles
            });

            XLSX.writeFile(new_wb, file.value.name);

            // Convert the ArrayBuffer to a Blob
            const fileBlob = new Blob([fileData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

            // Create a URL object
            const urlObj = new URL(file.value.uri);
            // Use URLSearchParams to get the query parameters
            const params = new URLSearchParams(urlObj.search);
            // Get the 'guid' parameter
            const guid = params.get('guid');

            mx.data.saveDocument(guid, 
                file.value.name,
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
            {editable && (
                <button
                    className="btn mx-button btn-default spacing-outer-bottom-medium" 
                    onClick={handleDownload}>
                Save
                </button>
            )}
        </div>
    );
}
