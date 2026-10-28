import { createElement } from "react";

export function CustomExportToolbar({
    spreadsheet,
    exportFile,
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
            const fileData = exportFile({ bookType: "xlsx", type: "array", compression: true });
            const url = URL.createObjectURL(
                new Blob([fileData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = file.value.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
    };

    const handleSave = () => {
        if (spreadsheet) {
            // https://docs.sheetjs.com/docs/api/write-options/
            // Generate the file blob
            const fileData = exportFile({
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
