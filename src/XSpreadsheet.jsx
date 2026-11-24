import { createElement } from "react";
import { MendixSpreadsheet } from "./components/Spreadsheet";

export function XSpreadsheet({
    fileDocument,
    editable,
    bookSST,
    compression,
    bookTypeEnum,
    typeEnum,
    cellStyles,
    isShowSave,
    isShowDownload,
    afterSaveAction,
    saveMethod,
    widthOffset,
    height,
    saveCaption,
    downloadCaption,
    class: className,
    style
}) {
    return (
        <MendixSpreadsheet
            fileDocument={fileDocument}
            editable={editable}
            bookSST={bookSST}
            compression={compression}
            bookType={bookTypeEnum}
            type={typeEnum}
            cellStyles={cellStyles}
            isShowSave={isShowSave}
            isShowDownload={isShowDownload}
            afterSaveAction={afterSaveAction}
            saveMethod={saveMethod}
            widthOffset={widthOffset}
            height={height}
            saveCaption={saveCaption && saveCaption.value}
            downloadCaption={downloadCaption && downloadCaption.value}
            className={className}
            style={style}
        />
    );
}
