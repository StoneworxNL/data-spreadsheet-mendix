import { createElement } from "react";
import { MendixSpreadsheet } from "./components/Spreadsheet";

export function XSpreadsheet({ fileDocument, editable, bookSST, compression, bookTypeEnum, typeEnum, cellStyles }) {
    return <MendixSpreadsheet
        fileDocument={fileDocument}
        editable={editable}
        bookSST={bookSST}
        compression={compression}
        bookType={bookTypeEnum} 
        type={typeEnum} 
        cellStyles={cellStyles}
        />
}
