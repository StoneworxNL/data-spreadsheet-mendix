import { createElement } from "react";
import { MendixSpreadsheet } from "./components/Spreadsheet";

export function XSpreadsheet({ fileDocument, editable }) {
    return <MendixSpreadsheet
        fileDocument={fileDocument}
        editable={editable}
        />
}
