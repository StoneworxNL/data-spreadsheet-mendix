import { createElement } from "react";

// Extension and media type for each Book Type
const FILE_TYPES = {
    xlsx: ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    xlsm: ["xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    xlsb: ["xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
    biff8: ["xls", "application/vnd.ms-excel"],
    ods: ["ods", "application/vnd.oasis.opendocument.spreadsheet"],
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

// The Book Type of a file name's extension, used to save a file in the format it was loaded in
export function bookTypeOf(name) {
    const extension = String(name || "")
        .slice(String(name || "").lastIndexOf(".") + 1)
        .toLowerCase();
    const type = Object.keys(FILE_TYPES).find(key => FILE_TYPES[key][0] === extension);
    return type || "xlsx";
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
    afterSaveAction,
    onSaveStart,
    onSaveFailed
}) {
    // Download uses the widget's Book Type. Save keeps the format of the file that was loaded, so it never replaces
    // a workbook with, say, a single-sheet CSV.
    const downloadFormat = FILE_TYPES[bookType] ? bookType : "xlsx";

    // https://docs.sheetjs.com/docs/api/write-options/
    const createFile = format => {
        const fileData = exportFile({ bookSST, compression, bookType: format, cellStyles, type: "array" });
        return new Blob([fileData], { type: FILE_TYPES[format][1] });
    };

    const handleDownload = () => {
        if (!spreadsheet) return;
        const url = URL.createObjectURL(createFile(downloadFormat));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFor(file.value.name, downloadFormat);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const handleSave = () => {
        if (!spreadsheet) return;
        const fileBlob = createFile(bookTypeOf(file.value.name));
        const guid = new URL(file.value.uri).searchParams.get("guid");

        // Before saving: the refreshed file document can reach the widget before the success callback runs
        if (onSaveStart) onSaveStart();
        mx.data.saveDocument(
            guid,
            file.value.name,
            {},
            fileBlob,
            () => {
                if (afterSaveAction && afterSaveAction.canExecute && !afterSaveAction.isExecuting) {
                    afterSaveAction.execute();
                }
            },
            error => {
                if (onSaveFailed) onSaveFailed();
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
