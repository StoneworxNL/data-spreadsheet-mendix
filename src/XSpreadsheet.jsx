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
    widthOffset,
    height,
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
            widthOffset={widthOffset}
            height={height}
            className={className}
            style={style}
        />
    );
}
