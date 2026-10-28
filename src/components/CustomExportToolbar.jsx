import { createElement } from "react";

// Extension and media type for each Book Type
const FILE_TYPES = {
    xlsx: ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    xlsm: ["xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    xlsb: ["xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
    biff8: ["xls", "application/vnd.ms-excel"],
    numbers: ["numbers", "application/x-iwork-numbers-sffnumbers"],
    csv: ["csv", "text/csv"],
    txt: ["txt", "text/plain"],
    html: ["html", "text/html"]
};

// The file name with the extension of the chosen format ("Report.xlsx" saved as CSV becomes "Report.csv")
export function fileNameFor(name, bookType) {
    const [extension] = FILE_TYPES[bookType] || FILE_TYPES.xlsx;
    const base = String(name || "Spreadsheet").replace(/\.[A-Za-z0-9]{1,8}$/, "");
    return `${base}.${extension}`;
}

export function CustomExportToolbar({
    spreadsheet,
    exportFile,
    file,
    bookSST,
    compression,
    bookType,
    cellStyles,
    isShowSave,
    isShowDownload,
    afterSaveAction
}) {
    const format = FILE_TYPES[bookType] ? bookType : "xlsx";

    // Save and Download produce the same file, in the format and with the options set on the widget.
    // https://docs.sheetjs.com/docs/api/write-options/
    const createFile = () => {
        const fileData = exportFile({ bookSST, compression, bookType: format, cellStyles, type: "array" });
        return new Blob([fileData], { type: FILE_TYPES[format][1] });
    };

    const handleDownload = () => {
        if (!spreadsheet) return;
        const url = URL.createObjectURL(createFile());
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFor(file.value.name, format);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const handleSave = () => {
        if (!spreadsheet) return;
        const fileBlob = createFile();
        const guid = new URL(file.value.uri).searchParams.get("guid");

        mx.data.saveDocument(
            guid,
            fileNameFor(file.value.name, format),
            {},
            fileBlob,
            () => {
                if (afterSaveAction && afterSaveAction.canExecute && !afterSaveAction.isExecuting) {
                    afterSaveAction.execute();
                }
            },
            error => {
                console.error(error);
                if (window.mx && mx.ui && mx.ui.error) {
                    mx.ui.error(`The file could not be saved. ${error && error.message ? error.message : ""}`.trim());
                }
            }
        );
    };

    const btnClassNames = "btn mx-button btn-default spacing-outer-bottom-medium";

    return (
        <div>
            {isShowSave && (
                <button type="button" className={btnClassNames} onClick={handleSave}>
                    Save
                </button>
            )}
            {isShowDownload && (
                <button type="button" className={btnClassNames} onClick={handleDownload}>
                    Download
                </button>
            )}
        </div>
    );
}
