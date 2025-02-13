// import { createElement, useRef, useEffect, useState } from "react";
// import Spreadsheet from "x-data-spreadsheet";
// import * as XLSX from "xlsx";
// import { stox, xtos } from './xlsxspread.min.js';

// export function XSpreadsheet({ sourcetype, filedocument, urlsource }) {
//     const el = useRef(null);
//     const [spreadsheet, setSpreadsheet] = useState(null); // Store the spreadsheet instance

//     useEffect(() => {
//         const loadSpreadsheetData = async (data) => {
//             if (!spreadsheet) { // Create only once
//                 const s = new Spreadsheet(el.current, {
//                     view: {
//                         height: () => document.documentElement.clientHeight,
//                         width: () => document.documentElement.clientWidth
//                     }
//                 });

//                 setSpreadsheet(s); // Save the instance
//                 s.change(data => {
//                     save(data); // Assuming 'save' is defined elsewhere
//                     console.log(s.validate());
//                 });
//             }

//             spreadsheet.loadData(data); // Now use the instance
//         };

//         const loadFromFile = async () => {
//             if (filedocument && filedocument.status === "available" && filedocument.value.uri) {
//                 try {
//                     const response = await fetch(filedocument.value.uri);
//                     const arrayBuffer = await response.arrayBuffer();
//                     const workbook = XLSX.read(arrayBuffer, { type: "array" });
//                     loadSpreadsheetData(stox(workbook));
//                 } catch (error) {
//                     console.error("Error loading file:", error);
//                     // Handle error, e.g., display a message to the user
//                 }
//             }
//         };

//         const loadFromURL = async () => {
//             if (urlsource) {
//                 try {
//                     const response = await fetch(urlsource, {
//                         // Important: Add these options for proper handling of binary data
//                         responseType: 'arraybuffer',
//                         mode: 'cors' // If the URL is on a different domain, you may need this
//                     });
//                     if (!response.ok) {
//                         throw new Error(`HTTP error! status: ${response.status}`);
//                     }
//                     const arrayBuffer = await response.arrayBuffer();
//                     const workbook = XLSX.read(arrayBuffer, { type: "array" });
//                     loadSpreadsheetData(stox(workbook));
//                 } catch (error) {
//                     console.error("Error loading URL:", error);
//                     // Handle the error, e.g., display a message to the user
//                 }
//             }
//         };

//         if (sourcetype === "fileenum") {
//             loadFromFile();
//         } else if (sourcetype === "urlenum") {
//             loadFromURL();
//         }


//     }, [sourcetype, filedocument, urlsource, spreadsheet]); // Add spreadsheet to the dependency array

//     return <div id="gridctr" ref={el} />;
// }