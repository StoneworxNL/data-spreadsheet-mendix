import { createElement } from "react";
import * as XLSX from "xlsx-js-style";
import { xtos } from "../external/xlsxspread.js";

export function CustomExportToolbar({
    spreadsheet,
    file,
    bookSST,
    compression,
    bookType,
    type,
    cellStyles,
    isShowSave,
    isShowDownload,
    afterSaveAction
}) {
    const handleDownload = () => {
        if (spreadsheet) {
            const new_wb = xtos(spreadsheet.getData());
            XLSX.writeFile(new_wb, file.value.name);
        }
    };

    const handleSave = () => {
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

            // Convert the ArrayBuffer to a Blob
            const fileBlob = new Blob([fileData], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            });
            // Create a URL object
            const urlObj = new URL(file.value.uri);
            // Use URLSearchParams to get the query parameters
            const params = new URLSearchParams(urlObj.search);
            // Get the 'guid' parameter
            const guid = params.get("guid");

            mx.data.saveDocument(
                guid,
                file.value.name,
                {},
                fileBlob,
                function () {
                    if (afterSaveAction && !afterSaveAction.isExecuting) {
                        if (afterSaveAction.canExecute) {
                            afterSaveAction.execute();
                        } else {
                            console.log("After save action is executing.");
                        }
                    }
                },
                function (e) {
                    console.error(e);
                }
            );
        }
    };

    const btnClassNames = "btn mx-button btn-default spacing-outer-bottom-medium";

    return (
        <div>
            {isShowSave && (
                <button className={btnClassNames} onClick={handleSave}>
                    Save
                </button>
            )}
            {isShowDownload && (
                <button className={btnClassNames} onClick={handleDownload}>
                    Download
                </button>
            )}
        </div>
    );
}
