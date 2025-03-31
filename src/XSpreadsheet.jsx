import { createElement } from "react";
import { MendixSpreadsheet } from "./components/Spreadsheet";

export function XSpreadsheet({ filedocument, editable }) {
    return <MendixSpreadsheet
        filedocument={filedocument}
        editable={editable}
        />
}
